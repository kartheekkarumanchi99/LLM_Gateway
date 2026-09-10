import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { evalCases, evalRunCases, evalRuns, evalSets, getDb } from '@llmgw/db';
import type { ChatMessage } from '../providers/types';
import { authenticate } from '../auth';
import { runEval } from '../eval/run';

interface EvalBody {
  eval_set_id?: unknown;
  evalSetId?: unknown;
  name?: unknown;
  mode?: unknown;
  candidate_model?: unknown;
  candidateModel?: unknown;
  candidate_prompt?: unknown;
  candidatePrompt?: unknown;
  baseline_model?: unknown;
  baselineModel?: unknown;
  baseline_prompt?: unknown;
  baselinePrompt?: unknown;
  judge_model?: unknown;
  judgeModel?: unknown;
  max_tokens?: unknown;
  maxTokens?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function registerEval(app: FastifyInstance): void {
  app.post('/v1/eval', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }

    const body = (req.body ?? {}) as EvalBody;
    const evalSetId = str(body.evalSetId) ?? str(body.eval_set_id);
    const candidateModel = str(body.candidateModel) ?? str(body.candidate_model) ?? 'auto';
    if (!evalSetId) {
      return reply.code(400).send({ error: { message: '`eval_set_id` is required.', type: 'invalid_request_error' } });
    }

    const db = getDb();
    // Verify the set belongs to the caller's workspace, then load its cases.
    const setRows = await db
      .select({ id: evalSets.id, name: evalSets.name })
      .from(evalSets)
      .where(and(eq(evalSets.id, evalSetId), eq(evalSets.workspaceId, auth.workspaceId)))
      .limit(1);
    if (!setRows[0]) {
      return reply.code(404).send({ error: { message: 'Eval set not found.', type: 'invalid_request_error' } });
    }
    const caseRows = await db
      .select({ id: evalCases.id, input: evalCases.input, reference: evalCases.reference })
      .from(evalCases)
      .where(eq(evalCases.evalSetId, evalSetId));
    if (caseRows.length === 0) {
      return reply.code(400).send({ error: { message: 'The eval set has no cases.', type: 'invalid_request_error' } });
    }

    const candidatePrompt = str(body.candidatePrompt) ?? str(body.candidate_prompt) ?? null;
    const baselineModel = str(body.baselineModel) ?? str(body.baseline_model) ?? null;
    const baselinePrompt = str(body.baselinePrompt) ?? str(body.baseline_prompt) ?? null;
    const judgeModel = str(body.judgeModel) ?? str(body.judge_model) ?? null;
    const mode = str(body.mode) ?? (candidatePrompt ? 'prompt' : 'model');
    const name = str(body.name) ?? `${setRows[0].name} eval`;
    const maxTokens = Math.max(64, Math.min(4096, Number(body.maxTokens ?? body.max_tokens ?? 512) || 512));

    const inserted = await db
      .insert(evalRuns)
      .values({
        workspaceId: auth.workspaceId,
        evalSetId,
        name: name.slice(0, 120),
        mode,
        candidateModel,
        candidatePrompt,
        baselineModel,
        baselinePrompt,
        judgeModel,
        status: 'running',
      })
      .returning({ id: evalRuns.id });
    const runId = inserted[0]!.id;

    try {
      const result = await runEval({
        orgId: auth.orgId,
        workspaceId: auth.workspaceId,
        apiKeyId: auth.apiKeyId,
        runId,
        taskClass: 'eval',
        cases: caseRows.map((c) => ({
          id: c.id,
          input: (Array.isArray(c.input) ? c.input : []) as ChatMessage[],
          reference: c.reference,
        })),
        candidateModel,
        candidatePrompt,
        baselineModel,
        baselinePrompt,
        judgeModel,
        maxTokens,
      });

      if (result.caseResults.length > 0) {
        await db.insert(evalRunCases).values(
          result.caseResults.map((r) => ({
            evalRunId: runId,
            caseId: r.caseId,
            variant: r.variant,
            output: r.output,
            qualityScore: r.quality.toFixed(2),
            costUsd: r.costUsd.toFixed(10),
            latencyMs: r.latencyMs,
            passed: r.passed,
          })),
        );
      }
      await db
        .update(evalRuns)
        .set({ status: 'complete', summary: result.summary, completedAt: new Date() })
        .where(eq(evalRuns.id, runId));

      return reply.send({ run_id: runId, summary: result.summary, warnings: result.warnings });
    } catch (err) {
      const message = (err as Error).message || 'Eval failed.';
      await db
        .update(evalRuns)
        .set({ status: 'error', error: message, completedAt: new Date() })
        .where(eq(evalRuns.id, runId));
      return reply.code(502).send({ error: { message, type: 'eval_error' }, run_id: runId });
    }
  });
}
