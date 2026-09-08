import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PREDICTIVE_CONFIG, type PredictiveConfig } from '@llmgw/db';
import { computePrediction, type Prediction, type TaskStat } from './predict';
import { speculationGate } from './speculate';

function stat(entries: [string, number][]): TaskStat {
  const byModel = new Map<string, number>(entries);
  return { total: entries.reduce((a, [, n]) => a + n, 0), byModel };
}

test('predictor: cold start falls back with low confidence', () => {
  const p = computePrediction({
    taskClass: 'chat',
    approxTokens: 20,
    hasTools: false,
    taskStat: null,
    fallbackModel: 'openai/gpt-4o-mini',
  });
  assert.equal(p.predictedModel, 'openai/gpt-4o-mini');
  assert.equal(p.confidence, 0.25);
  assert.ok(p.reasonCodes.some((r) => r.startsWith('coldstart')));
});

test('predictor: cold start with no fallback yields zero confidence', () => {
  const p = computePrediction({ taskClass: 'chat', approxTokens: 20, hasTools: false, taskStat: null, fallbackModel: null });
  assert.equal(p.predictedModel, null);
  assert.equal(p.confidence, 0);
});

test('predictor: concentrated history predicts the dominant model with high confidence', () => {
  const p = computePrediction({
    taskClass: 'code',
    approxTokens: 500,
    hasTools: false,
    taskStat: stat([['openai/gpt-4o', 90], ['openai/gpt-4o-mini', 10]]),
    fallbackModel: null,
  });
  assert.equal(p.predictedModel, 'openai/gpt-4o');
  // share 0.9 * sampleFactor 100/110 ≈ 0.818
  assert.ok(p.confidence > 0.8 && p.confidence < 0.83, `confidence ${p.confidence}`);
  assert.equal(p.predictedCostTier, 'medium');
  assert.deepEqual(p.topModels.slice(0, 2), ['openai/gpt-4o', 'openai/gpt-4o-mini']);
});

test('predictor: confidence grows with sample size (shrinkage)', () => {
  const small = computePrediction({ taskClass: 'chat', approxTokens: 10, hasTools: false, taskStat: stat([['m', 3]]), fallbackModel: null });
  const large = computePrediction({ taskClass: 'chat', approxTokens: 10, hasTools: false, taskStat: stat([['m', 300]]), fallbackModel: null });
  assert.ok(large.confidence > small.confidence);
});

test('predictor: deterministic for a fixed input', () => {
  const input = { taskClass: 'reasoning' as const, approxTokens: 1234, hasTools: true, taskStat: stat([['a', 5], ['b', 2]]), fallbackModel: 'x' };
  assert.deepEqual(computePrediction(input), computePrediction(input));
});

test('predictor: cost tier follows task class', () => {
  assert.equal(computePrediction({ taskClass: 'chat', approxTokens: 5, hasTools: false, taskStat: null, fallbackModel: 'x' }).predictedCostTier, 'low');
  assert.equal(computePrediction({ taskClass: 'reasoning', approxTokens: 5, hasTools: false, taskStat: null, fallbackModel: 'x' }).predictedCostTier, 'medium');
});

const basePred: Prediction = {
  predictorVersion: 'test',
  predictedTaskClass: 'chat',
  predictedCostTier: 'low',
  predictedWorkflow: 'single',
  predictedModel: 'openai/gpt-4o-mini',
  confidence: 0.9,
  topModels: ['openai/gpt-4o-mini'],
  reasonCodes: [],
  predictorLatencyMs: 1,
};
const cfg = (over: Partial<PredictiveConfig> = {}): PredictiveConfig => ({
  ...DEFAULT_PREDICTIVE_CONFIG,
  speculationEnabled: true,
  ...over,
});

test('speculationGate: disabled config blocks', () => {
  assert.equal(speculationGate(basePred, cfg({ speculationEnabled: false }), false), 'speculation_disabled');
});

test('speculationGate: request opt-out blocks', () => {
  assert.equal(speculationGate(basePred, cfg(), true), 'request_opt_out');
});

test('speculationGate: low confidence blocks', () => {
  assert.equal(speculationGate({ ...basePred, confidence: 0.3 }, cfg({ confidenceThreshold: 0.6 }), false), 'low_confidence');
});

test('speculationGate: task not in allow-list blocks', () => {
  assert.equal(speculationGate(basePred, cfg({ allowedTaskClasses: ['code'] }), false), 'task_not_allowed');
});

test('speculationGate: no predicted model blocks', () => {
  assert.equal(speculationGate({ ...basePred, predictedModel: null }, cfg(), false), 'no_prediction');
});

test('speculationGate: eligible request passes', () => {
  assert.equal(speculationGate(basePred, cfg(), false), null);
});
