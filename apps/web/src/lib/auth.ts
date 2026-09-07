import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import {
  generateSessionToken,
  getHttpDb,
  hashSessionToken,
  sessionExpiry,
  sessions,
  users,
} from '@llmgw/db/http';

export const SESSION_COOKIE = 'llmgw_session';
export const ACTIVE_WORKSPACE_COOKIE = 'llmgw_ws';

export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
}

// Reads the current session from the cookie. Safe to call during render.
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!process.env.DATABASE_URL) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const rows = await getHttpDb()
      .select({ id: users.id, orgId: users.orgId, email: users.email, name: users.name })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.error('[auth] session lookup failed:', (err as Error).message);
    return null;
  }
}

// Creates a session row and sets the cookie. Must run in a Server Action / Route Handler.
export async function createUserSession(userId: string): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry();
  await getHttpDb().insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await getHttpDb().delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
    } catch (err) {
      console.error('[auth] session delete failed:', (err as Error).message);
    }
  }
  store.delete(SESSION_COOKIE);
}
