import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronRight, DollarSign, FileText, Layers, ShieldCheck } from 'lucide-react';
import { DeleteGuardrailButton } from '@/components/delete-guardrail-button';
import { getGuardrail } from '@/lib/guardrails';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCurrentWorkspace();
  if (!ctx) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Not connected to a database yet.
      </div>
    );
  }
  const g = await getGuardrail(id, ctx.workspace.id);
  if (!g) notFound();

  const p = g.policies;
  const ma = p?.modelAccess;
  const maConfigured = Boolean(
    ma &&
      (ma.blockedProviders.length ||
        ma.blockedModels.length ||
        ma.allowedProviders.length ||
        ma.allowedModels.length ||
        ma.restrictionMode === 'block_all_except' ||
        Object.values(ma.zdr).some(Boolean)),
  );

  const cards = [
    {
      title: 'Budget Policies',
      desc: 'Set spending limits for API keys. This budget applies to each assigned key.',
      href: `/guardrails/${id}/budget`,
      icon: DollarSign,
      status: p?.budget?.limitUsd != null ? `$${p.budget.limitUsd} / ${p.budget.interval}` : 'Not configured',
    },
    {
      title: 'Model & Provider Access',
      desc: 'Control which models and providers are available.',
      href: `/guardrails/${id}/model-access`,
      icon: Layers,
      status: maConfigured ? 'Configured' : 'Not configured',
    },
    {
      title: 'Prompt Injection',
      desc: 'Detect and respond to prompt injection attempts.',
      href: `/guardrails/${id}/prompt-injection`,
      icon: ShieldCheck,
      status: p?.promptInjection && p.promptInjection !== 'off' ? cap(p.promptInjection) : 'Not configured',
    },
    {
      title: 'Sensitive Info Detection',
      desc: 'Identify and handle PII, credentials, and personal data.',
      href: `/guardrails/${id}/sensitive-info`,
      icon: FileText,
      status: p?.sensitiveInfo && p.sensitiveInfo !== 'off' ? cap(p.sensitiveInfo) : 'Not configured',
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/guardrails" className="flex items-center gap-1 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Guardrails
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900">{g.name}</span>
      </div>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            {g.name}
            {g.isDefault ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                Default
              </span>
            ) : null}
          </h1>
          {g.description ? <p className="mt-1 text-sm text-gray-500">{g.description}</p> : null}
        </div>
        {!g.isDefault ? <DeleteGuardrailButton id={g.id} /> : null}
      </div>

      {g.isDefault ? (
        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          This guardrail applies to each workspace key by default.
        </div>
      ) : null}

      <div className="mt-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          API Keys ({g.isDefault ? 'All' : g.assignedKeys.length})
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {g.isDefault ? (
            <span className="rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-600">All workspace keys</span>
          ) : g.assignedKeys.length === 0 ? (
            <span className="text-sm text-gray-400">No keys assigned yet.</span>
          ) : (
            g.assignedKeys.map((k) => (
              <span key={k.id} className="rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-700">
                {k.name}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {cards.map((c) => {
          const Icon = c.icon;
          const configured = c.status !== 'Not configured';
          return (
            <Link
              key={c.href}
              href={c.href}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="flex-1">
                <div className="font-medium text-gray-900">{c.title}</div>
                <div className="mt-0.5 text-sm text-gray-500">{c.desc}</div>
              </div>
              <span className={`text-sm ${configured ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                {c.status}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
