import Link from 'next/link';
import { Folder, MoreVertical } from 'lucide-react';
import { formatBudget } from '@/lib/format';
import type { WorkspaceRow } from '@/lib/workspaces';

export function WorkspacesTable({ rows }: { rows: WorkspaceRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-5 py-3 font-medium">Name</th>
            <th className="px-5 py-3 font-medium">Description</th>
            <th className="px-5 py-3 font-medium">Budget</th>
            <th className="px-5 py-3 font-medium">Keys</th>
            <th className="w-10 px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center text-gray-500">
                No workspaces yet. Create your first one.
              </td>
            </tr>
          ) : (
            rows.map((w) => (
              <tr key={w.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2 font-medium text-gray-900">
                    <Folder className="h-4 w-4 text-gray-400" />
                    {w.name}
                  </div>
                </td>
                <td className="max-w-md px-5 py-4 text-gray-500">
                  <span className="line-clamp-1">{w.description ?? '—'}</span>
                </td>
                <td className="px-5 py-4 text-gray-700">{formatBudget(w.budgetLimitUsd)}</td>
                <td className="px-5 py-4">
                  <Link href="/api-keys" className="text-gray-700 underline-offset-2 hover:underline">
                    {w.keyCount}
                  </Link>
                </td>
                <td className="px-5 py-4 text-right">
                  <button
                    aria-label="Workspace actions"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
