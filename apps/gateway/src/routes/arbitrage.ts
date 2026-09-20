import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { getArbitrageSettings, getByokLimits } from '../arbitrage/config';
import { utilization } from '../arbitrage/limits';

// Live in-process rate-limit utilization per provider for the caller's org (the DB has the
// config + loan ledger; TPM/RPM headroom is in-process, so the dashboard reads it here).
export function registerArbitrage(app: FastifyInstance): void {
  app.get('/v1/arbitrage/status', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply.code(401).send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    const [settings, limits] = await Promise.all([getArbitrageSettings(auth.orgId), getByokLimits(auth.orgId)]);
    const providers = [...limits.values()].map((l) => {
      const u = utilization(auth.orgId, l.provider, { tpmLimit: l.tpmLimit, rpmLimit: l.rpmLimit });
      return {
        provider: l.provider,
        tpmLimit: l.tpmLimit,
        rpmLimit: l.rpmLimit,
        shareable: l.shareable,
        tier: l.tier,
        tpmUsed: u.tpmUsed,
        rpmUsed: u.rpmUsed,
        tpmHeadroom: Number.isFinite(u.tpmHeadroom) ? u.tpmHeadroom : null,
        utilizationPct: u.utilizationPct,
        throttled: u.throttled,
      };
    });
    return reply.send({ settings, providers, now: Date.now() });
  });
}
