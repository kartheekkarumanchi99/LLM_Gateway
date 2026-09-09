import { and, eq, inArray, like, notLike, sql } from 'drizzle-orm';
import { getHttpDb, models, usageEvents, workspaces } from '@llmgw/db/http';
import { qualityOf } from './model-quality';
import type {
  AttributionSource,
  BaselineComparison,
  CacheAnalytics,
  EfficiencyRow,
  FinOpsData,
  ModelRow,
  ProviderRow,
  TaskRow,
  WorkflowStat,
} from './finops-types';

const BASELINE_SLUGS = ['openai/gpt-4o', 'openai/gpt-4-turbo', 'anthropic/claude-3-5-sonnet'];
const PRIMARY_BASELINE = 'openai/gpt-4o';

interface Price {
  slug: string;
  name: string;
  pin: number;
  pout: number;
}

interface PrimaryRow {
  model: string;
  provider: string;
  cached: boolean;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  actualUsd: number;
  latencySum: number;
}

interface LegRow {
  requestId: string;
  model: string;
  provider: string;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  latency: number;
  status: string;
}

const tok = (r: { promptTokens: number; completionTokens: number }) =>
  r.promptTokens + r.completionTokens;

function baselineCost(promptTokens: number, completionTokens: number, p: Price): number {
  return (promptTokens / 1_000_000) * p.pin + (completionTokens / 1_000_000) * p.pout;
}

