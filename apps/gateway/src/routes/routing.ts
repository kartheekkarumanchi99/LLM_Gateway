import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { getPredictiveConfig, getRoutingConfig } from '../routing/config';
import { predict, warmPredictorStats } from '../routing/predict';
import type { ChatMessage } from '../providers/types';

// Predictive-routing dry-run: returns what the predictor would forecast for a
// request, without dispatching any upstream call. Authenticated with an API key.
export function registerRouting(app: FastifyInstance): void {
  app.post('/v1/routing/predict', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }
    const body = req.body as { messages?: ChatMessage[]; tools?: unknown[] };
    if (!body || !Array.isArray(body.messages)) {
      return reply
        .code(400)
        .send({ error: { message: '`messages` is required.', type: 'invalid_request_error' } });
    }

    const [config, routing] = await Promise.all([
      getPredictiveConfig(auth.workspaceId),
      getRoutingConfig(auth.workspaceId),
    ]);
    warmPredictorStats(auth.workspaceId);
    const p = predict({
      workspaceId: auth.workspaceId,
      messages: body.messages,
      hasTools: Array.isArray(body.tools) && body.tools.length > 0,
      fallbackModel: routing.defaultModel,
    });

    return {
      predictor_version: p.predictorVersion,
      predicted_task_class: p.predictedTaskClass,
      predicted_cost_tier: p.predictedCostTier,
      predicted_workflow: p.predictedWorkflow,
      predicted_model: p.predictedModel,
      confidence: Number(p.confidence.toFixed(4)),
      top_models: p.topModels,
      reason_codes: p.reasonCodes,
      predictor_latency_ms: p.predictorLatencyMs,
      config: {
        enabled: config.enabled,
        observation_only: config.observationOnly,
        speculation_enabled: config.speculationEnabled,
      },
    };
  });
}
