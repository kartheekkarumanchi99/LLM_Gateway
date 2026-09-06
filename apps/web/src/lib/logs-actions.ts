'use server';

import { and, eq } from 'drizzle-orm';
import { getHttpDb, requestLogs, workspaces } from '@llmgw/db/http';
import { getCurrentUser } from './session';

export interface GenerationDetail {
  messages: { role: string; content: string }[];
  completion: string;
}

// Loads the logged prompt/completion for a request (only present when
// Input & Output Logging is enabled in Observability).
export async function getGenerationDetail(requestId: string): Promise<GenerationDetail | null> {
  const ctx = await getCurrentUser();
  if (!ctx) return null;
  const db = getHttpDb();
  const rows = await db
    .select({ messages: requestLogs.messages, completion: requestLogs.completion })
    .from(requestLogs)
    .innerJoin(workspaces, eq(requestLogs.workspaceId, workspaces.id))
    .where(and(eq(requestLogs.requestId, requestId), eq(workspaces.orgId, ctx.org.id)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;

  const raw = Array.isArray(r.messages) ? (r.messages as unknown[]) : [];
  const messages = raw.map((m) => {
    const o = m as { role?: unknown; content?: unknown };
    return {
      role: typeof o.role === 'string' ? o.role : 'user',
      content: typeof o.content === 'string' ? o.content : JSON.stringify(o.content ?? ''),
    };
  });
  return { messages, completion: r.completion ?? '' };
}
