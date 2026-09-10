import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { getAllProviderHealth, resetBreaker } from '../reliability/health';

// Reliability Mesh API: live provider-health + circuit-breaker state for the status page,
// plus a breaker reset (ops recovery). API-key gated.
export function registerReliability(app: FastifyInstance): void {
  app.get('/v1/health/providers', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    return reply.send({ providers: getAllProviderHealth(), now: Date.now() });
  });

  app.post('/v1/health/reset', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    const body = (req.body ?? {}) as { provider?: unknown };
    resetBreaker(typeof body.provider === 'string' ? body.provider : undefined);
    return reply.send({ ok: true });
  });
}
