import { eq, sql } from 'drizzle-orm';
import { apiKeys, getHttpDb, workspaces } from '@llmgw/db/http';

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  budgetLimitUsd: string | null;
  keyCount: number;
}

export async function listWorkspaces(orgId: string): Promise<WorkspaceRow[]> {
  const db = getHttpDb();
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      description: workspaces.description,
      budgetLimitUsd: workspaces.budgetLimitUsd,
      keyCount: sql<number>`count(${apiKeys.id})::int`,
    })
    .from(workspaces)
    .leftJoin(apiKeys, eq(apiKeys.workspaceId, workspaces.id))
    .where(eq(workspaces.orgId, orgId))
    .groupBy(workspaces.id)
    .orderBy(workspaces.createdAt);
}
