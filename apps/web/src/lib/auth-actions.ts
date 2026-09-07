'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import {
  getHttpDb,
  hashPassword,
  isValidEmail,
  memberships,
  organizations,
  users,
  verifyPassword,
  workspaces,
} from '@llmgw/db/http';
import { createUserSession, destroyCurrentSession } from './auth';

export interface AuthState {
  ok: boolean;
  error?: string;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'org'
  );
}

export async function registerAction(
  _prev: AuthState | null,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!name) return { ok: false, error: 'Name is required.' };
  if (name.length > 80) return { ok: false, error: 'Name must be 80 characters or fewer.' };
  if (!isValidEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  if (password.length > 200) return { ok: false, error: 'Password is too long.' };
  if (!process.env.DATABASE_URL) {
    return { ok: false, error: 'No database connected. Set DATABASE_URL, then run db:push.' };
  }

  const db = getHttpDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0]) return { ok: false, error: 'An account with this email already exists.' };

  // Allocate a unique org slug (neon-http has no transactions).
  const base = slugify(name);
  const taken = new Set(
    (await db.select({ slug: organizations.slug }).from(organizations)).map((r) => r.slug),
  );
  let slug = base;
  let n = 1;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  const [org] = await db
    .insert(organizations)
    .values({ name: `${name}'s Org`, slug })
    .returning();
  if (!org) return { ok: false, error: 'Could not create organization.' };

  const [user] = await db
    .insert(users)
    .values({ orgId: org.id, email, name, passwordHash: hashPassword(password) })
    .returning();
  if (!user) return { ok: false, error: 'Could not create user.' };

  await db.insert(memberships).values({ userId: user.id, orgId: org.id, role: 'owner' });
  await db.insert(workspaces).values({
    orgId: org.id,
    name: 'Default Workspace',
    slug: 'default',
    description: 'Your first workspace.',
  });

  await createUserSession(user.id);
  redirect('/');
}

export async function loginAction(_prev: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!isValidEmail(email) || !password) {
    return { ok: false, error: 'Enter your email and password.' };
  }
  if (!process.env.DATABASE_URL) return { ok: false, error: 'No database connected.' };

  const rows = await getHttpDb().select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  // Generic message avoids user enumeration.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: 'Invalid email or password.' };
  }

  await createUserSession(user.id);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect('/login');
}
