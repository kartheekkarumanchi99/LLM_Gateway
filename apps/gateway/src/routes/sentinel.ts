import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { getAllHealth } from '../sentinel/registry';
import { runSentinelTick, sentinelWorkerState } from '../sentinel/worker';

// Drift Sentinel API: live in-process routing-health registry + worker state, plus a
// manual "evaluate pending now" trigger. API-key gated (same as the other control routes).
export function registerSentinel(app: FastifyInstance): void {
  app.get('/v1/sentinel/status', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    return reply.send({ worker: sentinelWorkerState(), health: getAllHealth(), now: Date.now() });
  });

  app.post('/v1/sentinel/run', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    const result = await runSentinelTick();
    return reply.send({ ok: true, ...result });
  });
}
