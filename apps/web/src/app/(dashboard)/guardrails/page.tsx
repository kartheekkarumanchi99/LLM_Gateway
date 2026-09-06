import Link from 'next/link';
import { countConfiguredPolicies } from '@llmgw/db/http';
import { NewGuardrailButton } from '@/components/new-guardrail-button';
import { ensureDefaultGuardrail, listGuardrails } from '@/lib/guardrails';
import { getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  if (ctx) await ensureDefaultGuardrail(ctx.workspace.id);
  const rows = ctx ? await listGuardrails(ctx.workspace.id) : [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Guardrails</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set spending limits, data privacy rules, and model/provider restrictions for API keys in this
            workspace.
          </p>
        </div>
        <NewGuardrailButton disabled={!ctx} />
      </div>

      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Policies</th>
              <th className="px-5 py-3 font-medium">API Keys</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-gray-500">
                  No guardrails yet.
                </td>
              </tr>
            ) : (
              rows.map((g) => {
                const count = countConfiguredPolicies(g.policies);
                return (
                  <tr key={g.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                    <td className="px-5 py-4">
                      <Link href={`/guardrails/${g.id}`} className="group">
                        <div className="flex items-center gap-2 font-medium text-gray-900 group-hover:text-violet-700">
                          {g.name}
                          {g.isDefault ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                              Default
                            </span>
                          ) : null}
                        </div>
                        {g.description ? (
                          <div className="mt-0.5 text-sm text-gray-500">{g.description}</div>
                        ) : null}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        {g.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {count === 0 ? 'No policies' : `${count} ${count === 1 ? 'policy' : 'policies'}`}
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {g.isDefault ? 'All' : g.keyCount}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          {rows.length} {rows.length === 1 ? 'guardrail' : 'guardrails'}
        </div>
      </div>
    </div>
  );
}
