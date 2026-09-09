'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Sparkles } from 'lucide-react';
import { ProviderLogo } from '@/components/provider-logo';
import type { RunnableModel } from '@/lib/catalog-types';

// Custom model picker (native <option> can't hold logos). Shows a real provider
// logo per model and filters as you type.
export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: RunnableModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value === 'auto' ? null : models.find((m) => m.slug === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.slug.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, query]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-[200px] items-center gap-2 rounded-lg border border-gray-300 bg-white py-1.5 pl-2 pr-2 text-sm font-medium text-gray-800 outline-none hover:border-gray-400 focus:border-violet-500"
      >
        {value === 'auto' ? (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-violet-100 text-violet-600">
            <Sparkles className="h-3 w-3" />
          </span>
        ) : (
          <ProviderLogo slug={selected?.provider ?? value.split('/')[0] ?? value} size={20} />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {value === 'auto' ? 'Auto Router' : (selected?.slug ?? value)}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => pick('auto')}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${value === 'auto' ? 'bg-violet-50' : ''}`}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-violet-100 text-violet-600">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="font-medium text-gray-800">Auto Router</span>
            </button>
            {filtered.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => pick(m.slug)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 ${value === m.slug ? 'bg-violet-50' : ''}`}
              >
                <ProviderLogo slug={m.provider} size={20} />
                <span className="min-w-0 flex-1 truncate text-gray-700">{m.slug}</span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">No models match your search.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
