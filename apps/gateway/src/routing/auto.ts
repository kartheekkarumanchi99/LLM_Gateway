import { matchesAnyPattern, type GuardrailPolicies } from '@llmgw/db';
import { checkModelAccess } from '../guardrails/enforce';
import type { ChatMessage } from '../providers/types';
import { approxPromptTokens, classifyTask } from './classify';
import { getExecutableModels, getOwnSignal, getPriorSignal } from './data';
import { rankCandidates } from './score';
import type { CostTier, RankedCandidate, TaskClass } from './types';

export interface AutoRouteResult {
  taskClass: TaskClass;
  ranked: RankedCandidate[];
  alpha: number;
  ownRequests: number;
}

// Model router: classify → candidate pool (hard constraints) → blended-signal ranking.
export async function autoRoute(opts: {
  messages: ChatMessage[];
  costTier: CostTier;
  maxTokens: number;
  guardrail: GuardrailPolicies | null;
  allowedModels: string[];
}): Promise<AutoRouteResult> {
  const taskClass = classifyTask(opts.messages);
  const estPromptTokens = approxPromptTokens(opts.messages);

  let pool = await getExecutableModels();
  // Hard constraints: capability (context window) + guardrail model access.
  pool = pool.filter((m) => m.contextLength >= estPromptTokens + 256);
  if (opts.guardrail) {
    const g = opts.guardrail;
    pool = pool.filter((m) => checkModelAccess(g, m.slug, m.providerSlug).allowed);
  }
  // Workspace allowed-model patterns (empty list = allow all).
  pool = pool.filter((m) => matchesAnyPattern(m.slug, opts.allowedModels));
  if (pool.length === 0) {
    return { taskClass, ranked: [], alpha: 0, ownRequests: 0 };
  }

  const [ownSignal, prior] = await Promise.all([getOwnSignal(taskClass), getPriorSignal(taskClass)]);
  const { ranked, alpha, ownRequests } = rankCandidates({
    models: pool,
    ownSignal,
    prior,
    estPromptTokens,
    estCompletionTokens: opts.maxTokens,
    costTier: opts.costTier,
  });
  return { taskClass, ranked, alpha, ownRequests };
}