export async function getFinOps(orgId: string): Promise<FinOpsData | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const db = getHttpDb();
    const orgFilter = eq(workspaces.orgId, orgId);
    const success = eq(usageEvents.status, 'success');
    const primary = notLike(usageEvents.requestId, '%#%');

    const [priceRowsRaw, primaryRaw, legRaw, taskRaw, cacheKindRaw, statusRaw] = await Promise.all([
      db
        .select({
          slug: models.slug,
          name: models.displayName,
          pin: models.promptPricePerM,
          pout: models.completionPricePerM,
        })
        .from(models)
        .where(inArray(models.slug, BASELINE_SLUGS)),
      db
        .select({
          model: usageEvents.modelSlug,
          provider: usageEvents.providerSlug,
          cached: usageEvents.cached,
          requests: sql<number>`count(*)::int`,
          promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)::bigint`,
          completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)::bigint`,
          actualUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}),0)::float8`,
          latencySum: sql<number>`coalesce(sum(${usageEvents.latencyMs}),0)::bigint`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(and(orgFilter, success, primary))
        .groupBy(usageEvents.modelSlug, usageEvents.providerSlug, usageEvents.cached),
      db
        .select({
          requestId: usageEvents.requestId,
          model: usageEvents.modelSlug,
          provider: usageEvents.providerSlug,
          cost: sql<number>`coalesce(${usageEvents.costUsd},0)::float8`,
          promptTokens: usageEvents.promptTokens,
          completionTokens: usageEvents.completionTokens,
          latency: usageEvents.latencyMs,
          status: usageEvents.status,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(and(orgFilter, like(usageEvents.requestId, '%#%'))),
      db
        .select({
          task: usageEvents.taskClass,
          model: usageEvents.modelSlug,
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(and(orgFilter, success, primary))
        .groupBy(usageEvents.taskClass, usageEvents.modelSlug),
      db
        .select({
          kind: sql<string>`coalesce(${usageEvents.routingTrace} ->> 'cacheKind', 'exact')`,
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(and(orgFilter, success, eq(usageEvents.cached, true)))
        .groupBy(sql`coalesce(${usageEvents.routingTrace} ->> 'cacheKind', 'exact')`),
      db
        .select({
          orch: sql<number>`case when ${usageEvents.requestId} like '%#%' then 1 else 0 end`,
          status: usageEvents.status,
          n: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .innerJoin(workspaces, eq(usageEvents.workspaceId, workspaces.id))
        .where(orgFilter)
        .groupBy(sql`case when ${usageEvents.requestId} like '%#%' then 1 else 0 end`, usageEvents.status),
    ]);

    const prices: Price[] = priceRowsRaw.map((p) => ({
      slug: p.slug,
      name: p.name,
      pin: Number(p.pin),
      pout: Number(p.pout),
    }));
    const priceMap = new Map(prices.map((p) => [p.slug, p]));
    const gpt4o = priceMap.get(PRIMARY_BASELINE) ?? prices[0];
    if (!gpt4o) return null;

    const primaryRows: PrimaryRow[] = primaryRaw.map((r) => ({
      model: r.model,
      provider: r.provider,
      cached: Boolean(r.cached),
      requests: Number(r.requests),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
      actualUsd: Number(r.actualUsd),
      latencySum: Number(r.latencySum),
    }));
    const legRows: LegRow[] = legRaw.map((r) => ({
      requestId: r.requestId,
      model: r.model,
      provider: r.provider,
      cost: Number(r.cost),
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      latency: r.latency,
      status: r.status,
    }));

    // ---- Totals + token-weighted quality over primary traffic ----
    const totalPrimaryRequests = primaryRows.reduce((a, r) => a + r.requests, 0);
    const totalTokens = primaryRows.reduce((a, r) => a + tok(r), 0);
    const actualUsd = primaryRows.reduce((a, r) => a + r.actualUsd, 0);
    let qNum = 0;
    let qDen = 0;
    for (const r of primaryRows) {
      qNum += tok(r) * qualityOf(r.model);
      qDen += tok(r);
    }
    const weightedQ = qDen > 0 ? qNum / qDen : qualityOf(PRIMARY_BASELINE);

    const baselineTotal = (p: Price) =>
      primaryRows.reduce((a, r) => a + baselineCost(r.promptTokens, r.completionTokens, p), 0);

    // ---- Per-baseline comparisons (quality vs cost hero) ----
    const comparisons: BaselineComparison[] = BASELINE_SLUGS.filter((s) => priceMap.has(s)).map(
      (s) => {
        const p = priceMap.get(s)!;
        const base = baselineTotal(p);
        const costFraction = base > 0 ? actualUsd / base : 1;
        const qRet = (weightedQ / qualityOf(s)) * 100;
        return {
          slug: s,
          name: p.name,
          baselineUsd: base,
          costReductionPct: (1 - costFraction) * 100,
          qualityRetentionPct: qRet,
          valueEfficiency: costFraction > 0 ? qRet / 100 / costFraction : 0,
        };
      },
    );
    const primaryCmp = comparisons.find((c) => c.slug === PRIMARY_BASELINE) ?? comparisons[0];
    const gpt4oBaseline = baselineTotal(gpt4o);

    // ---- Savings attribution ----
    const cacheSavings = primaryRows
      .filter((r) => r.cached)
      .reduce((a, r) => a + baselineCost(r.promptTokens, r.completionTokens, gpt4o) - r.actualUsd, 0);
    const routingSavings = primaryRows
      .filter((r) => !r.cached)
      .reduce((a, r) => a + baselineCost(r.promptTokens, r.completionTokens, gpt4o) - r.actualUsd, 0);
    const orchestrationSavings = legRows.reduce(
      (a, r) => a + baselineCost(r.promptTokens, r.completionTokens, gpt4o) - r.cost,
      0,
    );
    const totalSaved = Math.max(0, cacheSavings + routingSavings + orchestrationSavings);
    const attribution: AttributionSource[] = [
      { key: 'routing', label: 'Intelligent routing', usd: Math.max(0, routingSavings) },
      { key: 'cache', label: 'Semantic + exact cache', usd: Math.max(0, cacheSavings) },
      { key: 'workflows', label: 'Orchestration workflows', usd: Math.max(0, orchestrationSavings) },
    ]
      .map((s) => ({ ...s, pct: totalSaved > 0 ? (s.usd / totalSaved) * 100 : 0 }))
      .sort((a, b) => b.usd - a.usd);

    // ---- Cache analytics ----
    const cacheHits = primaryRows.filter((r) => r.cached).reduce((a, r) => a + r.requests, 0);
    const cacheMiss = primaryRows.filter((r) => !r.cached).reduce((a, r) => a + r.requests, 0);
    const semanticHits = cacheKindRaw
      .filter((r) => String(r.kind).includes('semantic'))
      .reduce((a, r) => a + Number(r.requests), 0);
    const exactHits = Math.max(0, cacheHits - semanticHits);
    const cache: CacheAnalytics = {
      hitRatePct: cacheHits + cacheMiss > 0 ? (cacheHits / (cacheHits + cacheMiss)) * 100 : 0,
      hits: cacheHits,
      misses: cacheMiss,
      savingsUsd: Math.max(0, cacheSavings),
      exactHits,
      semanticHits,
    };

    // ---- Model intelligence ----
    const modelAgg = new Map<string, ModelRow>();
    for (const r of primaryRows) {
      const m = modelAgg.get(r.model) ?? {
        slug: r.model,
        provider: r.provider,
        requests: 0,
        tokens: 0,
        costUsd: 0,
        quality: qualityOf(r.model),
        sharePct: 0,
      };
      m.requests += r.requests;
      m.tokens += tok(r);
      m.costUsd += r.actualUsd;
      modelAgg.set(r.model, m);
    }
    const topModels = [...modelAgg.values()]
      .map((m) => ({ ...m, sharePct: totalPrimaryRequests > 0 ? (m.requests / totalPrimaryRequests) * 100 : 0 }))
      .sort((a, b) => b.requests - a.requests);
    const usedSlugs = new Set(topModels.map((m) => m.slug));
    const modelsAvoided = BASELINE_SLUGS.filter((s) => !usedSlugs.has(s)).map((s) => ({
      slug: s,
      quality: qualityOf(s),
    }));

    const provAgg = new Map<string, ProviderRow>();
    for (const m of topModels) {
      const p = provAgg.get(m.provider) ?? { provider: m.provider, requests: 0, costUsd: 0, sharePct: 0 };
      p.requests += m.requests;
      p.costUsd += m.costUsd;
      provAgg.set(m.provider, p);
    }
    const providers = [...provAgg.values()]
      .map((p) => ({ ...p, sharePct: totalPrimaryRequests > 0 ? (p.requests / totalPrimaryRequests) * 100 : 0 }))
      .sort((a, b) => b.requests - a.requests);

    // ---- Routing transparency (task types + consistency) ----
    const taskAgg = new Map<string, { requests: number; byModel: Map<string, number> }>();
    for (const r of taskRaw) {
      const key = r.task ?? 'chat';
      const t = taskAgg.get(key) ?? { requests: 0, byModel: new Map() };
      t.requests += Number(r.requests);
      t.byModel.set(r.model, (t.byModel.get(r.model) ?? 0) + Number(r.requests));
      taskAgg.set(key, t);
    }
    const tasks: TaskRow[] = [...taskAgg.entries()]
      .map(([task, t]) => {
        const top = [...t.byModel.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          task,
          requests: t.requests,
          topModel: top?.[0] ?? '—',
          topModelSharePct: top && t.requests > 0 ? (top[1] / t.requests) * 100 : 0,
        };
      })
      .sort((a, b) => b.requests - a.requests);
    const routingConsistencyPct =
      tasks.reduce((a, t) => a + t.topModelSharePct * t.requests, 0) /
      Math.max(1, tasks.reduce((a, t) => a + t.requests, 0));

    // ---- Workflow analytics ----
    const primaryStatus = statusRaw.filter((s) => Number(s.orch) === 0);
    const primaryTotalAll = primaryStatus.reduce((a, s) => a + Number(s.n), 0);
    const primarySuccessAll = primaryStatus
      .filter((s) => s.status === 'success')
      .reduce((a, s) => a + Number(s.n), 0);
    const singleSuccessRate = primaryTotalAll > 0 ? (primarySuccessAll / primaryTotalAll) * 100 : 100;

    // Group orchestration legs by base request id.
    const bases = new Map<string, LegRow[]>();
    for (const l of legRows) {
      const base = l.requestId.split('#')[0]!;
      (bases.get(base) ?? bases.set(base, []).get(base)!).push(l);
    }
    const roleOf = (l: LegRow) => l.requestId.split('#')[1] ?? '';
    type Pattern = 'cascade' | 'critique' | 'bestofn' | 'decompose';
    const patternOf = (legs: LegRow[]): Pattern | null => {
      const roles = legs.map(roleOf);
      if (roles.some((r) => r === 'plan' || r === 'compose' || r.startsWith('subtask_'))) return 'decompose';
      if (roles.some((r) => r === 'gate')) return 'cascade';
      if (roles.some((r) => r === 'critic' || r === 'revise')) return 'critique';
      if (roles.some((r) => r === 'judge' || r.startsWith('candidate_'))) return 'bestofn';
      return null;
    };

    const wf: Record<Pattern, LegRow[][]> = { cascade: [], critique: [], bestofn: [], decompose: [] };
    for (const legs of bases.values()) {
      const p = patternOf(legs);
      if (p) wf[p].push(legs);
    }

    const buildWorkflow = (key: Pattern, label: string): WorkflowStat => {
      const groups = wf[key];
      const requests = groups.length;
      const allLegs = groups.flat();
      const totalCost = allLegs.reduce((a, l) => a + l.cost, 0);
      const savings = allLegs.reduce(
        (a, l) => a + baselineCost(l.promptTokens, l.completionTokens, gpt4o) - l.cost,
        0,
      );
      // Cascade/critique are sequential (sum leg latency); best-of-N is parallel;
      // decompose is plan + parallel subtasks + compose.
      const latencyPerReq = groups.map((legs) => {
        if (key === 'bestofn') return Math.max(0, ...legs.map((l) => l.latency));
        if (key === 'decompose') {
          const overhead = legs
            .filter((l) => roleOf(l) === 'plan' || roleOf(l) === 'compose' || roleOf(l) === 'final')
            .reduce((a, l) => a + l.latency, 0);
          const subtaskMax = Math.max(
            0,
            ...legs.filter((l) => roleOf(l).startsWith('subtask_')).map((l) => l.latency),
          );
          return overhead + subtaskMax;
        }
        return legs.reduce((a, l) => a + l.latency, 0);
      });
      const avgLatency =
        latencyPerReq.length > 0 ? latencyPerReq.reduce((a, b) => a + b, 0) / latencyPerReq.length : 0;
      const okLegs = allLegs.filter((l) => l.status === 'success').length;
      const successRate = allLegs.length > 0 ? (okLegs / allLegs.length) * 100 : 100;

      const stat: WorkflowStat = {
        key,
        label,
        requests,
        avgCostUsd: requests > 0 ? totalCost / requests : 0,
        avgLatencyMs: avgLatency,
        successRatePct: successRate,
        savingsUsd: Math.max(0, savings),
        estQualityDelta: key === 'critique' ? 4 : key === 'bestofn' ? 5 : key === 'decompose' ? 6 : 0,
      };
      if (key === 'cascade') {
        const escalated = groups.filter((legs) => legs.some((l) => roleOf(l) === 'final')).length;
        stat.escalationRatePct = requests > 0 ? (escalated / requests) * 100 : 0;
        stat.acceptanceRatePct = requests > 0 ? ((requests - escalated) / requests) * 100 : 0;
        stat.estQualityDelta = 0;
      }
      if (key === 'bestofn') {
        const branchCounts = groups.map((legs) => legs.filter((l) => roleOf(l).startsWith('candidate_')).length);
        stat.avgBranchCount =
          branchCounts.length > 0 ? branchCounts.reduce((a, b) => a + b, 0) / branchCounts.length : 0;
        const judged = groups.filter((legs) => legs.some((l) => roleOf(l) === 'judge')).length;
        stat.judgeSelectionRatePct = requests > 0 ? (judged / requests) * 100 : 0;
      }
      if (key === 'critique') {
        stat.revisionImprovementRatePct = null; // not measured live
      }
      if (key === 'decompose') {
        const counts = groups.map((legs) => legs.filter((l) => roleOf(l).startsWith('subtask_')).length);
        stat.subtaskAvg = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
      }
      return stat;
    };

    const singleRows = primaryRows.filter((r) => !r.cached);
    const singleRequests = singleRows.reduce((a, r) => a + r.requests, 0);
    const singleCost = singleRows.reduce((a, r) => a + r.actualUsd, 0);
    const singleLatency = singleRows.reduce((a, r) => a + r.latencySum, 0);
    const singleWorkflow: WorkflowStat = {
      key: 'single',
      label: 'Single (auto-route)',
      requests: singleRequests,
      avgCostUsd: singleRequests > 0 ? singleCost / singleRequests : 0,
      avgLatencyMs: singleRequests > 0 ? singleLatency / singleRequests : 0,
      successRatePct: singleSuccessRate,
      savingsUsd: Math.max(0, routingSavings),
      estQualityDelta: 0,
    };

    const workflows: WorkflowStat[] = [
      singleWorkflow,
      buildWorkflow('cascade', 'Cascade'),
      buildWorkflow('critique', 'Critique'),
      buildWorkflow('bestofn', 'Best-of-N'),
      buildWorkflow('decompose', 'Decompose'),
    ];

    // ---- Value efficiency chart ----
    const blended = (p: Price) => (p.pin + p.pout) / 2;
    const gpt4oBlend = blended(gpt4o) || 1;
    const efficiency: EfficiencyRow[] = [];
    for (const s of BASELINE_SLUGS) {
      const p = priceMap.get(s);
      if (!p) continue;
      const costFraction = blended(p) / gpt4oBlend;
      efficiency.push({
        label: p.name,
        quality: qualityOf(s),
        costFraction,
        efficiency: costFraction > 0 ? qualityOf(s) / 100 / costFraction : 0,
        current: false,
      });
    }
    const platformCostFraction = gpt4oBaseline > 0 ? actualUsd / gpt4oBaseline : 0.05;
    efficiency.push({
      label: 'This platform',
      quality: weightedQ,
      costFraction: platformCostFraction,
      efficiency: platformCostFraction > 0 ? weightedQ / 100 / platformCostFraction : 0,
      current: true,
    });

    const orchestrationBaseCount = bases.size;

    return {
      primaryBaseline: PRIMARY_BASELINE,
      costReductionPct: primaryCmp?.costReductionPct ?? 0,
      qualityRetainedPct: primaryCmp?.qualityRetentionPct ?? weightedQ,
      valueEfficiency: primaryCmp?.valueEfficiency ?? 0,
      totalSavedUsd: totalSaved,
      totalRequests: totalPrimaryRequests + orchestrationBaseCount,
      totalTokens,
      actualUsd,
      costFractionPct: gpt4oBaseline > 0 ? (actualUsd / gpt4oBaseline) * 100 : 0,
      comparisons,
      attribution,
      workflows,
      cache,
      topModels: topModels.slice(0, 6),
      modelsAvoided,
      providers,
      tasks,
      efficiency,
      avgModelQuality: weightedQ,
      routingConsistencyPct,
    };
  } catch (err) {
    console.error('[finops] getFinOps failed:', (err as Error).message);
    return null;
  }
}
