import { and, eq } from 'drizzle-orm';
import { apiKeys, getDb, guardrails, type GuardrailPolicies } from '@llmgw/db';

// The guardrail governing a key: its explicit guardrail, else the workspace default.
export async function getGuardrailForKey(
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
