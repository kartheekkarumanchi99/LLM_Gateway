import { setDefaultResultOrder } from 'node:dns';
// Must run before any DNS/DB work. Neon dual-stack: avoid IPv6 black-hole.
setDefaultResultOrder('ipv4first');

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// pnpm runs scripts with cwd = apps/gateway; walk up to the repo-root .env.
for (const rel of ['.env', '../.env', '../../.env']) {
  const full = resolve(process.cwd(), rel);
  if (existsSync(full)) {
    loadEnv({ path: full });
    break;
  }
}
