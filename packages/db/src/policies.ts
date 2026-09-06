// Guardrail policy contract shared by the web app (writes) and gateway (enforces).

export type PolicyMode = 'off' | 'flag' | 'block';

export interface BudgetPolicy {
  limitUsd: number | null;
  interval: 'day' | 'week' | 'month' | 'total';
  includeByok: boolean;
}

export interface ModelAccessPolicy {
  restrictionMode: 'allow_all_except' | 'block_all_except';
  blockedProviders: string[];
  allowedProviders: string[];
  blockedModels: string[];
  allowedModels: string[];
  zdr: { nonFrontier: boolean; anthropic: boolean; openai: boolean; google: boolean; spacexai: boolean };
  training: { allowPaidTrain: boolean; allowFreeTrain: boolean; allowFreePublish: boolean };
  restrictRegions: boolean;
}

export interface GuardrailPolicies {
  budget?: BudgetPolicy;
  modelAccess?: ModelAccessPolicy;
  promptInjection?: PolicyMode;
  sensitiveInfo?: PolicyMode;
}

export const EMPTY_MODEL_ACCESS: ModelAccessPolicy = {
  restrictionMode: 'allow_all_except',
  blockedProviders: [],
  allowedProviders: [],
  blockedModels: [],
  allowedModels: [],
  zdr: { nonFrontier: false, anthropic: false, openai: false, google: false, spacexai: false },
  training: { allowPaidTrain: false, allowFreeTrain: true, allowFreePublish: false },
  restrictRegions: false,
};

// Count of configured policy sections (for list/detail summaries).
export function countConfiguredPolicies(p: GuardrailPolicies | null | undefined): number {
  if (!p) return 0;
  let n = 0;
  if (p.budget?.limitUsd) n++;
  if (
    p.modelAccess &&
    (p.modelAccess.blockedProviders.length ||
      p.modelAccess.blockedModels.length ||
      p.modelAccess.allowedProviders.length ||
      p.modelAccess.allowedModels.length ||
      p.modelAccess.restrictionMode === 'block_all_except')
  ) {
    n++;
  }
  if (p.promptInjection && p.promptInjection !== 'off') n++;
  if (p.sensitiveInfo && p.sensitiveInfo !== 'off') n++;
  return n;
}
