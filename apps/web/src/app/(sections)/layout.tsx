import { TopNav } from '@/components/top-nav';

export default function SectionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <TopNav />
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#fbfbfb]">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
