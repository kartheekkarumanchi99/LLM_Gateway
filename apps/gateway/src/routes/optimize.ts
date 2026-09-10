import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_OPTIMIZATION,
  getDb,
  MAX_EXAMPLES,
  MAX_VARIANTS,
  optimizationCandidates,
  optimizationRuns,
  type OptimizationExample,
  type OptimizationWeights,
} from '@llmgw/db';
import { authenticate } from '../auth';
import { runOptimization } from '../optimize/run';

interface OptimizeBody {
  name?: unknown;
  task_class?: unknown;
  taskClass?: unknown;
  baseline_prompt?: unknown;
  baselinePrompt?: unknown;
  examples?: unknown;
  models?: unknown;
  variants?: unknown;
  judge_model?: unknown;
  judgeModel?: unknown;
  weights?: unknown;
  max_tokens?: unknown;
  maxTokens?: unknown;
}

function parseExamples(raw: unknown): OptimizationExample[] {
  if (!Array.isArray(raw)) return [];
  const out: OptimizationExample[] = [];
  for (const e of raw) {
    if (typeof e === 'string' && e.trim()) {
      out.push({ input: e.trim() });
    } else if (e && typeof e === 'object') {
      const input = (e as { input?: unknown }).input;
      const reference = (e as { reference?: unknown }).reference;
      if (typeof input === 'string' && input.trim()) {
        out.push({
          input: input.trim(),
          ...(typeof reference === 'string' && reference.trim() ? { reference: reference.trim() } : {}),
        });
      }
    }
    if (out.length >= MAX_EXAMPLES) break;
  }
  return out;
}

function parseWeights(raw: unknown): OptimizationWeights {
  const d = DEFAULT_OPTIMIZATION.weights;
  if (!raw || typeof raw !== 'object') return d;
  const w = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return { quality: num(w.quality, d.quality), cost: num(w.cost, d.cost), latency: num(w.latency, d.latency) };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function registerOptimize(app: FastifyInstance): void {
  app.post('/v1/optimize', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }

    const body = (req.body ?? {}) as OptimizeBody;
    const name = (str(body.name) ?? 'Optimization run').slice(0, 120);
    const taskClass = (str(body.taskClass) ?? str(body.task_class) ?? 'general').slice(0, 60);
    const baselinePrompt = str(body.baselinePrompt) ?? str(body.baseline_prompt) ?? '';
    const examples = parseExamples(body.examples);
    const models = Array.isArray(body.models)
      ? body.models.filter((m): m is string => typeof m === 'string').slice(0, 5)
      : [];
    const variants = Math.max(
      1,
      Math.min(MAX_VARIANTS, Number(body.variants ?? DEFAULT_OPTIMIZATION.variants) || DEFAULT_OPTIMIZATION.variants),
    );
    const judgeModel = str(body.judgeModel) ?? str(body.judge_model) ?? null;
    const weights = parseWeights(body.weights);
    const maxTokens = Math.max(
      64,
      Math.min(4096, Number(body.maxTokens ?? body.max_tokens ?? DEFAULT_OPTIMIZATION.maxTokens) || DEFAULT_OPTIMIZATION.maxTokens),
    );

    if (examples.length === 0) {
      return reply.code(400).send({
        error: { message: 'At least one example input is required.', type: 'invalid_request_error' },
      });
    }

    const db = getDb();
    const inserted = await db
      .insert(optimizationRuns)
      .values({
        workspaceId: auth.workspaceId,
        name,
        taskClass,
        baselinePrompt,
        status: 'running',
        config: { models, variants, examples, judgeModel, weights, maxTokens },
      })
      .returning({ id: optimizationRuns.id });
    const runId = inserted[0]!.id;

    try {
      const result = await runOptimization({
        orgId: auth.orgId,
        workspaceId: auth.workspaceId,
        apiKeyId: auth.apiKeyId,
        runId,
        taskClass,
        baselinePrompt,
        examples,
        models,
        variants,
        judgeModel,
        weights,
        maxTokens,
      });

      await db.insert(optimizationCandidates).values(
        result.candidates.map((c) => ({
          runId,
          label: c.label,
          prompt: c.prompt,
          modelSlug: c.modelSlug,
          isBaseline: c.isBaseline,
          isWinner: c.isWinner,
          qualityScore: c.qualityScore.toFixed(2),
          avgCostUsd: c.avgCostUsd.toFixed(10),
          avgLatencyMs: c.avgLatencyMs,
          compositeScore: c.compositeScore.toFixed(2),
          sampleCount: c.sampleCount,
          notes: c.notes,
        })),
      );
      await db
        .update(optimizationRuns)
        .set({ status: 'complete', summary: result.summary, completedAt: new Date() })
        .where(eq(optimizationRuns.id, runId));

      return reply.send({
        run_id: runId,
        summary: result.summary,
        winner_index: result.winnerIndex,
        proposer_model: result.proposerModel,
        judge_model: result.judgeModel,
        total_cost_usd: result.totalCostUsd,
        warnings: result.warnings,
        candidates: result.candidates,
      });
    } catch (err) {
      const message = (err as Error).message || 'Optimization failed.';
      await db
        .update(optimizationRuns)
        .set({ status: 'error', error: message, completedAt: new Date() })
        .where(eq(optimizationRuns.id, runId));
      return reply.code(502).send({ error: { message, type: 'optimization_error' }, run_id: runId });
    }
  });
}
