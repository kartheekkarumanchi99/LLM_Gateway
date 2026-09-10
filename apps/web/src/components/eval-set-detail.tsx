'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Database, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import type { ModelOption } from '@/lib/classifiers';
import type { CaptureCandidate, EvalSetDetail } from '@/lib/evals';
import { addManualCase, captureFromLogs, deleteCase, runEvalAction } from '@/lib/evals-actions';
import { VERDICT_BADGE } from '@/components/evals-view';

export function EvalSetDetailView({
  set,
  models,
  captureCandidates,
}: {
  set: EvalSetDetail;
  models: ModelOption[];
  captureCandidates: CaptureCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ---- case authoring ----
  const [manualInput, setManualInput] = useState('');
  const [manualRef, setManualRef] = useState('');
  const [showCapture, setShowCapture] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // ---- eval run form ----
  const [runName, setRunName] = useState('');
  const [candidateModel, setCandidateModel] = useState(models[0]?.slug ?? 'auto');
  const [candidatePrompt, setCandidatePrompt] = useState('');
  const [useBaseline, setUseBaseline] = useState(true);
  const [baselineModel, setBaselineModel] = useState(models[0]?.slug ?? 'auto');
  const [baselinePrompt, setBaselinePrompt] = useState('');
  const [judgeModel, setJudgeModel] = useState('');
  const [runError, setRunError] = useState<string | null>(null);

  function addManual() {
    if (!manualInput.trim()) return;
    startTransition(async () => {
      await addManualCase(set.id, manualInput, manualRef);
      setManualInput('');
      setManualRef('');
      router.refresh();
    });
  }
  function togglePick(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function doCapture() {
    if (picked.size === 0) return;
    startTransition(async () => {
      await captureFromLogs(set.id, [...picked]);
      setPicked(new Set());
      setShowCapture(false);
      router.refresh();
    });
  }
  function removeCase(id: string) {
    startTransition(async () => {
      await deleteCase(set.id, id);
      router.refresh();
    });
  }
  function run() {
    setRunError(null);
    startTransition(async () => {
      const res = await runEvalAction({
        setId: set.id,
        name: runName || undefined,
        mode: candidatePrompt ? 'prompt' : 'model',
        candidateModel,
        candidatePrompt: candidatePrompt || undefined,
        baselineModel: useBaseline ? baselineModel : undefined,
        baselinePrompt: useBaseline ? baselinePrompt || undefined : undefined,
        judgeModel: judgeModel || undefined,
      });
      if (res.ok && res.id) router.push(`/evals/runs/${res.id}`);
      else setRunError(res.error ?? 'Eval failed.');
    });
  }

  const canRun = set.cases.length > 0 && !pending;

  return (
    <div>
      <Link href="/evals" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to eval sets
      </Link>
      <div className="mt-3">
        <h1 className="text-2xl font-semibold text-gray-900">{set.name}</h1>
        {set.description ? <p className="mt-1 text-sm text-gray-500">{set.description}</p> : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Cases */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Cases ({set.cases.length})</h2>
            <button
              onClick={() => setShowCapture((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Database className="h-3.5 w-3.5" /> Capture from production
            </button>
          </div>

          {showCapture ? (
            <div className="mt-3 rounded-lg border border-gray-200 p-3">
              {captureCandidates.length === 0 ? (
                <div className="text-xs text-gray-500">
                  No captured requests yet. Turn on Observability request logging, then run some traffic.
                </div>
              ) : (
                <>
                  <div className="max-h-52 space-y-1 overflow-y-auto">
                    {captureCandidates.map((c) => (
                      <label key={c.requestId} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={picked.has(c.requestId)}
                          onChange={() => togglePick(c.requestId)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                        />
                        <span className="flex-1">
                          <span className="line-clamp-2 text-gray-700">{c.inputPreview || '(empty)'}</span>
                          <span className="font-mono text-[10px] text-gray-400">{c.modelSlug}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={doCapture}
                    disabled={pending || picked.size === 0}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add {picked.size} case{picked.size === 1 ? '' : 's'}
                  </button>
                </>
              )}
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            {set.cases.map((c) => (
              <div key={c.id} className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5">
                <div className="flex-1">
                  <div className="line-clamp-2 text-sm text-gray-700">{c.inputPreview || '(empty)'}</div>
                  {c.reference ? <div className="mt-0.5 text-[11px] text-gray-400">ref: {c.reference.slice(0, 80)}</div> : null}
                </div>
                {c.sourceRequestId ? <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">prod</span> : null}
                <button onClick={() => removeCase(c.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose-600" aria-label="Delete case">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Plus className="h-3.5 w-3.5" /> Add a case by hand
            </div>
            <textarea
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              rows={2}
              placeholder="User input…"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <input
              value={manualRef}
              onChange={(e) => setManualRef(e.target.value)}
              placeholder="Reference answer (optional)"
              className="mt-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={addManual}
              disabled={pending || !manualInput.trim()}
              className="mt-2 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Add case
            </button>
          </div>
        </section>

        {/* New eval run */}
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">New eval run</h2>
            <p className="mt-1 text-xs text-gray-500">
              Score a candidate against the set with an LLM judge. Add a baseline to get a quality/cost/latency diff.
            </p>

            <label className="mt-3 block">
              <span className="text-xs font-medium text-gray-700">Name</span>
              <input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="prompt v2 vs live"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <div className="mt-3 rounded-lg bg-blue-50/50 p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Candidate</div>
              <select
                value={candidateModel}
                onChange={(e) => setCandidateModel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
              >
                <option value="auto">Auto (cheapest runnable)</option>
                {models.map((m) => (
                  <option key={m.slug} value={m.slug}>{m.displayName}</option>
                ))}
              </select>
              <textarea
                value={candidatePrompt}
                onChange={(e) => setCandidatePrompt(e.target.value)}
                rows={2}
                placeholder="System prompt override (optional — leave empty for a pure model swap)"
                className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={useBaseline} onChange={(e) => setUseBaseline(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600" />
              Compare against a baseline
            </label>

            {useBaseline ? (
              <div className="mt-2 rounded-lg bg-gray-50 p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Baseline</div>
                <select
                  value={baselineModel}
                  onChange={(e) => setBaselineModel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="auto">Auto (cheapest runnable)</option>
                  {models.map((m) => (
                    <option key={m.slug} value={m.slug}>{m.displayName}</option>
                  ))}
                </select>
                <textarea
                  value={baselinePrompt}
                  onChange={(e) => setBaselinePrompt(e.target.value)}
                  rows={2}
                  placeholder="Baseline system prompt (optional)"
                  className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            ) : null}

            {runError ? <div className="mt-3 text-xs text-rose-600">{runError}</div> : null}
            <button
              onClick={run}
              disabled={!canRun}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {pending ? 'Running…' : 'Run eval'}
            </button>
            {set.cases.length === 0 ? <p className="mt-2 text-center text-[11px] text-amber-600">Add at least one case first.</p> : null}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">Runs</h2>
            {set.runs.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">No runs yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {set.runs.map((r) => (
                  <Link
                    key={r.id}
                    href={`/evals/runs/${r.id}`}
                    className="block rounded-lg border border-gray-200 p-3 hover:border-gray-300 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{r.name}</span>
                      {r.summary ? (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${VERDICT_BADGE[r.summary.verdict] ?? VERDICT_BADGE.neutral}`}>
                          {r.summary.verdict}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">{r.status}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                      <code className="font-mono">{r.candidateModel.split('/').pop()}</code>
                      {r.baselineModel ? <span>vs {r.baselineModel.split('/').pop()}</span> : null}
                      {r.summary ? <span>· {r.summary.casesPassed}/{r.summary.casesTotal} pass</span> : null}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
