import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROVIDER_CATALOG, SUPPORTED_PROVIDER_SLUGS, baseUrlEnvKey, providerMeta } from '@llmgw/db';
import { getAdapter, hasAdapter } from './registry';
import { hasPlatformKey } from './keys';

// These are the guarantees that make "add a provider key later, change no code" true:
// every cataloged provider must already have a working adapter, and key presence must
// be detected purely from the provider's env var.

test('every cataloged provider has a built adapter', () => {
  for (const meta of PROVIDER_CATALOG) {
    assert.ok(hasAdapter(meta.slug), `no adapter for ${meta.slug}`);
    assert.ok(getAdapter(meta.slug), `getAdapter empty for ${meta.slug}`);
  }
});

test('catalog covers the expected providers', () => {
  for (const slug of [
    'openai',
    'anthropic',
    'deepseek',
    'x-ai',
    'mistralai',
    'google',
    'moonshotai',
    'perplexity',
  ]) {
    assert.ok(SUPPORTED_PROVIDER_SLUGS.includes(slug), `missing ${slug}`);
    assert.ok(providerMeta(slug), `no meta for ${slug}`);
  }
});

test('unknown providers have no adapter and no meta', () => {
  assert.equal(hasAdapter('acme-nonexistent'), false);
  assert.equal(getAdapter('acme-nonexistent'), undefined);
  assert.equal(providerMeta('acme-nonexistent'), undefined);
});

test('baseUrlEnvKey maps <PREFIX>_API_KEY -> <PREFIX>_BASE_URL', () => {
  assert.equal(
    baseUrlEnvKey({ slug: 'openai', kind: 'openai', baseUrl: 'x', envKey: 'OPENAI_API_KEY' }),
    'OPENAI_BASE_URL',
  );
  assert.equal(
    baseUrlEnvKey({ slug: 'deepseek', kind: 'openai', baseUrl: 'x', envKey: 'DEEPSEEK_API_KEY' }),
    'DEEPSEEK_BASE_URL',
  );
});

test('hasPlatformKey reflects the provider env var (adding a key makes it usable)', () => {
  const prev = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  assert.equal(hasPlatformKey('deepseek'), false);
  process.env.DEEPSEEK_API_KEY = 'sk-test-key';
  assert.equal(hasPlatformKey('deepseek'), true);
  if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = prev;
});
