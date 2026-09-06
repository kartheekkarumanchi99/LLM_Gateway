import { ProfileView } from '@/components/profile-view';
import { getProfileData, type ProfileData } from '@/lib/profile';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const EMPTY: ProfileData = {
  daily: [],
  topModels: [],
  heatmap: [],
  stats: { totalSpendUsd: 0, totalRequests: 0, longestStreakDays: 0, avgPerDayUsd: 0, avgPerWeekUsd: 0 },
};

export default async function Page() {
  const ctx = await getCurrentUser();
  const data = ctx ? await getProfileData(ctx.org.id) : EMPTY;
  return (
    <ProfileView
      name={ctx?.user.name ?? ''}
      email={ctx?.user.email ?? ''}
      data={data}
      connected={!!ctx}
    />
  );
}
