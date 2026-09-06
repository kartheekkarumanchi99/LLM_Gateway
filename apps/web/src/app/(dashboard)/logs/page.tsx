import { LogsView } from '@/components/logs-view';
import { getLogs } from '@/lib/logs';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set([1, 7, 30]);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const parsed = Number(sp.range);
  const range = ALLOWED.has(parsed) ? parsed : 1;
  const ctx = await getCurrentUser();
  const { generations, upstream } = ctx
    ? await getLogs(ctx.org.id, range)
    : { generations: [], upstream: [] };
  return <LogsView generations={generations} upstream={upstream} range={range} connected={!!ctx} />;
}
