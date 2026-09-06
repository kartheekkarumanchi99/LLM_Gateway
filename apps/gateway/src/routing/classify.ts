import type { ChatMessage } from '../providers/types';
import type { TaskClass } from './types';

function extract(messages: ChatMessage[]): { text: string; hasImage: boolean; approxTokens: number } {
  let text = '';
  let hasImage = false;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      text += '\n' + m.content;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Array<Record<string, unknown>>) {
        if (part?.type === 'text' && typeof part.text === 'string') text += '\n' + part.text;
        else if (part?.type === 'image_url' || part?.type === 'image') hasImage = true;
      }
    } else if (m.content != null) {
      text += '\n' + JSON.stringify(m.content);
    }
  }
  return { text, hasImage, approxTokens: Math.ceil(text.length / 4) };
}

const CODE =
  /```|\bfunction\b|\bclass\b|\bdef\b|\bimport\b|\bSELECT\b|\brust\b|\btypescript\b|\bpython\b|\bcompile\b|stack ?trace|\bbug\b|\berror\b|\bregex\b|\balgorithm\b/i;
const REASONING =
  /\bprove\b|theorem|step[- ]by[- ]step|\breason(ing)?\b|\banalyze\b|\bdesign (a|an|the)\b|architecture|consensus|distributed|\bwhy\b|trade[- ]?off/i;
const SUMMARIZE = /summar|tl;?dr|shorten|key points|abstract of|condense/i;
const EXTRACT = /\bextract\b|convert .*(json|yaml|csv)|\bparse\b|\bclassif|structured output|schema/i;
const CREATIVE = /write (a|an) (poem|story|essay|song)|creative|brainstorm|\bfiction\b|screenplay/i;

// Fast, deterministic heuristic classifier. Cached upstream by prompt hash.
export function classifyTask(messages: ChatMessage[]): TaskClass {
  const { text, hasImage, approxTokens } = extract(messages);
  if (hasImage) return 'vision';
  if (approxTokens > 100_000) return 'long_context';
  if (CODE.test(text)) return 'code';
  if (REASONING.test(text)) return 'reasoning';
  if (EXTRACT.test(text)) return 'extraction';
  if (SUMMARIZE.test(text)) return 'summarization';
  if (CREATIVE.test(text)) return 'creative';
  return 'chat';
}

export function approxPromptTokens(messages: ChatMessage[]): number {
  return extract(messages).approxTokens;
}
