import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth';
import { getAdapter } from '../providers/registry';
import { resolveProviderKey } from '../providers/keys';
import type { ChatCompletionRequest, Usage } from '../providers/types';
import { resolveModel, type ResolvedModel } from '../routing/resolve';
import { autoRoute } from '../routing/auto';
import { classifyTask } from '../routing/classify';
import { isCostTier, type CandidateModel, type CostTier, type RoutingTrace } from '../routing/types';
import { getPredictiveConfig, getRoutingConfig, getToolsConfig } from '../routing/config';
import { resolvePreset } from '../routing/presets';
import { getObservabilityConfig } from '../observability/config';
import { emitObservability } from '../observability/emit';
import { runClassifiersForRequest } from '../classifiers/run';
import { maybeLowBalanceAlert } from '../notifications/alerts';
import { runOrchestration } from '../orchestration/run';
import { lookupCache, storeCache } from '../cache/semantic';
import { predict, warmPredictorStats, type Prediction } from '../routing/predict';
import { recordPredictiveEvent } from '../routing/predict-record';
import { runSpeculativeAuto } from '../routing/speculate';
import type { PresetParameters } from '@llmgw/db';
import { recordUsage } from '../billing/record';
import { keyUsageUsd, getWorkspaceBudget, workspaceUsageUsd } from '../billing/usage';
import { getGuardrailForKey } from '../guardrails/load';
import { checkContent, checkModelAccess } from '../guardrails/enforce';

const ZERO_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
};
const AUTO_SLUGS = new Set(['auto', 'openrouter/auto']);

// Client app label, following OpenRouter's X-Title / HTTP-Referer convention.
function refererApp(referer?: string): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).host || null;
  } catch {
    return referer.slice(0, 120);
  }
}

