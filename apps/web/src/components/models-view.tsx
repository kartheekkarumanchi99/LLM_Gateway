'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Sparkles, X } from 'lucide-react';
import { formatPricePerM, formatTokens } from '@/lib/format';
import type { CatalogModel } from '@/lib/catalog-types';

type SortKey = 'featured' | 'name' | 'context' | 'price-low' | 'price-high' | 'new';

const CONTEXT_BUCKETS = [
  { label: 'Any', value: 0 },
  { label: '8K+', value: 8_000 },
  { label: '32K+', value: 32_000 },
  { label: '128K+', value: 128_000 },
  { label: '1M+', value: 1_000_000 },
];

const MODALITY_OPTIONS = [
  { label: 'Any', value: 'any' },
  { label: 'Text', value: 'text' },
  { label: 'Image', value: 'image' },
  { label: 'Audio', value: 'audio' },
];

const PAGE = 48;

function inputModalities(modality: string | null): string[] {
  if (!modality) return ['text'];
  const left = modality.split('->')[0] ?? modality;
  const tokens = left
    .split(/[+,/]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return tokens.length ? tokens : ['text'];
}

function chip(active: boolean): string {
  return (
    'rounded-md px-2.5 py-1 text-xs font-medium transition ' +
    (active ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
  );
}

export function ModelsView({ models }: { models: CatalogModel[] }) {
  const [query, setQuery] = useState('');
  const [providerQuery, setProviderQuery] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [minContext, setMinContext] = useState(0);
  const [modality, setModality] = useState('any');
  const [freeOnly, setFreeOnly] = useState(false);
  const [runnableOnly, setRunnableOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('featured');
  const [shown, setShown] = useState(PAGE);

  const providerCounts = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const m of models) {
      const cur = map.get(m.provider);
      if (cur) cur.count++;
      else map.set(m.provider, { name: m.providerName, count: 1 });
    }
    return [...map.entries()]
      .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [models]);

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return providerCounts;
    return providerCounts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
    );
  }, [providerCounts, providerQuery]);

  const runnableCount = useMemo(() => models.filter((m) => m.executable).length, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = models.filter((m) => {
      if (runnableOnly && !m.executable) return false;
      if (freeOnly && (m.promptPricePerM > 0 || m.completionPricePerM > 0)) return false;
      if (minContext && m.contextLength < minContext) return false;
      if (selectedProviders.size > 0 && !selectedProviders.has(m.provider)) return false;
      if (modality !== 'any' && !inputModalities(m.modality).includes(modality)) return false;
      if (q && !(m.name + ' ' + m.slug + ' ' + m.providerName).toLowerCase().includes(q)) return false;
      return true;
    });
    return list.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'context':
          return b.contextLength - a.contextLength;
        case 'price-low':
          return a.promptPricePerM - b.promptPricePerM;
        case 'price-high':
          return b.promptPricePerM - a.promptPricePerM;
        case 'new':
          return b.createdAt.localeCompare(a.createdAt);
        default:
          if (a.executable !== b.executable) return a.executable ? -1 : 1;
          return b.contextLength - a.contextLength;
      }
    });
  }, [models, query, runnableOnly, freeOnly, minContext, selectedProviders, modality, sort]);

  const visible = filtered.slice(0, shown);

  function toggleProvider(slug: string) {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setShown(PAGE);
  }

  function reset() {
    setQuery('');
    setProviderQuery('');
    setSelectedProviders(new Set());
    setMinContext(0);
    setModality('any');
    setFreeOnly(false);
    setRunnableOnly(false);
    setSort('featured');
    setShown(PAGE);
  }

  const hasFilters =
    Boolean(query) ||
    selectedProviders.size > 0 ||
    minContext > 0 ||
    modality !== 'any' ||
    freeOnly ||
    runnableOnly;

  if (models.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Models</h1>
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          No models found. Connect the database and run{' '}
          <code className="rounded bg-amber-100 px-1 font-mono">pnpm db:sync-catalog</code> to load
          the catalog.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Models</h1>
        <p className="mt-1 text-sm text-gray-500">
          {models.length} models across {providerCounts.length} providers · {runnableCount} runnable
          on this gateway
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Search models, e.g. gpt-4o, claude, llama…"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-violet-500"
        >
          <option value="featured">Featured</option>
          <option value="name">Name (A–Z)</option>
          <option value="context">Context (high to low)</option>
          <option value="price-low">Price (low to high)</option>
          <option value="price-high">Price (high to low)</option>
          <option value="new">Newest</option>
        </select>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh_-_5rem)] lg:w-60 lg:self-start lg:overflow-y-auto">
          <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-4">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Runnable here
              </span>
              <input
                type="checkbox"
                checked={runnableOnly}
                onChange={(e) => {
                  setRunnableOnly(e.target.checked);
                  setShown(PAGE);
                }}
                className="h-4 w-4 accent-violet-600"
              />
            </label>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Input modality
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MODALITY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      setModality(o.value);
                      setShown(PAGE);
                    }}
                    className={chip(modality === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Min context
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CONTEXT_BUCKETS.map((b) => (
                  <button
                    key={b.value}
                    onClick={() => {
                      setMinContext(b.value);
                      setShown(PAGE);
                    }}
                    className={chip(minContext === b.value)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Price
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => {
                    setFreeOnly(false);
                    setShown(PAGE);
                  }}
                  className={chip(!freeOnly)}
                >
                  Any
                </button>
                <button
                  onClick={() => {
                    setFreeOnly(true);
                    setShown(PAGE);
                  }}
                  className={chip(freeOnly)}
                >
                  Free
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Providers
              </div>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  value={providerQuery}
                  onChange={(e) => setProviderQuery(e.target.value)}
                  placeholder="Filter providers"
                  className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-violet-500"
                />
              </div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                {filteredProviders.map((p) => (
                  <label
                    key={p.slug}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProviders.has(p.slug)}
                      onChange={() => toggleProvider(p.slug)}
                      className="h-3.5 w-3.5 accent-violet-600"
                    />
                    <span className="flex-1 truncate text-gray-700">{p.name}</span>
                    <span className="text-xs text-gray-400">{p.count}</span>
                  </label>
                ))}
              </div>
            </div>

            {hasFilters ? (
              <button
                onClick={reset}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-3 text-sm text-gray-500">
            Showing {visible.length} of {filtered.length} models
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
              No models match your filters.
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((m) => (
                <ModelCard key={m.slug} model={m} />
              ))}
            </div>
          )}
          {shown < filtered.length ? (
            <div className="mt-6 text-center">
              <button
                onClick={() => setShown((n) => n + PAGE)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Load more ({filtered.length - shown} remaining)
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModelCard({ model }: { model: CatalogModel }) {
  const mods = inputModalities(model.modality);
  const vision = mods.includes('image');
  const audio = mods.includes('audio');
  return (
    <Link
      href={`/models/${model.slug}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gray-100 text-sm font-semibold text-gray-600">
          {(model.providerName || model.provider).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-gray-900">{model.name}</h3>
            {model.executable ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                Runnable
              </span>
            ) : null}
            {vision ? (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                Vision
              </span>
            ) : null}
            {audio ? (
              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-600">
                Audio
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-gray-400">{model.slug}</p>
          {model.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-gray-500">{model.description}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
            <span>
              Context <b className="font-semibold text-gray-700">{formatTokens(model.contextLength)}</b>
            </span>
            <span>
              Input <b className="font-semibold text-gray-700">{formatPricePerM(model.promptPricePerM)}</b>
              <span className="text-gray-400">/M</span>
            </span>
            <span>
              Output{' '}
              <b className="font-semibold text-gray-700">{formatPricePerM(model.completionPricePerM)}</b>
              <span className="text-gray-400">/M</span>
            </span>
            <span className="text-gray-400">{model.providerName}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
