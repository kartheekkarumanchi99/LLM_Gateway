import { and, count, eq } from 'drizzle-orm';
import { apiKeys, getHttpDb, guardrails, type GuardrailPolicies } from '@llmgw/db/http';

export interface GuardrailRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  status: string;
  policies: GuardrailPolicies | null;
  keyCount: number;
}

export async function ensureDefaultGuardrail(workspaceId: string): Promise<void> {
  const db = getHttpDb();
  const existing = await db
    .select({ id: guardrails.id })
    .from(guardrails)
    .where(and(eq(guardrails.workspaceId, workspaceId), eq(guardrails.isDefault, true)))
    .limit(1);
  if (existing.length) return;
  await db.insert(guardrails).values({
    workspaceId,
    name: 'Workspace Guardrail',
    description: 'Default policy automatically applied to every key in this workspace.',
    isDefault: true,
    status: 'active',
    policies: {},
  });
}

export async function listGuardrails(workspaceId: string): Promise<GuardrailRow[]> {
  const db = getHttpDb();
  const rows = await db
    .select({
      id: guardrails.id,
      name: guardrails.name,
      description: guardrails.description,
      isDefault: guardrails.isDefault,
      status: guardrails.status,
      policies: guardrails.policies,
      keyCount: count(apiKeys.id),
    })
    .from(guardrails)
    .leftJoin(apiKeys, eq(apiKeys.guardrailId, guardrails.id))
    .where(eq(guardrails.workspaceId, workspaceId))
    .groupBy(guardrails.id)
    .orderBy(guardrails.createdAt);
  return rows.map((r) => ({ ...r, policies: (r.policies as GuardrailPolicies | null) ?? null }));
}

export interface GuardrailDetail extends GuardrailRow {
  assignedKeys: { id: string; name: string }[];
}

export async function getGuardrail(id: string, workspaceId: string): Promise<GuardrailDetail | null> {
  const db = getHttpDb();
  const rows = await db
    .select()
    .from(guardrails)
    .where(and(eq(guardrails.id, id), eq(guardrails.workspaceId, workspaceId)))
    .limit(1);
  const g = rows[0];
  if (!g) return null;
  const keys = await db
    .select({ id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(eq(apiKeys.guardrailId, id));
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    isDefault: g.isDefault,
    status: g.status,
    policies: (g.policies as GuardrailPolicies | null) ?? null,
    keyCount: keys.length,
    assignedKeys: keys,
  };
}