export function registerChat(app: FastifyInstance): void {
  app.post('/v1/chat/completions', async (req, reply) => {
    const auth = await authenticate(req.headers.authorization);
    if (!auth) {
      return reply
        .code(401)
        .send({ error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
    }

    const body = req.body as ChatCompletionRequest & { models?: string[]; cost_tier?: string };
    if (
      !body ||
      !Array.isArray(body.messages) ||
      (typeof body.model !== 'string' && !Array.isArray(body.models))
    ) {
      return reply.code(400).send({
        error: {
          message: '`messages` and `model` (or `models`) are required.',
          type: 'invalid_request_error',
        },
      });
    }

    const requestId =
      (req.headers['idempotency-key'] as string | undefined)?.trim() || randomUUID();
    const started = Date.now();
    const appName =
      (req.headers['x-title'] as string | undefined)?.trim().slice(0, 120) ||
      refererApp(req.headers['referer'] as string | undefined);

    // Enforce API-key expiry and credit limit (real, per-key).
    if (auth.expiresAt && new Date(auth.expiresAt).getTime() < Date.now()) {
      return reply
        .code(401)
        .send({ error: { message: 'API key has expired.', type: 'authentication_error' } });
    }
    if (auth.creditLimitUsd) {
      const used = await keyUsageUsd(auth.apiKeyId, auth.creditLimitInterval);
      if (used >= Number(auth.creditLimitUsd)) {
        return reply.code(402).send({
          error: { message: 'API key credit limit reached.', type: 'insufficient_quota' },
        });
      }
    }

    // Guardrail: load once; budget + content are per-key (checked once). Model
    // access is re-checked per candidate inside the recovery loop.
    let sensitiveFlagged = false;
    const guardrail = await getGuardrailForKey(auth.apiKeyId, auth.workspaceId);
    if (guardrail) {
      if (guardrail.budget?.limitUsd) {
        const used = await keyUsageUsd(auth.apiKeyId, guardrail.budget.interval);
        if (used >= guardrail.budget.limitUsd) {
          return reply
            .code(402)
            .send({ error: { message: 'Guardrail budget exceeded for this key.', type: 'insufficient_quota' } });
        }
      }
      const content = checkContent(guardrail, body.messages);
      if (content.flags.length > 0) sensitiveFlagged = true;
      if (content.block) {
        return reply
          .code(400)
          .send({ error: { message: content.reason ?? 'Blocked by content guardrail.', type: 'guardrail_blocked' } });
      }
    }

    // Workspace-wide budget cap (spans every key in the workspace).
    const wsBudget = await getWorkspaceBudget(auth.workspaceId);
    if (wsBudget?.limitUsd != null) {
      const used = await workspaceUsageUsd(auth.workspaceId, wsBudget.interval, wsBudget.includeByok);
      if (used >= wsBudget.limitUsd) {
        return reply
          .code(402)
          .send({ error: { message: 'Workspace budget exceeded.', type: 'insufficient_quota' } });
      }
    }

    // ---- Workspace routing + tools configuration ----
    const routingConfig = await getRoutingConfig(auth.workspaceId);
    const toolsConfig = await getToolsConfig(auth.workspaceId);
    const obsConfig = await getObservabilityConfig(auth.workspaceId);
    const predictiveConfig = await getPredictiveConfig(auth.workspaceId);

    // ---- Preset resolution (model = "@preset/<slug>") ----
    let messages = body.messages;
    let presetModels: string[] | null = null;
    let presetParams: PresetParameters | null = null;
    let presetTools: string[] = [];
    if (typeof body.model === 'string' && body.model.startsWith('@preset/')) {
      const slug = body.model.slice('@preset/'.length);
      const preset = await resolvePreset(auth.workspaceId, slug);
      if (!preset) {
        return reply.code(404).send({
          error: { message: `Preset \`${slug}\` not found.`, type: 'invalid_request_error' },
        });
      }
      if (preset.systemPrompt && !messages.some((m) => m.role === 'system')) {
        messages = [{ role: 'system', content: preset.systemPrompt }, ...messages];
      }
      presetModels = preset.config?.models?.length ? preset.config.models : null;
      presetParams = preset.config?.parameters ?? null;
      presetTools = preset.config?.tools ?? [];
    }

    // ---- Server-tool allow/deny (403 on a disallowed tool) ----
    const disallowedTools = new Set(toolsConfig.disallowed);
    const requestedTools: string[] = [...presetTools];
    const plugins = (body as { plugins?: unknown }).plugins;
    if (Array.isArray(plugins)) {
      for (const p of plugins) {
        requestedTools.push(typeof p === 'string' ? p : String((p as { id?: unknown })?.id ?? ''));
      }
    }
    if (Array.isArray(body.tools)) {
      for (const t of body.tools as Array<{ name?: string; function?: { name?: string } }>) {
        const n = t?.function?.name ?? t?.name;
        if (typeof n === 'string') requestedTools.push(n);
      }
    }
    const blockedTools = [
      ...new Set(
        requestedTools.map((x) => x.replace(/^openrouter:/, '')).filter((x) => x && disallowedTools.has(x)),
      ),
    ];
    if (blockedTools.length > 0) {
      return reply.code(403).send({
        error: {
          message: `Tool(s) not allowed in this workspace: ${blockedTools.join(', ')}.`,
          type: 'tool_not_allowed',
        },
      });
    }

    // ---- Cost tier: workspace default; request may override unless locked ----
    let costTier: CostTier = routingConfig.autoCostTier;
    if (!routingConfig.autoPreventOverrides && isCostTier(body.cost_tier)) costTier = body.cost_tier;
    const maxTokens = Number((body as { max_tokens?: number }).max_tokens ?? 512);
    const taskClass = classifyTask(messages);
    const trace: RoutingTrace = { mode: 'explicit', taskClass, costTier, attempts: [] };

    // ---- Predictive-routing controls (additive; standard mode is unchanged) ----
    const bx = body as {
      routing_mode?: unknown;
      speculation?: unknown;
      speculation_budget_usd?: unknown;
      max_routing_overhead_ms?: unknown;
    };
    const routingMode =
      bx.routing_mode === 'standard' ? 'standard' : bx.routing_mode === 'predictive' ? 'predictive' : 'auto';
    const speculationOptedOut = bx.speculation === 'off';
    const speculationBudgetUsd =
      typeof bx.speculation_budget_usd === 'number' ? bx.speculation_budget_usd : null;
    const maxRoutingOverheadMs =
      typeof bx.max_routing_overhead_ms === 'number' ? bx.max_routing_overhead_ms : 0;
    const explicitListEarly =
      presetModels ?? (Array.isArray(body.models) && body.models.length > 0 ? body.models : null);
    const wantsAutoEarly =
      !explicitListEarly && typeof body.model === 'string' && AUTO_SLUGS.has(body.model);
    const predictiveActive =
      (process.env.PREDICTIVE_ROUTING_KILL ?? '') !== '1' &&
      predictiveConfig.enabled &&
      wantsAutoEarly &&
      routingMode !== 'standard';
    let prediction: Prediction | null = null;
    if (predictiveActive) {
      warmPredictorStats(auth.workspaceId);
      prediction = predict({
        workspaceId: auth.workspaceId,
        messages,
        hasTools: Array.isArray(body.tools) && body.tools.length > 0,
        fallbackModel: routingConfig.defaultModel,
      });
    }

    // ---- Semantic response cache: an exact/semantic hit short-circuits routing
    // at ~zero upstream cost (the biggest model-agnostic cost lever) ----
    const cacheEnabled =
      (process.env.SEMANTIC_CACHE ?? '1') !== '0' &&
      !body.stream &&
      (body as { cache?: unknown }).cache !== false &&
      Number((body as { temperature?: number }).temperature ?? 0) <= 0.5;
    let cacheEmbedding: number[] | null = null;
    if (cacheEnabled) {
      const lookup = await lookupCache(auth.workspaceId, auth.orgId, messages, taskClass);
      cacheEmbedding = lookup.queryEmbedding;
      if (lookup.hit) {
        const h = lookup.hit;
        const totalTokens = h.promptTokens + h.completionTokens;
        // Record served tokens at ~zero cost (embedding only) so savings attributes
        // the full baseline as saved.
        await recordUsage({
          requestId,
          workspaceId: auth.workspaceId,
          apiKeyId: auth.apiKeyId,
          orgId: auth.orgId,
          modelSlug: h.model,
          providerSlug: h.provider,
          taskClass,
          status: 'success',
          promptTokens: h.promptTokens,
          completionTokens: h.completionTokens,
          totalTokens,
          promptPricePerM: '0',
          completionPricePerM: '0',
          overrideCostUsd: h.embedCostUsd,
          cached: true,
          appName,
          latencyMs: Date.now() - started,
          routingTrace: { mode: 'cache', cacheKind: h.kind },
        });
        void maybeLowBalanceAlert(auth.orgId, auth.workspaceId);
        return reply.send({
          ...h.response,
          id: `cache-${requestId}`,
          model: h.model,
          usage: { ...(h.response.usage as object | undefined), cost: h.embedCostUsd },
          _routing: {
            task: taskClass,
            mode: `cache:${h.kind}`,
            chosen: h.model,
            provider: h.provider,
            attempts: 0,
          },
          _cache: { hit: true, kind: h.kind, similarity: Number(h.similarity.toFixed(4)) },
        });
      }
    }

    // ---- Compound orchestration (HydraFusion-style): draft -> gate/critique -> escalate/revise ----
    const orchestrateRaw = (body as { orchestrate?: unknown }).orchestrate;
    if (
      !body.stream &&
      (orchestrateRaw === 'cascade' || orchestrateRaw === 'critique' || orchestrateRaw === 'bestofn')
    ) {
      const result = await runOrchestration({
        pattern: orchestrateRaw,
        messages,
        ctx: {
          orgId: auth.orgId,
          workspaceId: auth.workspaceId,
          apiKeyId: auth.apiKeyId,
          requestId,
          appName,
          guardrail,
          allowedModels: routingConfig.autoAllowedModels,
          maxTokens,
        },
      });
      if (result.error && !result.content) {
        return reply
          .code(502)
          .send({ error: { message: result.error, type: 'orchestration_error' } });
      }
      // Output guardrail: the SELECTED final answer must pass workspace content policy.
      if (guardrail) {
        const out = checkContent(guardrail, [{ role: 'assistant', content: result.content }]);
        if (out.block) {
          return reply
            .code(400)
            .send({ error: { message: out.reason ?? 'Blocked by output guardrail.', type: 'guardrail_blocked' } });
        }
      }
      void maybeLowBalanceAlert(auth.orgId, auth.workspaceId);
      return reply.send({
        id: `orch-${requestId}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.chosenModel,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result.content },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          total_tokens: result.totalTokens,
          cost: result.totalCostUsd,
        },
        _routing: {
          task: result.taskClass,
          mode: `orchestrate:${result.pattern}`,
          chosen: result.chosenModel,
          provider: result.chosenModel.split('/')[0],
          attempts: result.legs.length,
        },
        _orchestration: {
          pattern: result.pattern,
          totalCostUsd: result.totalCostUsd,
          requestedN: result.requestedN,
          completedN: result.completedN,
          diversityMode: result.diversityMode,
          judgeReason: result.judgeReason,
          legs: result.legs,
        },
      });
    }

    // ---- Speculative execution: overlap the predicted upstream call with routing,
    // then commit to exactly one winner before any client-visible byte ----
    if (
      prediction &&
      predictiveConfig.speculationEnabled &&
      !predictiveConfig.observationOnly &&
      !body.stream &&
      !(predictiveConfig.orchestrationDisabled && orchestrateRaw != null) &&
      !(predictiveConfig.sensitiveDataDisabled && sensitiveFlagged)
    ) {
      const effConfig =
        maxRoutingOverheadMs > 0
          ? { ...predictiveConfig, commitTimeoutMs: Math.min(predictiveConfig.commitTimeoutMs, maxRoutingOverheadMs) }
          : predictiveConfig;
      const spec = await runSpeculativeAuto(messages, body, {
        orgId: auth.orgId,
        workspaceId: auth.workspaceId,
        apiKeyId: auth.apiKeyId,
        requestId,
        appName,
        taskClass,
        costTier,
        maxTokens,
        guardrail,
        allowedModels: routingConfig.autoAllowedModels,
        config: effConfig,
        prediction,
        startedAt: started,
        speculationBudgetUsd,
        speculationOptedOut,
      });
      if (spec) {
        for (const [k, v] of Object.entries(spec.headers)) reply.header(k, v);
        void emitObservability({
          config: obsConfig,
          workspaceId: auth.workspaceId,
          apiKeyId: auth.apiKeyId,
          requestId,
          modelSlug: spec.chosenModel,
          providerSlug: spec.providerSlug,
          taskClass,
          messages,
          completion: spec.completionText,
          promptTokens: spec.usage.promptTokens,
          completionTokens: spec.usage.completionTokens,
          costUsd: spec.cost,
          latencyMs: Date.now() - started,
        });
        void runClassifiersForRequest({
          workspaceId: auth.workspaceId,
          orgId: auth.orgId,
          requestId,
          messages,
          completion: spec.completionText,
        });
        void maybeLowBalanceAlert(auth.orgId, auth.workspaceId);
        return reply.send(spec.responseJson);
      }
    }

    // ---- Model routing: build the ordered candidate list ----
    const candidates: CandidateModel[] = [];
    const seen = new Set<string>();
    const pushCand = (c: CandidateModel) => {
      if (!seen.has(c.slug)) {
        seen.add(c.slug);
        candidates.push(c);
      }
    };
    const asExplicit = (r: ResolvedModel): CandidateModel => ({
      slug: r.slug,
      providerSlug: r.providerSlug,
      upstreamModel: r.upstreamModel,
      promptPricePerM: Number(r.promptPricePerM),
      completionPricePerM: Number(r.completionPricePerM),
      contextLength: 0,
      modality: null,
    });

    const explicitList =
      presetModels ?? (Array.isArray(body.models) && body.models.length > 0 ? body.models : null);
    const wantsAuto = !explicitList && typeof body.model === 'string' && AUTO_SLUGS.has(body.model);

    if (wantsAuto) {
      trace.mode = 'auto';
      const routed = await autoRoute({
        messages,
        costTier,
        maxTokens,
        guardrail,
        allowedModels: routingConfig.autoAllowedModels,
      });
      trace.signalMix = { alpha: routed.alpha, ownRequests: routed.ownRequests };
      for (const r of routed.ranked) {
        pushCand({
          slug: r.slug,
          providerSlug: r.providerSlug,
          upstreamModel: r.upstreamModel,
          promptPricePerM: r.promptPricePerM,
          completionPricePerM: r.completionPricePerM,
          contextLength: r.contextLength,
          modality: r.modality,
        });
      }
    } else if (explicitList) {
      trace.mode = 'fallback';
      for (const slug of explicitList) {
        const r = await resolveModel(slug);
        if (r) pushCand(asExplicit(r));
      }
    } else if (typeof body.model === 'string') {
      const r = await resolveModel(body.model);
      if (r) pushCand(asExplicit(r));
    }

    // Workspace default model as a final fallback for every mode.
    if (routingConfig.defaultModel) {
      const dm = await resolveModel(routingConfig.defaultModel);
      if (dm) pushCand(asExplicit(dm));
    }

    if (candidates.length === 0) {
      return reply.code(404).send({
        error: { message: 'No routable model found for this request.', type: 'invalid_request_error' },
      });
    }

    // Strip gateway-only fields; forward effective messages + merged preset params.
    const upstreamBody: ChatCompletionRequest = { ...body, messages };
    delete (upstreamBody as { models?: unknown }).models;
    delete (upstreamBody as { cost_tier?: unknown }).cost_tier;
    if (presetParams) {
      const ub = upstreamBody as { temperature?: number; top_p?: number; max_tokens?: number };
      if (presetParams.temperature != null && ub.temperature == null) ub.temperature = presetParams.temperature;
      if (presetParams.topP != null && ub.top_p == null) ub.top_p = presetParams.topP;
      if (presetParams.maxTokens != null && ub.max_tokens == null) ub.max_tokens = presetParams.maxTokens;
    }

    // ---- Recovery loop: try candidates in order until one succeeds ----
    const preUpstreamMs = Date.now() - started;
    let lastErr: (Error & { status?: number }) | null = null;
    for (const cand of candidates) {
      const adapter = getAdapter(cand.providerSlug);
      if (!adapter) {
        trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'skipped', reason: 'no adapter' });
        continue;
      }
      if (guardrail) {
        const access = checkModelAccess(guardrail, cand.slug, cand.providerSlug);
        if (!access.allowed) {
          trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'skipped', reason: access.reason });
          continue;
        }
      }
      const providerKeyInfo = await resolveProviderKey(auth.orgId, cand.providerSlug);
      if (!providerKeyInfo.key) {
        trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'skipped', reason: 'no provider key' });
        continue;
      }
      const providerKey = providerKeyInfo.key;

      const billBase = {
        requestId,
        workspaceId: auth.workspaceId,
        apiKeyId: auth.apiKeyId,
        orgId: auth.orgId,
        modelSlug: cand.slug,
        providerSlug: cand.providerSlug,
        taskClass,
        byok: providerKeyInfo.isByok,
        appName,
        routingOverheadMs: Date.now() - started,
        promptPricePerM: String(cand.promptPricePerM),
        completionPricePerM: String(cand.completionPricePerM),
      };

      // ---- Streaming: fall back only before the first byte is sent ----
      if (body.stream) {
        let established: {
          stream: ReadableStream<Uint8Array>;
          getUsage: () => Usage | null;
          getFinishReason: () => string | null;
        };
        try {
          established = await adapter.chatStream(cand.upstreamModel, upstreamBody, providerKey);
        } catch (err) {
          lastErr = err as Error & { status?: number };
          trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'error', reason: (err as Error).message });
          continue;
        }
        trace.chosen = cand.slug;
        trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'success' });

        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-llmgw-model': cand.slug,
        });
        const reader = established.stream.getReader();
        req.raw.on('close', () => {
          void reader.cancel().catch(() => {});
        });
        let ttftMs: number | null = null;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              if (ttftMs === null) ttftMs = Date.now() - started;
              reply.raw.write(Buffer.from(value));
            }
          }
        } catch {
          // Client or upstream dropped mid-stream; nothing left to do but end.
        }
        reply.raw.end();

        const usage = established.getUsage() ?? ZERO_USAGE;
        const cost = await recordUsage({
          ...billBase,
          status: 'success',
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cachedTokens: usage.cachedTokens,
          reasoningTokens: usage.reasoningTokens,
          finishReason: established.getFinishReason(),
          ttftMs,
          latencyMs: Date.now() - started,
          routingTrace: trace,
        });
        void emitObservability({
          config: obsConfig,
          workspaceId: auth.workspaceId,
          apiKeyId: auth.apiKeyId,
          requestId,
          modelSlug: cand.slug,
          providerSlug: cand.providerSlug,
          taskClass,
          messages,
          completion: '',
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: cost,
          latencyMs: Date.now() - started,
        });
        void runClassifiersForRequest({
          workspaceId: auth.workspaceId,
          orgId: auth.orgId,
          requestId,
          messages,
          completion: '',
        });
        void maybeLowBalanceAlert(auth.orgId, auth.workspaceId);
        if (prediction) {
          void recordPredictiveEvent({
            requestId,
            workspaceId: auth.workspaceId,
            predictorVersion: prediction.predictorVersion,
            mode: 'observation',
            predictedTaskClass: prediction.predictedTaskClass,
            actualTaskClass: taskClass,
            predictedModel: prediction.predictedModel,
            authoritativeModel: cand.slug,
            committedModel: cand.slug,
            predictionConfidence: prediction.confidence,
            predictionCorrect: prediction.predictedModel === cand.slug,
            speculationStarted: false,
            loserCancelled: false,
            commitReason: 'observation',
            routingOverheadMs: preUpstreamMs,
            estimatedStandardOverheadMs: null,
            predictorLatencyMs: prediction.predictorLatencyMs,
            speculationWasteUsd: 0,
          });
        }
        return reply;
      }

      // ---- Non-streaming ----
      try {
        const { json, usage } = await adapter.chat(cand.upstreamModel, upstreamBody, providerKey);
        trace.chosen = cand.slug;
        trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'success' });
        const choice0 = (
          json.choices as
            | Array<{ message?: { content?: unknown }; finish_reason?: unknown }>
            | undefined
        )?.[0];
        const completionText =
          typeof choice0?.message?.content === 'string' ? choice0.message.content : '';
        const finishReason =
          typeof choice0?.finish_reason === 'string' ? choice0.finish_reason : null;
        const cost = await recordUsage({
          ...billBase,
          status: 'success',
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cachedTokens: usage.cachedTokens,
          reasoningTokens: usage.reasoningTokens,
          finishReason,
          latencyMs: Date.now() - started,
          routingTrace: trace,
        });
        void emitObservability({
          config: obsConfig,
          workspaceId: auth.workspaceId,
          apiKeyId: auth.apiKeyId,
          requestId,
          modelSlug: cand.slug,
          providerSlug: cand.providerSlug,
          taskClass,
          messages,
          completion: completionText,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: cost,
          latencyMs: Date.now() - started,
        });
        void runClassifiersForRequest({
          workspaceId: auth.workspaceId,
          orgId: auth.orgId,
          requestId,
          messages,
          completion: completionText,
        });
        void maybeLowBalanceAlert(auth.orgId, auth.workspaceId);
        if (prediction) {
          void recordPredictiveEvent({
            requestId,
            workspaceId: auth.workspaceId,
            predictorVersion: prediction.predictorVersion,
            mode: 'observation',
            predictedTaskClass: prediction.predictedTaskClass,
            actualTaskClass: taskClass,
            predictedModel: prediction.predictedModel,
            authoritativeModel: cand.slug,
            committedModel: cand.slug,
            predictionConfidence: prediction.confidence,
            predictionCorrect: prediction.predictedModel === cand.slug,
            speculationStarted: false,
            loserCancelled: false,
            commitReason: 'observation',
            routingOverheadMs: preUpstreamMs,
            estimatedStandardOverheadMs: null,
            predictorLatencyMs: prediction.predictorLatencyMs,
            speculationWasteUsd: 0,
          });
        }
        if (cacheEnabled) {
          void storeCache({
            workspaceId: auth.workspaceId,
            orgId: auth.orgId,
            messages,
            taskClass,
            response: json,
            model: cand.slug,
            provider: cand.providerSlug,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            embedding: cacheEmbedding,
          });
        }
        const enriched = {
          ...json,
          model: cand.slug,
          usage: { ...(json.usage as object | undefined), cost },
          _routing: {
            task: taskClass,
            mode: trace.mode,
            chosen: cand.slug,
            provider: cand.providerSlug,
            attempts: trace.attempts.length,
            ...(prediction
              ? {
                  prediction: prediction.predictedModel,
                  predictionConfidence: Number(prediction.confidence.toFixed(4)),
                  predictionCorrect: prediction.predictedModel === cand.slug,
                  speculationStarted: false,
                }
              : {}),
          },
        };
        return reply.send(enriched);
      } catch (err) {
        lastErr = err as Error & { status?: number };
        trace.attempts.push({ slug: cand.slug, providerSlug: cand.providerSlug, result: 'error', reason: (err as Error).message });
        continue;
      }
    }

    // All candidates failed or were skipped.
    const first = candidates[0]!;
    await recordUsage({
      requestId,
      workspaceId: auth.workspaceId,
      apiKeyId: auth.apiKeyId,
      orgId: auth.orgId,
      modelSlug: first.slug,
      providerSlug: first.providerSlug,
      taskClass,
      promptPricePerM: '0',
      completionPricePerM: '0',
      status: 'error',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - started,
      routingTrace: trace,
    });
    return reply.code(lastErr?.status ?? 502).send({
      error: { message: lastErr?.message ?? 'All routing candidates failed.', type: 'upstream_error' },
      _routing: trace,
    });
  });
}
