'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Send, Sparkles, User } from 'lucide-react';
import { sendChat } from '@/lib/chat-actions';
import { formatTokens } from '@/lib/format';
import type { ChatMessage, ChatMeta, ChatResult } from '@/lib/chat-types';
import type { RunnableModel } from '@/lib/catalog-types';

interface Item {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  meta?: ChatMeta;
  error?: boolean;
}

type OrchestrationMode = 'single' | 'cascade' | 'critique' | 'bestofn';

const COST_TIERS = ['low', 'medium', 'high', 'max'];

const EXAMPLES = [
  'Explain how HTTPS keeps data secure',
  'Write a haiku about the ocean',
  'Difference between TCP and UDP',
  'Three dinner ideas with chicken',
];

function fmtCost(c: number): string {
  if (c <= 0) return '$0';
  if (c < 0.0001) return '<$0.0001';
  return '$' + c.toFixed(c < 0.01 ? 6 : 4);
}
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  return (ms / 1000).toFixed(1) + 's';
}

export function ChatView({ models }: { models: RunnableModel[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('auto');
  const [costTier, setCostTier] = useState('medium');
  const [mode, setMode] = useState<OrchestrationMode>('single');
  const [pending, setPending] = useState(false);
  const idRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const userItem: Item = { id: ++idRef.current, role: 'user', content };
    const convo: ChatMessage[] = [...items.filter((i) => !i.error), userItem].map((i) => ({
      role: i.role,
      content: i.content,
    }));
    setItems((prev) => [...prev, userItem]);
    setInput('');
    setPending(true);
    const res: ChatResult = await sendChat({
      messages: convo,
      model,
      costTier,
      orchestrate: mode === 'single' ? undefined : mode,
    });
    setPending(false);
    setItems((prev) => [
      ...prev,
      res.error
        ? { id: ++idRef.current, role: 'assistant', content: res.error, error: true }
        : { id: ++idRef.current, role: 'assistant', content: res.content, meta: res },
    ]);
  }

  const modelLabel = model === 'auto' ? 'Auto Router' : model;

  return (
    <div className="flex h-[calc(100vh_-_8rem)] flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 pb-3">
        <div className="relative">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-gray-800 outline-none focus:border-violet-500"
          >
            <option value="auto">Auto Router</option>
            {models.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.slug}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>

        <div className="relative">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as OrchestrationMode)}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 outline-none focus:border-violet-500"
            title="Workflow: Single routes to one model; Cascade drafts cheap then escalates on a quality gate; Critique drafts, reviews, and revises; Best-of-N runs several cheap models in parallel and a judge picks the winner."
          >
            <option value="single">Single</option>
            <option value="cascade">Cascade</option>
            <option value="critique">Critique</option>
            <option value="bestofn">Best-of-N</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>

        {model === 'auto' ? (
          <div className="relative">
            <select
              value={costTier}
              onChange={(e) => setCostTier(e.target.value)}
              className="appearance-none rounded-lg border border-gray-300 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 outline-none focus:border-violet-500"
              title="Cost tier for auto-routing"
            >
              {COST_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t} cost
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          </div>
        ) : null}

        <div className="ml-auto">
          <button
            onClick={() => setItems([])}
            disabled={items.length === 0}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            New chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        {items.length === 0 ? (
          <div className="mx-auto max-w-xl pt-10 text-center">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-violet-100 text-violet-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Ask anything</h2>
            <p className="mt-1 text-sm text-gray-500">
              Routed through your gateway. Pick a model or let the Auto Router choose.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {items.map((item) =>
              item.role === 'user' ? (
                <div key={item.id} className="flex justify-end">
                  <div className="flex max-w-[80%] items-start gap-2">
                    <div className="rounded-2xl rounded-tr-sm bg-violet-600 px-4 py-2 text-sm text-white">
                      {item.content}
                    </div>
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gray-200 text-gray-500">
                      <User className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              ) : (
                <AssistantMessage key={item.id} item={item} />
              ),
            )}
            {pending ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-100 text-violet-600">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="animate-pulse">Thinking…</span>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-gray-200 pt-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white p-2 focus-within:border-violet-500">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Ask anything…"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            />
            <button
              onClick={() => void send(input)}
              disabled={pending || !input.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-gray-400">
            Using {modelLabel}. Responses are AI-generated and can be inaccurate.
          </p>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const meta = item.meta;

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-600">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={
            'whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-2 text-sm ' +
            (item.error ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-800')
          }
        >
          {item.content}
        </div>

        {meta ? (
          <div className="mt-1.5">
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600"
            >
              <span>{fmtCost(meta.cost)}</span>
              <span>·</span>
              <span>{formatTokens(meta.completionTokens)} tok</span>
              <span>·</span>
              <span>{fmtDuration(meta.durationMs)}</span>
              {meta.provider ? (
                <>
                  <span>·</span>
                  <span>{meta.provider}</span>
                </>
              ) : null}
              <ChevronDown className={'h-3 w-3 transition ' + (open ? 'rotate-180' : '')} />
            </button>

            {open ? (
              <div className="mt-2 space-y-2">
                <dl className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-gray-200 bg-white p-3 text-xs">
                  <Row label="Model" value={meta.model} />
                  <Row label="Provider" value={meta.provider ?? '\u2014'} />
                  <Row label="Strategy" value={meta.mode ?? '\u2014'} />
                  <Row label="Task class" value={meta.task ?? '\u2014'} />
                  <Row label="Tokens / sec" value={meta.tokensPerSec > 0 ? meta.tokensPerSec.toFixed(1) : '\u2014'} />
                  <Row label="Token count" value={`${meta.totalTokens} (${meta.promptTokens}+${meta.completionTokens})`} />
                  <Row label="Cost" value={fmtCost(meta.cost)} />
                  <Row label="Duration" value={fmtDuration(meta.durationMs)} />
                  <Row label="Attempts" value={meta.attempts != null ? String(meta.attempts) : '\u2014'} />
                </dl>
                {meta.legs && meta.legs.length > 0 ? (
                  <div className="max-w-md rounded-lg border border-gray-200 bg-white p-3 text-xs">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-600">Workflow legs ({meta.pattern})</span>
                      {meta.completedN != null && meta.requestedN != null ? (
                        <span className="text-gray-400">
                          {meta.completedN}/{meta.requestedN}
                          {meta.diversityMode ? ` \u00b7 ${meta.diversityMode}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      {meta.legs.map((l, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="w-16 shrink-0 truncate text-gray-400">
                            {l.role}
                            {l.displayOrder != null ? ` \u00b7 #${l.displayOrder}` : ''}
                          </span>
                          <span className="flex-1 truncate font-mono text-gray-700">{l.model}</span>
                          {l.outcome && l.outcome !== 'ok' ? (
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                l.outcome === 'selected' || l.outcome === 'accepted'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : l.outcome === 'rejected'
                                    ? 'bg-amber-50 text-amber-600'
                                    : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {l.outcome}
                            </span>
                          ) : null}
                          <span className="w-14 shrink-0 text-right text-gray-400">{fmtCost(l.costUsd)}</span>
                        </div>
                      ))}
                    </div>
                    {meta.judgeReason ? (
                      <div className="mt-2 border-t border-gray-100 pt-2 text-gray-500">
                        <span className="text-gray-400">Judge:</span> {meta.judgeReason}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-400">{label}</dt>
      <dd className="truncate font-medium text-gray-700">{value}</dd>
    </div>
  );
}
