import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '@llmgw/db';

export function registerHealth(app: FastifyInstance): void {
  app.get('/', async () => ({ name: 'llm-gateway', status: 'ok' }));

  app.get('/health', async (_req, reply) => {
    try {
      await getDb().execute(sql`select 1`);
      return { status: 'ok', db: 'up' };
    } catch (err) {
      return reply.code(503).send({ status: 'degraded', db: 'down', error: (err as Error).message });
    }
  });
}
