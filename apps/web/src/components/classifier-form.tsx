'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Play, Trash2, X } from 'lucide-react';
import type { ClassifierDimension, ClassifierPreset } from '@llmgw/db/http';
import type { ClassifierRow, ModelOption } from '@/lib/classifiers';
import {
  deleteClassifier,
  saveClassifier,
  testClassifier,
  type ClassifierInput,
} from '@/lib/classifier-actions';
import { Toggle } from '@/components/toggle';

interface DimEdit {
  name: string;
  valuesText: string;
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100';

function toDimEdits(dims: ClassifierDimension[]): DimEdit[] {
  return dims.map((d) => ({ name: d.name, valuesText: d.values.join(', ') }));
}
function parseValues(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ClassifierForm({
  models,
  presets,
  maxDimensions,
  classifier,
  connected,
}: {
  models: ModelOption[];
  presets: ClassifierPreset[];
  maxDimensions: number;
  classifier?: ClassifierRow;
  connected: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(classifier);
  const [started, setStarted] = useState(isEdit);
  const [presetId, setPresetId] = useState(classifier?.preset ?? 'custom');

  const [name, setName] = useState(classifier?.name ?? '');
  const [modelSlug, setModelSlug] = useState(classifier?.modelSlug ?? models[0]?.slug ?? '');
  const [samplePct, setSamplePct] = useState(
    classifier ? String(Math.round(Number(classifier.sampleRate) * 100)) : '100',
  );
  const [dims, setDims] = useState<DimEdit[]>(toDimEdits(classifier?.dimensions ?? []));
  const [prompt, setPrompt] = useState(classifier?.prompt ?? '');
  const [enabled, setEnabled] = useState(classifier?.enabled ?? true);

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [sample, setSample] = useState('');
  const [testResult, setTestResult] = useState<Record<string, string> | null>(null);
  const [testRaw, setTestRaw] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testPending, startTest] = useTransition();

  const input = useMemo<ClassifierInput>(
    () => ({
      id: classifier?.id,
      name,
      preset: presetId,
      modelSlug,
      sampleRate: (Number(samplePct) || 0) / 100,
      dimensions: dims.map((d) => ({ name: d.name, values: parseValues(d.valuesText) })),
      prompt,
      enabled,
    }),
    [classifier?.id, name, presetId, modelSlug, samplePct, dims, prompt, enabled],
  );

  function choosePreset(p: ClassifierPreset) {
    setPresetId(p.id);
    if (!name.trim()) setName(p.id === 'custom' ? '' : p.label);
    setDims(toDimEdits(p.dimensions));
    setPrompt(p.prompt);
    setStarted(true);
  }

  function addDimension() {
    if (dims.length >= maxDimensions) return;
    setDims((prev) => [...prev, { name: '', valuesText: '' }]);
  }
  function removeDimension(i: number) {
    setDims((prev) => prev.filter((_, j) => j !== i));
  }
  function patchDim(i: number, patch: Partial<DimEdit>) {
    setDims((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveClassifier(input);
      if (!res.ok) {
        setError(res.error ?? 'Failed to save classifier.');
        return;
      }
      router.push('/classifiers');
      router.refresh();
    });
  }

  function runTest() {
    setTestError(null);
    setTestResult(null);
    setTestRaw(null);
    startTest(async () => {
      const res = await testClassifier(input, sample);
      if (!res.ok) {
        setTestError(res.error ?? 'Test failed.');
        return;
      }
      setTestResult(res.tags ?? {});
      setTestRaw(res.content ?? '');
    });
  }

  function onDelete() {
    if (!classifier) return;
    if (!window.confirm('Delete this classifier?')) return;
    start(async () => {
      await deleteClassifier(classifier.id);
      router.push('/classifiers');
      router.refresh();
    });
  }

  // ---- New-classifier preset picker ----
  if (!started) {
    return (
      <div>
        <p className="text-sm text-gray-500">Start from a template or build your own.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => choosePreset(p)}
              disabled={!connected}
              className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-violet-300 hover:shadow-sm disabled:opacity-50"
            >
              <div className="font-medium text-gray-900">{p.label}</div>
              <div className="mt-0.5 text-sm text-gray-500">{p.description}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Section title="Basic Info" desc="A recognizable name for this classifier.">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} />
        </Field>
        {isEdit ? (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <Toggle on={enabled} onChange={setEnabled} /> Enabled
          </label>
        ) : null}
      </Section>

      <Section title="Classifier Model" desc="A small, fast model is recommended — it runs on sampled requests.">
        <Field label="Model">
          <select value={modelSlug} onChange={(e) => setModelSlug(e.target.value)} className={inputCls}>
            {models.length === 0 ? <option value="">No executable models</option> : null}
            {models.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.displayName} — ${Number(m.promptPricePerM).toFixed(2)}/M in
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sample rate (%)">
          <input
            value={samplePct}
            onChange={(e) => setSamplePct(e.target.value)}
            inputMode="numeric"
            className={`${inputCls} max-w-[160px]`}
          />
          <p className="mt-1 text-xs text-gray-500">Percentage of requests to classify. Lower rates reduce cost.</p>
        </Field>
      </Section>

      <Section title="Dimensions" desc={`What to classify along. Up to ${maxDimensions} dimensions, each with a fixed set of values.`}>
        <div className="space-y-3">
          {dims.map((d, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={d.name}
                  onChange={(e) => patchDim(i, { name: e.target.value })}
                  placeholder="Dimension name (e.g. department)"
                  className={`${inputCls} flex-1`}
                />
                <button
                  onClick={() => removeDimension(i)}
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove dimension"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                value={d.valuesText}
                onChange={(e) => patchDim(i, { valuesText: e.target.value })}
                placeholder="Comma-separated values (e.g. Engineering, Sales, Support)"
                className={`${inputCls} mt-2`}
              />
            </div>
          ))}
          {dims.length === 0 ? (
            <p className="text-sm text-gray-500">No dimensions yet. Add one to define what to classify.</p>
          ) : null}
          <button
            onClick={addDimension}
            disabled={dims.length >= maxDimensions}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add dimension
          </button>
        </div>
      </Section>

      <Section title="Classification Prompt" desc="Extra instructions to guide the classifier model.">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className={inputCls} />
      </Section>

      <Section title="Test the classifier" desc="Run the classifier on a sample message to preview its output.">
        <textarea
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          rows={3}
          placeholder="Paste a sample user message…"
          className={inputCls}
        />
        <button
          onClick={runTest}
          disabled={testPending || !connected}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <Play className="h-4 w-4" /> {testPending ? 'Running…' : 'Run'}
        </button>
        {testError ? <p className="mt-2 text-sm text-red-600">{testError}</p> : null}
        {testResult ? (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(testResult).map(([k, v]) => (
                <span key={k} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                  <span className="text-gray-400">{k}:</span> {v}
                </span>
              ))}
            </div>
            {testRaw ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-gray-500">Raw model output</summary>
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-600">{testRaw}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </Section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex items-center justify-between">
        <div>
          {isEdit ? (
            <button
              onClick={onDelete}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/classifiers')}
            className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={pending || !connected}
            className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create classifier'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 border-b border-gray-100 pb-8 md:grid-cols-[220px_1fr]">
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <p className="mt-1 text-sm text-gray-500">{desc}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
