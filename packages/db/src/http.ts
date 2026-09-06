import { setDefaultResultOrder } from 'node:dns';
// Neon dual-stack: avoid IPv6 black-hole on some networks.
setDefaultResultOrder('ipv4first');

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
// Load repo-root .env in local dev (Next runs with cwd = apps/web). Harmless in prod.
for (const rel of ['.env', '../.env', '../../.env', '../../../.env']) {
  const full = resolve(process.cwd(), rel);
  if (existsSync(full)) {
    loadEnv({ path: full });
    break;
  }
}

import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export * from './schema';
export { schema };
export * from './crypto';
export * from './policies';
export * from './routing-config';
export * from './observability';
export * from './classifiers-config';

let httpDb: NeonHttpDatabase<typeof schema> | undefined;

// Serverless HTTP client for the Next.js app (single-statement queries).
export function getHttpDb(): NeonHttpDatabase<typeof schema> {
  if (!httpDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');
    httpDb = drizzle(neon(url), { schema });
  }
  return httpDb;
}
