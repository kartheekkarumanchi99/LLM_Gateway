import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessDrift, DEFAULT_SENTINEL_CONFIG, HEALTH_FLOOR } from '@llmgw/db';

const cfg = DEFAULT_SENTINEL_CONFIG; // qualityDropPct 3, lengthInflationPct 15

test('drift: establishing while the baseline has too few samples', () => {
  const a = assessDrift(
    { baselineQuality: 90, baselineLengthRatio: 1, baselineSamples: 3, recentQuality: 50, recentLengthRatio: 3, recentSamples: 5 },
    cfg,
  );
  assert.equal(a.status, 'establishing');
  assert.equal(a.drifted, false);
  assert.equal(a.healthMultiplier, 1);
});

test('drift: healthy when recent tracks the baseline', () => {
  const a = assessDrift(
    { baselineQuality: 88, baselineLengthRatio: 1.1, baselineSamples: 20, recentQuality: 87.5, recentLengthRatio: 1.1, recentSamples: 8 },
    cfg,
  );
  assert.equal(a.status, 'healthy');
  assert.equal(a.drifted, false);
  assert.equal(a.healthMultiplier, 1);
});

test('drift: a >=3% quality drop trips drift and penalizes routing weight', () => {
  const a = assessDrift(
    { baselineQuality: 90, baselineLengthRatio: 1, baselineSamples: 20, recentQuality: 82, recentLengthRatio: 1, recentSamples: 6 },
    cfg,
  );
  assert.ok(a.qualityDropPct >= 3, `dropPct ${a.qualityDropPct}`);
  assert.equal(a.drifted, true);
  assert.ok(a.kinds.includes('quality_drop'));
  assert.equal(a.status, 'drifted');
  assert.ok(a.healthMultiplier < 1 && a.healthMultiplier >= HEALTH_FLOOR);
});

test('drift: severe drop is floored, never zero routing weight', () => {
  const a = assessDrift(
    { baselineQuality: 90, baselineLengthRatio: 1, baselineSamples: 20, recentQuality: 10, recentLengthRatio: 1, recentSamples: 6 },
    cfg,
  );
  assert.equal(a.healthMultiplier, HEALTH_FLOOR);
});

test('drift: length inflation alone trips drift with a softer penalty', () => {
  const a = assessDrift(
    { baselineQuality: 88, baselineLengthRatio: 1, baselineSamples: 20, recentQuality: 88, recentLengthRatio: 1.3, recentSamples: 6 },
    cfg,
  );
  assert.ok(a.lengthInflationPct >= 15, `inflation ${a.lengthInflationPct}`);
  assert.equal(a.drifted, true);
  assert.ok(a.kinds.includes('length_inflation'));
  assert.equal(a.healthMultiplier, 0.85);
});

test('drift: minor degradation is "watching", not yet drifted', () => {
  const a = assessDrift(
    { baselineQuality: 90, baselineLengthRatio: 1, baselineSamples: 20, recentQuality: 88.5, recentLengthRatio: 1.05, recentSamples: 6 },
    cfg,
  );
  assert.equal(a.drifted, false);
  assert.equal(a.status, 'watching');
  assert.equal(a.healthMultiplier, 1);
});
