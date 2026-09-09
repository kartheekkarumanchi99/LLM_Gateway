import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
// Neon resolves dual-stack; IPv6 is black-holed on some networks. Force IPv4 and
// disable Happy Eyeballs so a connection can't race (and hang on) a dead IPv6 route.
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export * from './schema';
export { schema };
export * from './crypto';
export * from './auth';
export * from './policies';
export * from './routing-config';
export * from './predictive-config';
export * from './observability';
export * from './classifiers-config';
export * from './providers-catalog';

let pool: Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set (see .env.example).');
    }
    pool = new Pool({
      connectionString,
      max: 8,
      // Fail fast on a black-holed/dead connection instead of hanging the request.
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    });
    // Neon free-tier auto-suspends idle connections; log and keep serving.
    pool.on('error', (err) => console.error('[db] pool error:', err.message));
  }
  return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}
