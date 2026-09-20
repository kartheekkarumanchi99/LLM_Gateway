import Link from 'next/link';
import { History, ChevronRight } from 'lucide-react';
import { getCurrentWorkspace } from '@/lib/session';
import { getReplayableRequests } from '@/lib/replay';

export const dynamic = 'force-dynamic';

const PATTERN_TONE: Record<string, string> = {
  single: 'bg-gray-100 text-gray-600',
  cascade: 'bg-blue-50 text-blue-600',
  critique: 'bg-amber-50 text-amber-600',
  bestofn: 'bg-purple-50 text-purple-600',
  decompose: 'bg-emerald-50 text-emerald-600',
};

export default async function Page() {
  const ctx = await getCurrentWorkspace();
  const requests = ctx ? await getReplayableRequests(ctx.org.id) : [];

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-600">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">State Replay</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            White-box incident reconstruction. Every request&apos;s full execution DAG is recorded with exact prompts,
            params, seeds, and outputs. Open one to inspect any node, modify it, and deterministically replay from
            there — frame by frame.
          </p>
        </div>
      </div>

      {!ctx ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet.
        </div>
      ) : requests.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500">
          No captured executions yet. Send a request (especially an orchestrated one — cascade, critique, best-of-N,
          decompose) and it will appear here with its full replayable DAG.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Pattern</th>
                <th className="px-5 py-2.5 font-medium">Nodes</th>
                <th className="px-5 py-2.5 font-medium">Models</th>
                <th className="px-5 py-2.5 font-medium">Final answer</th>
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map((r) => (
                <tr key={r.requestId} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${PATTERN_TONE[r.pattern] ?? 'bg-gray-100 text-gray-600'}`}>
                      {r.pattern}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{r.nodeCount}</td>
                  <td className="max-w-[220px] px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.models.slice(0, 3).map((m) => (
                        <span key={m} className="truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                          {m}
                        </span>
                      ))}
                      {r.models.length > 3 ? <span className="text-[10px] text-gray-400">+{r.models.length - 3}</span> : null}
                    </div>
                  </td>
                  <td className="max-w-[280px] truncate px-5 py-3 text-gray-500">{r.finalOutput.slice(0, 80) || '—'}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">{r.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/replay/${encodeURIComponent(r.requestId)}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700"
                    >
                      Open <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
