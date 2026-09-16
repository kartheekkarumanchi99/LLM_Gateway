import type { ChatMessage } from '../providers/types';

// PII redaction for shadow samples. Mirrors the guardrail detectors in guardrails/enforce.ts
// but with global regexes so every occurrence is replaced with a typed placeholder before a
// scrubbed copy of the prompt is ever persisted or sent to a candidate model.
const REDACTORS: { re: RegExp; token: string }[] = [
  { re: /\b(sk-[a-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/gi, token: '[REDACTED_SECRET]' },
  { re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, token: '[REDACTED_EMAIL]' },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, token: '[REDACTED_SSN]' },
  { re: /\b(?:\d[ -]?){13,16}\b/g, token: '[REDACTED_CARD]' },
  // Long digit runs (phone numbers, account ids) after the structured detectors above.
  { re: /\b\d{7,}\b/g, token: '[REDACTED_NUMBER]' },
];

export function scrubText(text: string): { text: string; redacted: boolean } {
  let out = text;
  let redacted = false;
  for (const r of REDACTORS) {
    if (r.re.test(out)) {
      redacted = true;
      out = out.replace(r.re, r.token);
    }
    r.re.lastIndex = 0;
  }
  return { text: out, redacted };
}

// Returns a scrubbed deep copy of the messages (string content only) plus whether anything
// was redacted. Non-string content (tool/image parts) is dropped from the scrubbed copy to
// avoid leaking un-inspectable payloads into the shadow store.
export function scrubMessages(messages: ChatMessage[]): { messages: ChatMessage[]; redacted: boolean } {
  let redacted = false;
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (typeof m.content !== 'string') {
      out.push({ role: m.role, content: '[non-text content omitted]' });
      continue;
    }
    const s = scrubText(m.content);
    if (s.redacted) redacted = true;
    out.push({ role: m.role, content: s.text });
  }
  return { messages: out, redacted };
}
