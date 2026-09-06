import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendAlpha, rankCandidates } from './score';
import type { CandidateModel, OwnSignal } from './types';

function m(slug: string, prompt: number, completion: number): CandidateModel {
  const [p, u] = slug.split('/');
  return {
    slug,
    providerSlug: p!,
    upstreamModel: u!,
    promptPricePerM: prompt,
    completionPricePerM: completion,
    contextLength: 128000,
    modality: 'text->text',
  };
}

test('blendAlpha shifts from prior to own telemetry as requests grow', () => {
  assert.equal(blendAlpha(0), 0);
  assert.equal(blendAlpha(50), 0.5);
  assert.ok(blendAlpha(1000) > 0.9);
});

test('cost tier: low prefers cheaper, max prefers higher quality', () => {
  const models = [m('openai/cheap', 0.15, 0.6), m('openai/premium', 5, 15)];
  const prior = new Map([
    ['openai/cheap', 1],
    ['openai/premium', 4],
  ]);
  const base = {
    models,
    ownSignal: new Map<string, OwnSignal>(),
    prior,
    estPromptTokens: 1000,
    estCompletionTokens: 500,
    explore: 0,
    rngSeed: 1,
  };
  const low = rankCandidates({ ...base, costTier: 'low' });
  const max = rankCandidates({ ...base, costTier: 'max' });
  assert.equal(low.ranked[0]!.slug, 'openai/cheap');
  assert.equal(max.ranked[0]!.slug, 'openai/premium');
});

test('cold start relies on the prior (alpha = 0)', () => {
  const models = [m('a/x', 1, 1), m('b/y', 1, 1)];
  const prior = new Map([
    ['a/x', 9],
    ['b/y', 1],
  ]);
  const r = rankCandidates({
    models,
    ownSignal: new Map(),
    prior,
    estPromptTokens: 100,
    estCompletionTokens: 100,
    costTier: 'medium',
    explore: 0,
    rngSeed: 2,
  });
  assert.equal(r.alpha, 0);
  assert.equal(r.ranked[0]!.slug, 'a/x');
});

test('own telemetry overrides the prior once data accrues', () => {
  const models = [m('a/x', 1, 1), m('b/y', 1, 1)];
  const prior = new Map([
    ['a/x', 9],
    ['b/y', 1],
  ]); // prior favors a
  const own = new Map<string, OwnSignal>([
    ['b/y', { n: 1000, successRate: 1 }],
    ['a/x', { n: 5, successRate: 0.5 }],
  ]); // behavior favors b
  const r = rankCandidates({
    models,
    ownSignal: own,
    prior,
    estPromptTokens: 100,
    estCompletionTokens: 100,
    costTier: 'medium',
    explore: 0,
    rngSeed: 3,
  });
  assert.ok(r.alpha > 0.9);
  assert.equal(r.ranked[0]!.slug, 'b/y');
});

test('deterministic ordering for a fixed seed', () => {
  const models = [m('a/x', 1, 2), m('b/y', 2, 1)];
  const prior = new Map([
    ['a/x', 1],
    ['b/y', 1],
  ]);
  const args = {
    models,
    ownSignal: new Map<string, OwnSignal>(),
    prior,
    estPromptTokens: 100,
    estCompletionTokens: 100,
    costTier: 'medium' as const,
    rngSeed: 42,
  };
  const a = rankCandidates(args);
  const b = rankCandidates(args);
  assert.deepEqual(
    a.ranked.map((x) => x.slug),
    b.ranked.map((x) => x.slug),
  );
});
