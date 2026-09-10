'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  GitCompareArrows,
  Loader2,
  Play,
  Star,
} from 'lucide-react';
import type { ModelOption } from '@/lib/classifiers';
import { formatTokens, formatUsd } from '@/lib/format';
import type { TraceDetail, TraceSpan } from '@/lib/traces';
import { replayTrace, saveTraceNote, toggleTraceStar, type ReplayResult } from '@/lib/trace-actions';

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function fmtTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ') + ' UTC';
}
function msgText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
      .join('\n');
  }
  return JSON.stringify(content ?? '');
}

type DiffLine = { type: 'same' | 'add' | 'del'; text: string };
function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n').slice(0, 400);
  const B = b.split('\n').slice(0, 400);
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: 'same', text: A[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: A[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: B[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: A[i++]! });
  while (j < m) out.push({ type: 'add', text: B[j++]! });
  return out;
}

function SpanRow({ span, wallMs }: { span: TraceSpan; wallMs: number }) {
  const [open, setOpen] = useState(false);
  const leftPct = wallMs > 0 ? (span.offsetMs / wallMs) * 100 : 0;
  const widthPct = wallMs > 0 ? Math.max(1.5, (span.latencyMs / wallMs) * 100) : 100;
  const isErr = span.status === 'error';
  const failedAttempts = span.attempts.filter((a) => a.result === 'error' || a.result === 'skipped');
  return (
    <div className={`rounded-lg border ${isErr ? 'border-rose-200' : 'border-gray-200'} ${span.kind === 'leg' ? 'ml-6' : ''}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${span.kind === 'leg' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-600'}`}
        >
          {span.kind === 'leg' ? span.label : 'request'}
        </span>
        <code className="font-mono text-[11px] text-gray-500">{span.model.split('/').pop()}</code>
        {span.cached ? <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">cached</span> : null}
        {isErr ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">error</span> : null}
        <div className="relative mx-2 h-4 flex-1 overflow-hidden rounded bg-gray-50">
          <div
            className={`absolute top-0.5 h-3 rounded ${isErr ? 'bg-rose-300' : span.kind === 'leg' ? 'bg-indigo-300' : 'bg-violet-400'}`}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            title={`${fmtDuration(span.latencyMs)} @ +${fmtDuration(span.offsetMs)}`}
          />
        </div>
        <span className="w-14 text-right text-xs tabular-nums text-gray-600">{fmtDuration(span.latencyMs)}</span>
        <span className="w-16 text-right text-xs tabular-nums text-gray-900">{formatUsd(span.costUsd, 5)}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-gray-100 px-3 py-3 text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
            <span>Provider: <span className="font-medium text-gray-900">{span.provider}</span></span>
            <span>Prompt: <span className="tabular-nums">{formatTokens(span.promptTokens)}</span></span>
            <span>Completion: <span className="tabular-nums">{formatTokens(span.completionTokens)}</span></span>
            <span>Total: <span className="tabular-nums">{formatTokens(span.totalTokens)}</span></span>
            {span.finishReason ? <span>Finish: <span className="font-medium">{span.finishReason}</span></span> : null}
          </div>

          {span.attempts.length > 0 ? (
            <div>
              <div className="mb-1 font-medium text-gray-700">Routing attempts</div>
              <div className="space-y-1">
                {span.attempts.map((a, k) => (
                  <div
                    key={k}
                    className={`flex items-center gap-2 rounded px-2 py-1 ${a.result === 'success' ? 'bg-emerald-50' : 'bg-rose-50'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${a.result === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <code className="font-mono text-[11px] text-gray-700">{a.slug}</code>
                    <span className="text-gray-400">·</span>
                    <span className={a.result === 'success' ? 'text-emerald-700' : 'text-rose-700'}>{a.result}</span>
                    {a.reason ? <span className="truncate text-gray-500">— {a.reason}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {span.hasLog ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 font-medium text-gray-700">Input</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
                  {Array.isArray(span.messages)
                    ? (span.messages as Array<{ role?: string; content?: unknown }>)
                        .map((mm) => `[${mm.role ?? '?'}] ${msgText(mm.content)}`)
                        .join('\n\n')
                    : '(no stored input)'}
                </pre>
              </div>
              <div>
                <div className="mb-1 font-medium text-gray-700">Output</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
                  {span.completion || '(no stored output)'}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
              Prompt/response not captured. Turn on Observability request logging to inspect and replay this step.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TraceDetailView({ trace, models }: { trace: TraceDetail; models: ModelOption[] }) {
  const [starred, setStarred] = useState(trace.annotation.starred);
  const [note, setNote] = useState(trace.annotation.note ?? '');
  const [noteSaved, setNoteSaved] = useState(false);
  const [, startStar] = useTransition();
  const [savingNote, startNote] = useTransition();

  const [replayModels, setReplayModels] = useState<Set<string>>(
    () => new Set(trace.replayModel ? [trace.replayModel] : []),
  );
  const [replaying, startReplay] = useTransition();
  const [results, setResults] = useState<ReplayResult[] | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const originalOutput = useMemo(
    () => trace.spans.find((s) => s.kind === 'request' && s.completion)?.completion ?? '',
    [trace.spans],
  );

  const diffOptions = useMemo(() => {
    const opts: { key: string; label: string; text: string }[] = [];
    if (originalOutput) opts.push({ key: 'original', label: 'Original', text: originalOutput });
    for (const r of results ?? []) if (!r.error) opts.push({ key: r.model, label: r.model.split('/').pop() ?? r.model, text: r.content });
    return opts;
  }, [originalOutput, results]);

  const [leftKey, setLeftKey] = useState('original');
  const [rightKey, setRightKey] = useState('');
  const [showDiff, setShowDiff] = useState(false);

  function toggleStar() {
    setStarred((v) => !v);
    startStar(async () => {
      const res = await toggleTraceStar(trace.traceId);
      if (res.ok && res.starred !== undefined) setStarred(res.starred);
    });
  }
  function persistNote() {
    startNote(async () => {
      await saveTraceNote(trace.traceId, note);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    });
  }
  function toggleReplayModel(slug: string) {
    setReplayModels((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < 4) next.add(slug);
      return next;
    });
  }
  function runReplay() {
    setReplayError(null);
    startReplay(async () => {
      const res = await replayTrace(trace.traceId, [...replayModels]);
      if (res.ok && res.results) {
        setResults(res.results);
        const firstOk = res.results.find((r) => !r.error);
        if (firstOk) {
          setRightKey(firstOk.model);
          setShowDiff(Boolean(originalOutput));
        }
      } else {
        setReplayError(res.error ?? 'Replay failed.');
      }
    });
  }

  const canReplay = !!trace.replayMessages && Array.isArray(trace.replayMessages);
  const leftText = diffOptions.find((o) => o.key === leftKey)?.text ?? '';
  const rightText = diffOptions.find((o) => o.key === rightKey)?.text ?? '';
  const diff = useMemo(() => (showDiff && leftText && rightText ? diffLines(leftText, rightText) : []), [showDiff, leftText, rightText]);

  return (
    <div>
      <Link href="/traces" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to traces
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">Trace</h1>
            <code className="font-mono text-sm text-gray-500">{trace.traceId}</code>
            <button onClick={toggleStar} aria-label="Star">
              <Star className={`h-5 w-5 ${starred ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-amber-300'}`} />
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500">{fmtTime(trace.startedAt)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Steps', value: String(trace.steps) },
          { label: 'Spans', value: String(trace.spans.length) },
          { label: 'Wall time', value: fmtDuration(trace.wallMs) },
          { label: 'Tokens', value: formatTokens(trace.totalTokens) },
          { label: 'Cost', value: formatUsd(trace.totalCostUsd, 4) },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">{m.label}</div>
            <div className="mt-0.5 text-lg font-semibold text-gray-900">{m.value}</div>
          </div>
        ))}
      </div>

      {trace.hasError ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This trace contains a failed step. Expand the red span below to see the failed routing attempts and the
            upstream error reason.
          </span>
        </div>
      ) : null}

      {/* Annotation */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-2 text-xs font-medium text-gray-700">Notes</div>
        <div className="flex items-start gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Add a note about this trace…"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <button
            onClick={persistNote}
            disabled={savingNote}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {savingNote ? 'Saving…' : noteSaved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Waterfall */}
      <h2 className="mt-6 text-sm font-semibold text-gray-900">Span waterfall</h2>
      <div className="mt-3 space-y-1.5">
        {trace.spans.map((s) => (
          <SpanRow key={s.id} span={s} wallMs={trace.wallMs} />
        ))}
      </div>

      {/* Replay + compare */}
      <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <GitCompareArrows className="h-4 w-4 text-indigo-600" /> Replay &amp; compare
      </h2>
      {!canReplay ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No stored prompt to replay. Enable Observability request logging so inputs are captured, then re-run the
          request to make it replayable here.
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium text-gray-700">Replay the captured prompt against up to 4 models</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {models.slice(0, 24).map((m) => (
              <button
                key={m.slug}
                onClick={() => toggleReplayModel(m.slug)}
                className={`rounded-full border px-2.5 py-1 text-xs ${replayModels.has(m.slug) ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {m.displayName}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={runReplay}
              disabled={replaying || replayModels.size === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {replaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {replaying ? 'Replaying…' : `Replay (${replayModels.size})`}
            </button>
            {replayError ? <span className="text-xs text-rose-600">{replayError}</span> : null}
          </div>

          {results ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {results.map((r) => (
                <div key={r.model} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <code className="font-mono text-xs text-gray-700">{r.model}</code>
                    {r.error ? (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">error</span>
                    ) : (
                      <span className="text-[11px] text-gray-500">
                        {fmtDuration(r.latencyMs)} · {formatUsd(r.costUsd, 5)} · {formatTokens(r.completionTokens)} tok
                      </span>
                    )}
                  </div>
                  {r.chosenModel && r.chosenModel !== r.model ? (
                    <div className="mt-0.5 text-[10px] text-gray-400">routed → {r.chosenModel}</div>
                  ) : null}
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
                    {r.error ? r.error : r.content || '(empty)'}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}

          {/* Diff */}
          {diffOptions.length >= 2 ? (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowDiff((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <GitCompareArrows className="h-3.5 w-3.5" /> {showDiff ? 'Hide diff' : 'Diff outputs'}
                </button>
                {showDiff ? (
                  <>
                    <select value={leftKey} onChange={(e) => setLeftKey(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
                      {diffOptions.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400">vs</span>
                    <select value={rightKey} onChange={(e) => setRightKey(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
                      <option value="">—</option>
                      {diffOptions.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  </>
                ) : null}
              </div>
              {showDiff && diff.length > 0 ? (
                <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white p-2 font-mono text-[11px] leading-relaxed">
                  {diff.map((d, i) => (
                    <div
                      key={i}
                      className={
                        d.type === 'add'
                          ? 'bg-emerald-50 text-emerald-800'
                          : d.type === 'del'
                            ? 'bg-rose-50 text-rose-800'
                            : 'text-gray-600'
                      }
                    >
                      <span className="select-none text-gray-300">{d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}</span>
                      {d.text || ' '}
                    </div>
                  ))}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
