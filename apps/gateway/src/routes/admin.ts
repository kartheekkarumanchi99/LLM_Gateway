import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { apiKeys, getDb, workspaces } from '@llmgw/db';
import { authenticateManagement } from '../admin-auth';

function genApiKey() {
  const raw = 'sk-llmgw-' + randomBytes(24).toString('hex');
  return {
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
    prefix: raw.slice(0, 14),
    last4: raw.slice(-4),
  };
}

const UNAUTH = {
  error: { message: 'Invalid or missing management key.', type: 'authentication_error' },
};

// Admin API for managing API keys programmatically, authenticated by a
// management key (mirrors OpenRouter's management-key admin endpoints).
export function registerAdmin(app: FastifyInstance): void {
  app.get('/api/keys', async (req, reply) => {
    const ctx = await authenticateManagement(req.headers.authorization);
    if (!ctx) return reply.code(401).send(UNAUTH);

    const db = getDb();
    const wss = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.orgId, ctx.orgId));
    const ids = wss.map((w) => w.id);
    if (ids.length === 0) return { data: [] };

    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        workspaceId: apiKeys.workspaceId,
        keyPrefix: apiKeys.keyPrefix,
        keyLast4: apiKeys.keyLast4,
        revokedAt: apiKeys.revokedAt,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(inArray(apiKeys.workspaceId, ids))
      .orderBy(desc(apiKeys.createdAt));

    return {
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        workspace_id: r.workspaceId,
        hint: `${r.keyPrefix}…${r.keyLast4 ?? ''}`,
        disabled: Boolean(r.revokedAt),
        last_used_at: r.lastUsedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/keys', async (req, reply) => {
    const ctx = await authenticateManagement(req.headers.authorization);
    if (!ctx) return reply.code(401).send(UNAUTH);

    const body = (req.body ?? {}) as { name?: unknown; workspace_id?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return reply.code(400).send({ error: { message: '`name` is required.', type: 'invalid_request_error' } });
    }

    const db = getDb();
    const wss = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.orgId, ctx.orgId))
      .orderBy(workspaces.createdAt);
    if (wss.length === 0) {
      return reply.code(400).send({ error: { message: 'No workspace to attach the key to.', type: 'invalid_request_error' } });
    }
    let workspaceId = wss[0]!.id;
    if (typeof body.workspace_id === 'string') {
      const match = wss.find((w) => w.id === body.workspace_id);
      if (!match) {
        return reply.code(404).send({ error: { message: 'Workspace not found.', type: 'invalid_request_error' } });
      }
      workspaceId = match.id;
    }

    const { raw, hash, prefix, last4 } = genApiKey();
    const inserted = await db
      .insert(apiKeys)
      .values({ workspaceId, name: name.slice(0, 80), keyPrefix: prefix, keyLast4: last4, keyHash: hash })
      .returning({ id: apiKeys.id });

    return reply.code(201).send({ id: inserted[0]?.id, name, workspace_id: workspaceId, key: raw });
  });

  app.delete('/api/keys/:id', async (req, reply) => {
    const ctx = await authenticateManagement(req.headers.authorization);
    if (!ctx) return reply.code(401).send(UNAUTH);

    const id = (req.params as { id: string }).id;
    const db = getDb();
    const rows = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .innerJoin(workspaces, eq(apiKeys.workspaceId, workspaces.id))
      .where(and(eq(apiKeys.id, id), eq(workspaces.orgId, ctx.orgId)))
      .limit(1);
    if (!rows[0]) {
      return reply.code(404).send({ error: { message: 'Key not found.', type: 'invalid_request_error' } });
    }

    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    return { id, revoked: true };
  });
}
