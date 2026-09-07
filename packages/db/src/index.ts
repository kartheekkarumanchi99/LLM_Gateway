import { setDefaultResultOrder } from 'node:dns';
// Neon resolves dual-stack; IPv6 is black-holed on some networks. Prefer IPv4.
setDefaultResultOrder('ipv4first');

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export * from './schema';
export { schema };
export * from './crypto';
export * from './auth';
export * from './policies';
export * from './routing-config';
export * from './observability';
export * from './classifiers-config';

let pool: Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set (see .env.example).');
    }
    pool = new Pool({ connectionString, max: 8 });
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
