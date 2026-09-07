import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { TopNav } from '@/components/top-nav';
import { getSessionUser } from '@/lib/auth';
import { getCurrentUser, getCurrentWorkspace } from '@/lib/session';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (process.env.AUTH_REQUIRED === 'true') {
    const sessionUser = await getSessionUser();
    if (!sessionUser) redirect('/login');
  }

  const [account, ws] = await Promise.all([getCurrentUser(), getCurrentWorkspace()]);

  return (
    <div className="flex h-screen flex-col">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          accountEmail={account?.user.email ?? null}
          workspaceName={ws?.workspace.name ?? null}
        />
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#fbfbfb]">
          <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
