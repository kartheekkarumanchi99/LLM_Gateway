import type { GuardrailPolicies } from '@llmgw/db';
import type { ChatMessage } from '../providers/types';

export function checkModelAccess(
  policies: GuardrailPolicies,
  modelSlug: string,
  providerSlug: string,
): { allowed: boolean; reason?: string } {
  const ma = policies.modelAccess;
  if (!ma) return { allowed: true };

  if (ma.restrictionMode === 'block_all_except') {
    const providerOk = ma.allowedProviders.includes(providerSlug);
    const modelOk = ma.allowedModels.includes(modelSlug);
    if (!providerOk && !modelOk) {
      return { allowed: false, reason: `Model \`${modelSlug}\` is not in the allow-list.` };
    }
    return { allowed: true };
  }

  if (ma.blockedProviders.includes(providerSlug)) {
    return { allowed: false, reason: `Provider \`${providerSlug}\` is blocked by guardrail.` };
  }
  if (ma.blockedModels.includes(modelSlug)) {
    return { allowed: false, reason: `Model \`${modelSlug}\` is blocked by guardrail.` };
  }
  return { allowed: true };
}

// Heuristic detectors (regex-based, not ML). Honest, deterministic, real enforcement.
const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { name: 'credit_card', re: /\b(?:\d[ -]?){13,16}\b/ },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'secret_key', re: /\b(sk-[a-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/i },
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the |any )?(previous|above|prior) (instructions|prompts?)/i,
  /disregard (the |all |your )?(previous|above|system)/i,
  /you are now (?:a|an|the)?\s*[a-z]/i,
  /reveal (your |the )?(system prompt|instructions|prompt)/i,
  /pretend (to be|you are)/i,
];

function messagesToText(messages: ChatMessage[]): string {
  return messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

export function detectSensitive(text: string): string[] {
  return PII_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

export function checkContent(
  policies: GuardrailPolicies,
  messages: ChatMessage[],
): { block: boolean; flags: string[]; reason?: string } {
  const flags: string[] = [];
  let block = false;
  let reason: string | undefined;
  const text = messagesToText(messages);

  if (policies.sensitiveInfo && policies.sensitiveInfo !== 'off') {
    const hits = detectSensitive(text);
    if (hits.length) {
      flags.push(...hits.map((h) => `pii:${h}`));
      if (policies.sensitiveInfo === 'block') {
        block = true;
        reason = `Blocked: sensitive info detected (${hits.join(', ')}).`;
      }
    }
  }

  if (policies.promptInjection && policies.promptInjection !== 'off') {
    if (detectInjection(text)) {
      flags.push('prompt_injection');
      if (policies.promptInjection === 'block') {
        block = true;
        reason = reason ?? 'Blocked: prompt injection detected.';
      }
    }
  }

  return { block, flags, reason };
}
