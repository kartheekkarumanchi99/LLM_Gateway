import { ActivityView } from '@/components/activity-view';
import { getActivity, type ActivityData } from '@/lib/activity';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set([1, 7, 30, 90]);
const EMPTY_TREND = { topName: null, series: [], items: [] };
const EMPTY: ActivityData = {
  totals: {
    spendUsd: 0,
    requests: 0,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheHitRate: 0,
    blendedPerM: 0,
  },
  byModel: [],
  byKey: [],
  byApp: [],
  daily: [],
  trends: { models: EMPTY_TREND, keys: EMPTY_TREND, apps: EMPTY_TREND },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const parsed = Number(sp.range);
  const range = ALLOWED.has(parsed) ? parsed : 30;
  const ctx = await getCurrentUser();
  const data = ctx ? await getActivity(ctx.org.id, range) : EMPTY;
  return <ActivityView data={data} range={range} connected={!!ctx} />;
}
