import { NotificationsView } from '@/components/notifications-view';
import {
  DEFAULT_NOTIF_SETTINGS,
  getNotificationSettings,
  listNotifications,
} from '@/lib/notifications';
import { getCurrentUser, getCurrentWorkspace } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const wsCtx = await getCurrentWorkspace();
  const userCtx = await getCurrentUser();
  const settings = wsCtx ? await getNotificationSettings(wsCtx.workspace.id) : DEFAULT_NOTIF_SETTINGS;
  const items = userCtx ? await listNotifications(userCtx.org.id) : [];
  return (
    <NotificationsView
      settings={settings}
      items={items}
      userEmail={userCtx?.user.email ?? ''}
      connected={!!wsCtx}
    />
  );
}