'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { BRAND } from '@/lib/brand';

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Models', href: '/models' },
  { label: 'Benchmarks', href: '/benchmarks' },
  { label: 'Chat', href: '/chat' },
  { label: 'Rankings', href: '/rankings' },
];

const SECTION_PREFIXES = ['/models', '/benchmarks', '/chat', '/rankings'];

export function TopNav({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const inSection = SECTION_PREFIXES.some((p) => pathname.startsWith(p));
  const isActive = (href: string) => (href === '/' ? !inSection : pathname.startsWith(href));
  const initial = (email?.trim()?.[0] ?? '?').toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-gray-200 bg-white px-4">
      <Link href="/" className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white">
          {BRAND.charAt(0)}
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-gray-900">
          {BRAND.toLowerCase()}
        </span>
      </Link>

      <div className="ml-2 hidden items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-400 md:flex md:w-72">
        <Search className="h-4 w-4" />
        <span className="flex-1">Search</span>
        <kbd className="rounded border border-gray-200 bg-white px-1.5 text-[11px] text-gray-500">
          ⌘K
        </kbd>
      </div>

      <nav className="ml-auto hidden items-center gap-1 text-sm lg:flex">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={
              'rounded-md px-2.5 py-1.5 ' +
              (isActive(item.href)
                ? 'font-semibold text-gray-900'
                : 'text-gray-500 hover:text-gray-900')
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {email ? (
        <Link
          href="/overview"
          className="ml-auto flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50 lg:ml-0"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[11px] font-semibold text-white">
            {initial}
          </span>
          <span className="hidden max-w-[140px] truncate sm:block">{email}</span>
        </Link>
      ) : (
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Link href="/login" className="rounded-md px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Get API Key
          </Link>
        </div>
      )}
    </header>
  );
}
