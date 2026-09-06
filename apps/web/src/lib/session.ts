import { eq } from 'drizzle-orm';
import { getHttpDb, organizations, users, workspaces } from '@llmgw/db/http';

// TEMP single-tenant resolver for local dev. Replaced by real auth/session
// when we build the Account/Profile feature.
export async function getCurrentOrg() {
  // No DB configured yet — let the UI render a setup state instead of crashing.
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = getHttpDb();
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, 'demo'))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.error('[session] database unavailable:', (err as Error).message);
    return null;
  }
}

// Resolves the active workspace (single-tenant dev: the org's first workspace).
export async function getCurrentWorkspace() {
  const org = await getCurrentOrg();
  if (!org) return null;
  try {
    const db = getHttpDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.orgId, org.id))
      .orderBy(workspaces.createdAt)
      .limit(1);
    const workspace = rows[0];
    if (!workspace) return null;
    return { org, workspace };
  } catch (err) {
    console.error('[session] database unavailable:', (err as Error).message);
    return null;
  }
}

// Resolves the account owner (single-tenant dev: the org's first user).
export async function getCurrentUser() {
  const org = await getCurrentOrg();
  if (!org) return null;
  try {
    const db = getHttpDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.orgId, org.id))
      .orderBy(users.createdAt)
      .limit(1);
    const user = rows[0];
    if (!user) return null;
    return { org, user };
  } catch (err) {
    console.error('[session] database unavailable:', (err as Error).message);
    return null;
  }
}
