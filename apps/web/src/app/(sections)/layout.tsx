import { TopNav } from '@/components/top-nav';
import { getSessionUser } from '@/lib/auth';

export default async function SectionsLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="flex h-screen flex-col">
      <TopNav email={user?.email ?? null} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#fbfbfb]">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
