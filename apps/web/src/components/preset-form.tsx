'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PresetConfig, ServerToolMeta } from '@llmgw/db/http';
import type { PresetRow } from '@/lib/presets';
import { savePreset } from '@/lib/preset-actions';
import { Toggle } from '@/components/toggle';

function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function num(s: string): number | undefined {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100';

export function PresetForm({ serverTools, preset }: { serverTools: ServerToolMeta[]; preset?: PresetRow }) {
  const router = useRouter();
  const cfg = preset?.config;
  const pp = cfg?.providerPrefs;
  const params = cfg?.parameters;

  const [name, setName] = useState(preset?.name ?? '');
  const [slug, setSlug] = useState(preset?.slug ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(preset?.systemPrompt ?? '');
  const [models, setModels] = useState<string[]>([
    cfg?.models?.[0] ?? '',
    cfg?.models?.[1] ?? '',
    cfg?.models?.[2] ?? '',
  ]);

  const [includeProvider, setIncludeProvider] = useState(Boolean(pp));
  const [sort, setSort] = useState(pp?.sort ?? '');
  const [order, setOrder] = useState((pp?.order ?? []).join(', '));
  const [only, setOnly] = useState((pp?.only ?? []).join(', '));
  const [ignore, setIgnore] = useState((pp?.ignore ?? []).join(', '));
  const [allowFallbacks, setAllowFallbacks] = useState(pp?.allowFallbacks ?? true);
  const [dataCollection, setDataCollection] = useState(pp?.dataCollection ?? '');
  const [zdr, setZdr] = useState(pp?.zdr ?? false);
  const [maxPrompt, setMaxPrompt] = useState(pp?.maxPrice?.prompt?.toString() ?? '');
  const [maxCompletion, setMaxCompletion] = useState(pp?.maxPrice?.completion?.toString() ?? '');

  const [incTemp, setIncTemp] = useState(params?.temperature != null);
  const [temp, setTemp] = useState(params?.temperature?.toString() ?? '1');
  const [incTopP, setIncTopP] = useState(params?.topP != null);
  const [topP, setTopP] = useState(params?.topP?.toString() ?? '1');
  const [incMax, setIncMax] = useState(params?.maxTokens != null);
  const [maxTokens, setMaxTokens] = useState(params?.maxTokens?.toString() ?? '');

  const [tools, setTools] = useState<Set<string>>(new Set(cfg?.tools ?? []));
  const [cachingEnabled, setCachingEnabled] = useState(cfg?.caching?.enabled ?? false);
  const [ttl, setTtl] = useState(cfg?.caching?.ttlSeconds?.toString() ?? '300');

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleTool(id: string, on: boolean) {
    setTools((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function save() {
    setError(null);
    const config: PresetConfig = {
      models: models.map((m) => m.trim()).filter(Boolean).slice(0, 3),
      providerPrefs: includeProvider
        ? {
            sort: sort ? (sort as 'price' | 'throughput' | 'latency') : undefined,
            order: parseList(order),
            only: parseList(only),
            ignore: parseList(ignore),
            allowFallbacks,
            dataCollection: dataCollection ? (dataCollection as 'allow' | 'deny') : undefined,
            zdr,
            maxPrice:
              num(maxPrompt) != null || num(maxCompletion) != null
                ? { prompt: num(maxPrompt), completion: num(maxCompletion) }
                : undefined,
          }
        : undefined,
      parameters: {
        temperature: incTemp ? num(temp) : undefined,
        topP: incTopP ? num(topP) : undefined,
        maxTokens: incMax ? num(maxTokens) : undefined,
      },
      tools: [...tools],
      caching: { enabled: cachingEnabled, ttlSeconds: num(ttl) ?? 300 },
    };
    start(async () => {
      const res = await savePreset({
        id: preset?.id,
        name,
        slug,
        description,
        systemPrompt,
        config,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to save preset.');
        return;
      }
      router.push('/presets');
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <Section title="Basic Info" desc="Preset name and description for identification.">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} />
        </Field>
        <Field label="Slug">
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from name" className={inputCls} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </Field>
      </Section>

      <Section title="System Prompt" desc="Instructions included with every request using this preset.">
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} className={inputCls} />
      </Section>

      <Section title="Models" desc="Up to 3. Empty = allow any (auto). Multiple = fallbacks.">
        <div className="space-y-2">
          {models.map((m, i) => (
            <input
              key={i}
              value={m}
              onChange={(e) => setModels((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={i === 0 ? 'openai/gpt-4o-mini' : 'fallback model (optional)'}
              className={`${inputCls} font-mono`}
            />
          ))}
        </div>
      </Section>

      <Section title="Provider Routing" desc="Control which providers are used and routing preferences.">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={includeProvider} onChange={(e) => setIncludeProvider(e.target.checked)} />
          Include provider preferences
        </label>
        {includeProvider ? (
          <div className="mt-4 space-y-4">
            <Field label="Sort">
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={inputCls}>
                <option value="">—</option>
                <option value="price">Price</option>
                <option value="throughput">Throughput</option>
                <option value="latency">Latency</option>
              </select>
            </Field>
            <Field label="Order (provider slugs)">
              <input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="openai, anthropic" className={inputCls} />
            </Field>
            <Field label="Only (allow)">
              <input value={only} onChange={(e) => setOnly(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Ignore">
              <input value={ignore} onChange={(e) => setIgnore(e.target.value)} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max price / M prompt ($)">
                <input value={maxPrompt} onChange={(e) => setMaxPrompt(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
              <Field label="Max price / M completion ($)">
                <input value={maxCompletion} onChange={(e) => setMaxCompletion(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
            </div>
            <Field label="Data collection">
              <select value={dataCollection} onChange={(e) => setDataCollection(e.target.value as typeof dataCollection)} className={inputCls}>
                <option value="">—</option>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
            </Field>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Toggle on={allowFallbacks} onChange={setAllowFallbacks} /> Allow fallbacks
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <Toggle on={zdr} onChange={setZdr} /> Zero data retention
              </label>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Parameters" desc="Override default generation settings.">
        <ParamRow label="Temperature" include={incTemp} setInclude={setIncTemp} value={temp} setValue={setTemp} />
        <ParamRow label="Top P" include={incTopP} setInclude={setIncTopP} value={topP} setValue={setTopP} />
        <ParamRow label="Max tokens" include={incMax} setInclude={setIncMax} value={maxTokens} setValue={setMaxTokens} />
      </Section>

      <Section title="Tools" desc="Attach server tools that run automatically when this preset is used.">
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {serverTools.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-900">{t.label}</div>
                <div className="text-sm text-gray-500">{t.description}</div>
              </div>
              <Toggle on={tools.has(t.id)} onChange={(on) => toggleTool(t.id, on)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Caching" desc="Serve repeated identical requests from cache.">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Toggle on={cachingEnabled} onChange={setCachingEnabled} /> Enable response caching
        </label>
        {cachingEnabled ? (
          <div className="mt-3 max-w-xs">
            <Field label="Cache TTL (seconds)">
              <input value={ttl} onChange={(e) => setTtl(e.target.value)} inputMode="numeric" className={inputCls} />
            </Field>
          </div>
        ) : null}
      </Section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => router.push('/presets')}
          className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {pending ? 'Saving…' : preset ? 'Save changes' : 'Create preset'}
        </button>
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
function ParamRow({
  label,
  include,
  setInclude,
  value,
  setValue,
}: {
  label: string;
  include: boolean;
  setInclude: (v: boolean) => void;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
      <span className="w-28 text-sm text-gray-700">{label}</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!include}
        inputMode="decimal"
        className={`${inputCls} max-w-[160px] disabled:opacity-50`}
      />
    </div>
  );
}
