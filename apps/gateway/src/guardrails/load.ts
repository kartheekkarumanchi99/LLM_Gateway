import { and, eq } from 'drizzle-orm';
import { apiKeys, getDb, guardrails, type GuardrailPolicies } from '@llmgw/db';
import { createTtlCache } from '../cache/memo';

// The guardrail governing a key: its explicit guardrail, else the workspace default.
async function loadGuardrailForKey(
  apiKeyId: string,
  workspaceId: string,
): Promise<GuardrailPolicies | null> {
  const db = getDb();

  const keyRows = await db
    .select({ guardrailId: apiKeys.guardrailId })
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1);
  const explicitId = keyRows[0]?.guardrailId ?? null;

  const rows = explicitId
    ? await db
        .select({ policies: guardrails.policies, status: guardrails.status })
        .from(guardrails)
        .where(eq(guardrails.id, explicitId))
        .limit(1)
    : await db
        .select({ policies: guardrails.policies, status: guardrails.status })
        .from(guardrails)
        .where(and(eq(guardrails.workspaceId, workspaceId), eq(guardrails.isDefault, true)))
        .limit(1);

  const row = rows[0];
  if (!row || row.status !== 'active') return null;
  return (row.policies as GuardrailPolicies | null) ?? null;
}

// Guardrails are security policy — short TTL so tightening a policy takes effect fast,
// while still sparing two DB reads per request under load.
const guardrailCache = createTtlCache<{ apiKeyId: string; workspaceId: string }, GuardrailPolicies | null>(
  ({ apiKeyId, workspaceId }) => loadGuardrailForKey(apiKeyId, workspaceId),
  { ttlMs: 10_000, maxEntries: 20_000, keyOf: (k) => `${k.apiKeyId}:${k.workspaceId}` },
);

export function getGuardrailForKey(
  apiKeyId: string,
  workspaceId: string,
): Promise<GuardrailPolicies | null> {
  return guardrailCache.get({ apiKeyId, workspaceId });
}
