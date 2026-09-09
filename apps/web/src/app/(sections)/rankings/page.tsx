import { RankingsView } from '@/components/rankings-view';
import { getRankings } from '@/lib/rankings';
import { getCurrentOrg } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set([1, 7, 30, 90]);

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const n = Number(range);
  const days = ALLOWED.has(n) ? n : 30;

  const org = await getCurrentOrg();
  if (!org) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Rankings</h1>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      </div>
    );
  }

  const data = await getRankings(org.id, days);
  return <RankingsView data={data} />;
}
