import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
// Load repo-root .env (seed runs with cwd = packages/db).
for (const rel of ['.env', '../.env', '../../.env']) {
  const full = resolve(process.cwd(), rel);
  if (existsSync(full)) {
    loadEnv({ path: full });
    break;
  }
}

import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { apiKeys, getDb, memberships, models, modelTaskPriors, organizations, providers, users, workspaces } from './index';

function genApiKey() {
  const raw = 'sk-llmgw-' + randomBytes(24).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 14);
  return { raw, hash, prefix };
}

async function main() {
  const db = getDb();

  await db
    .insert(providers)
    .values([
      { slug: 'openai', displayName: 'OpenAI' },
      { slug: 'anthropic', displayName: 'Anthropic' },
    ])
    .onConflictDoNothing();

  await db
    .insert(models)
    .values([
      {
        slug: 'openai/gpt-4o-mini',
        providerSlug: 'openai',
        upstreamModel: 'gpt-4o-mini',
        displayName: 'GPT-4o mini',
        contextLength: 128000,
        promptPricePerM: '0.15',
        completionPricePerM: '0.60',
      },
      {
        slug: 'openai/gpt-4o',
        providerSlug: 'openai',
        upstreamModel: 'gpt-4o',
        displayName: 'GPT-4o',
        contextLength: 128000,
        promptPricePerM: '2.50',
        completionPricePerM: '10.00',
      },
      {
        slug: 'anthropic/claude-3-5-sonnet',
        providerSlug: 'anthropic',
        upstreamModel: 'claude-3-5-sonnet-latest',
        displayName: 'Claude 3.5 Sonnet',
        contextLength: 200000,
        promptPricePerM: '3.00',
        completionPricePerM: '15.00',
      },
    ])
    .onConflictDoNothing();

  // Cold-start routing priors (editable; overridden by live telemetry as it accrues).
  const PRIORS: Record<string, { slug: string; weight: number }[]> = {
    code: [
      { slug: 'anthropic/claude-3-5-sonnet', weight: 5 },
      { slug: 'openai/gpt-4o', weight: 4 },
      { slug: 'openai/gpt-4o-mini', weight: 2 },
    ],
    reasoning: [
      { slug: 'openai/gpt-4o', weight: 5 },
      { slug: 'anthropic/claude-3-5-sonnet', weight: 4 },
      { slug: 'openai/gpt-4o-mini', weight: 1 },
    ],
    summarization: [
      { slug: 'openai/gpt-4o-mini', weight: 5 },
      { slug: 'anthropic/claude-3-5-sonnet', weight: 3 },
    ],
    extraction: [
      { slug: 'openai/gpt-4o-mini', weight: 5 },
      { slug: 'openai/gpt-4o', weight: 2 },
    ],
    creative: [
      { slug: 'anthropic/claude-3-5-sonnet', weight: 5 },
      { slug: 'openai/gpt-4o', weight: 3 },
    ],
    vision: [
      { slug: 'openai/gpt-4o', weight: 5 },
      { slug: 'anthropic/claude-3-5-sonnet', weight: 4 },
    ],
    long_context: [
      { slug: 'anthropic/claude-3-5-sonnet', weight: 5 },
      { slug: 'openai/gpt-4o', weight: 3 },
    ],
    chat: [
      { slug: 'openai/gpt-4o-mini', weight: 5 },
      { slug: 'anthropic/claude-3-5-sonnet', weight: 3 },
      { slug: 'openai/gpt-4o', weight: 2 },
    ],
  };
  const priorRows = Object.entries(PRIORS).flatMap(([taskClass, arr]) =>
    arr.map((a) => ({ taskClass, modelSlug: a.slug, weight: String(a.weight) })),
  );
  await db.insert(modelTaskPriors).values(priorRows).onConflictDoNothing();

  const existingOrg = (
    await db.select().from(organizations).where(eq(organizations.slug, 'demo'))
  )[0];
  const org =
    existingOrg ??
    (await db.insert(organizations).values({ name: 'Demo Org', slug: 'demo' }).returning())[0];
  if (!org) throw new Error('Failed to create demo org');

  const existingUser = (
    await db.select().from(users).where(eq(users.email, 'demo@example.com'))
  )[0];
  const demoUser =
    existingUser ??
    (await db
      .insert(users)
      .values({ orgId: org.id, email: 'demo@example.com', name: 'Demo User' })
      .returning())[0];
  if (demoUser) {
    await db
      .insert(memberships)
      .values({ userId: demoUser.id, orgId: org.id, role: 'owner' })
      .onConflictDoNothing();
  }

  const existingWorkspace = (
    await db.select().from(workspaces).where(eq(workspaces.orgId, org.id))
  )[0];
  const workspace =
    existingWorkspace ??
    (await db
      .insert(workspaces)
      .values({
        orgId: org.id,
        name: 'Default Workspace',
        slug: 'default',
        description:
          'The initial workspace for your account. Includes all API keys, presets, and other configurations previously created.',
      })
      .returning())[0];
  if (!workspace) throw new Error('Failed to create demo workspace');

  const { raw, hash, prefix } = genApiKey();
  await db
    .insert(apiKeys)
    .values({ workspaceId: workspace.id, name: 'seed key', keyPrefix: prefix, keyHash: hash });

  console.log('\n✅ Seed complete.');
  console.log(`   org=${org.slug}  workspace=${workspace.slug}`);
  console.log('\n🔑 API key (shown once — copy it now):\n');
  console.log('   ' + raw + '\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
