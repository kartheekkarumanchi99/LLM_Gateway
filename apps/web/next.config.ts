import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the tracing root to the monorepo (a stray lockfile exists in the home dir).
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  // @llmgw/db ships raw TypeScript; let Next transpile it.
  transpilePackages: ['@llmgw/db'],
};

export default nextConfig;
