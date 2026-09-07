import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getHttpDb, organizations, users, workspaces } from '@llmgw/db/http';
import { ACTIVE_WORKSPACE_COOKIE, getSessionUser } from './auth';

// Public user columns only — never expose password_hash to callers/pages.
const userCols = {
  id: users.id,
  orgId: users.orgId,
  email: users.email,
  name: users.name,
  createdAt: users.createdAt,
};

async function demoOrg() {
  const rows = await getHttpDb()
    .select()
    .from(organizations)
    .where(eq(organizations.slug, 'demo'))
    .limit(1);
  return rows[0] ?? null;
}

// Active org: the signed-in user's org, else the seeded demo org (so local/demo
// mode keeps working until AUTH_REQUIRED is enabled).
export async function getCurrentOrg() {
  if (!process.env.DATABASE_URL) return null;
  try {
    const sessionUser = await getSessionUser();
    if (sessionUser) {
      const rows = await getHttpDb()
        .select()
        .from(organizations)
        .where(eq(organizations.id, sessionUser.orgId))
        .limit(1);
      if (rows[0]) return rows[0];
    }
    return await demoOrg();
  } catch (err) {
    console.error('[session] database unavailable:', (err as Error).message);
    return null;
  }
}

// Active workspace: the one pinned via cookie (validated against the org), else
// the org's first workspace.
export async function getCurrentWorkspace() {
  const org = await getCurrentOrg();
  if (!org) return null;
  try {
    const db = getHttpDb();
    const activeId = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
    if (activeId) {
      const pinned = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, activeId), eq(workspaces.orgId, org.id)))
        .limit(1);
      if (pinned[0]) return { org, workspace: pinned[0] };
    }
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

// Account owner: the signed-in user, else the org's first user.
export async function getCurrentUser() {
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = getHttpDb();
    const sessionUser = await getSessionUser();
    if (sessionUser) {
      const orgRows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, sessionUser.orgId))
        .limit(1);
      const userRows = await db
        .select(userCols)
        .from(users)
        .where(eq(users.id, sessionUser.id))
        .limit(1);
      if (orgRows[0] && userRows[0]) return { org: orgRows[0], user: userRows[0] };
    }
    const org = await demoOrg();
    if (!org) return null;
    const rows = await db
      .select(userCols)
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
