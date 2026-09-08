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
import { getFinOps } from '@/lib/finops';
import { getCurrentWorkspace } from '@/lib/session';
import { FinOpsDashboard } from '@/components/finops-dashboard';

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

export default async function OverviewPage() {
  const ctx = await getCurrentWorkspace();
  const ws = ctx?.workspace;
  const finops = ctx ? await getFinOps(ctx.org.id) : null;

  return (
    <div>
      {ws ? <div className="mb-3 text-sm text-gray-500">{ws.name}</div> : null}

      {!ctx ? (
        <>
          <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code>, then run{' '}
            <code className="font-mono">pnpm db:push</code>, <code className="font-mono">pnpm db:sync-catalog</code>, and{' '}
            <code className="font-mono">pnpm db:seed</code>.
          </div>
        </>
      ) : null}

      {finops ? <FinOpsDashboard data={finops} /> : null}

      <div className="mt-10 mb-3">
        <h2 className="text-sm font-semibold tracking-wide text-gray-900 uppercase">Manage workspace</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
