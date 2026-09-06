import Link from 'next/link';
import {
  Eye,
  KeyRound,
  KeySquare,
  Route,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { getWeeklyUsage } from '@/lib/overview';
import { getCurrentWorkspace } from '@/lib/session';
import { formatUsd } from '@/lib/format';

export const dynamic = 'force-dynamic';

const FEATURES: { title: string; desc: string; href: string; icon: LucideIcon }[] = [
  { title: 'API Keys', desc: 'Create and manage API keys in this workspace.', href: '/api-keys', icon: KeyRound },
  { title: 'Guardrails', desc: 'Set budgets, model/provider restrictions, privacy, and content policies.', href: '/guardrails', icon: ShieldCheck },
  { title: 'BYOK', desc: 'Use your own provider API keys on the gateway.', href: '/byok', icon: KeySquare },
  { title: 'Routing', desc: 'Set routing policies for models and providers.', href: '/routing', icon: Route },
  { title: 'Presets', desc: 'Save shortcuts for system prompts and request parameters.', href: '/presets', icon: SlidersHorizontal },
  { title: 'Tools', desc: 'Configure plugins and control which server tools requests may use.', href: '/tools', icon: Wrench },
  { title: 'Observability', desc: 'Connect monitoring tools to track usage.', href: '/observability', icon: Eye },
  { title: 'Settings', desc: 'Edit the workspace name and description.', href: '/settings', icon: Settings },
];

function UsageCard({ title, value, model, metric }: { title: string; value: string; model?: string; metric?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-1 text-3xl font-semibold text-gray-900">{value}</div>
      <div className="mt-6 border-t border-gray-100 pt-3">
        {model ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-gray-600">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              {model}
            </span>
            <span className="text-gray-500">{metric}</span>
          </div>
        ) : (
          <div className="text-sm text-gray-400">No usage yet this week.</div>
        )}
      </div>
    </div>
  );
}

export default async function OverviewPage() {
  const ctx = await getCurrentWorkspace();
  const usage = ctx
    ? await getWeeklyUsage(ctx.workspace.id)
    : { spendUsd: 0, requests: 0, tokens: 0, byModel: [] };
  const ws = ctx?.workspace;
  const top = usage.byModel[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{ws?.name ?? 'Overview'}</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-500">
        {ws?.description ??
          'A summary of your account usage, spend, and recent activity for this workspace.'}
      </p>

      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code>, then run{' '}
          <code className="font-mono">pnpm db:push</code>, <code className="font-mono">pnpm db:sync-catalog</code>, and{' '}
          <code className="font-mono">pnpm db:seed</code>.
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">This Week&apos;s Usage</h2>
        <Link href="/activity" className="text-sm text-gray-500 hover:text-gray-900">
          View Activity ›
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        <UsageCard title="Spend" value={formatUsd(usage.spendUsd)} model={top?.modelSlug} metric={top ? formatUsd(top.spendUsd) : undefined} />
        <UsageCard title="Requests" value={usage.requests.toLocaleString()} model={top?.modelSlug} metric={top ? top.requests.toLocaleString() : undefined} />
        <UsageCard title="Tokens" value={usage.tokens.toLocaleString()} model={top?.modelSlug} metric={top ? top.tokens.toLocaleString() : undefined} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <Link
              key={f.href}
              href={f.href}
              className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-sm"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-600">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <div className="font-medium text-gray-900">{f.title}</div>
                <div className="mt-0.5 text-sm text-gray-500">{f.desc}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
