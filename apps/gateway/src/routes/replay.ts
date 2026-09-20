import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { runReplay, type ReplayOverride } from '../replay/run';

// State-replay API: re-execute a captured request from one overridden node forward.
export function registerReplay(app: FastifyInstance): void {
  app.post('/v1/replay', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply.code(401).send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    const body = (req.body ?? {}) as {
      request_id?: unknown;
      override?: {
        node_key?: unknown;
        model?: unknown;
        temperature?: unknown;
        top_p?: unknown;
        seed?: unknown;
        prompt?: unknown;
      };
    };
    const requestId = typeof body.request_id === 'string' ? body.request_id : '';
    const nodeKey = typeof body.override?.node_key === 'string' ? body.override.node_key : '';
    if (!requestId || !nodeKey) {
      return reply.code(400).send({ error: { message: '`request_id` and `override.node_key` are required.', type: 'invalid_request_error' } });
    }
    const o = body.override!;
    const override: ReplayOverride = {
      nodeKey,
      model: typeof o.model === 'string' ? o.model : null,
      temperature: typeof o.temperature === 'number' ? o.temperature : null,
      topP: typeof o.top_p === 'number' ? o.top_p : null,
      seed: typeof o.seed === 'number' ? o.seed : null,
      prompt: typeof o.prompt === 'string' ? o.prompt : null,
    };
    try {
      const result = await runReplay({
        orgId: auth.orgId,
        workspaceId: auth.workspaceId,
        requestId,
        override,
      });
      return reply.send(result);
    } catch (err) {
      return reply.code(400).send({ error: { message: (err as Error).message, type: 'replay_error' } });
    }
  });
}
