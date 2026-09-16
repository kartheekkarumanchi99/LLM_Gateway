import './bootstrap';
import { sql } from 'drizzle-orm';
import { getDb } from '@llmgw/db';
import { buildServer } from './server';
import { config } from './config';
import { startSentinelWorker } from './sentinel/worker';

const app = buildServer();

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then((addr) => {
    app.log.info(`llm-gateway listening on ${addr}`);
    // Keep the Neon pool warm to avoid free-tier ~5min idle cold starts.
    const warm = setInterval(() => {
      void getDb()
        .execute(sql`select 1`)
        .catch(() => {});
    }, 240_000);
    warm.unref();
    // Drift Sentinel: background loop that evaluates shadow samples + re-weights routing.
    startSentinelWorker();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
