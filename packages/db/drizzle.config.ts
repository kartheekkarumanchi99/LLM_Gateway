import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs with cwd = packages/db; walk up to find the repo-root .env.
for (const rel of ['.env', '../.env', '../../.env']) {
  const full = resolve(process.cwd(), rel);
  if (existsSync(full)) {
    loadEnv({ path: full });
    break;
  }
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('DIRECT_URL or DATABASE_URL must be set (see .env.example).');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
