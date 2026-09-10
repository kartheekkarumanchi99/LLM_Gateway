'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Menu, X } from 'lucide-react';
import { BRAND } from '@/lib/brand';

const NAV = [
  { label: 'Models', href: '/models' },
  { label: 'Rankings', href: '/rankings' },
  { label: 'Benchmarks', href: '/benchmarks' },
  { label: 'Chat', href: '/chat' },
];

export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={
        'sticky top-0 z-50 transition-colors ' +
        (scrolled ? 'border-b border-gray-200/80 bg-white/80 backdrop-blur-md' : 'border-b border-transparent')
      }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-sm">
            {BRAND.charAt(0)}
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-gray-900">{BRAND.toLowerCase()}</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 text-sm md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-gray-600 transition-colors hover:text-gray-900">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link
              href="/overview"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:text-gray-900">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
              >
                Get API Key
              </Link>
            </>
          )}
        </div>

        <button className="ml-auto md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="h-5 w-5 text-gray-700" /> : <Menu className="h-5 w-5 text-gray-700" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-gray-200 bg-white px-5 py-3 md:hidden">
          <nav className="flex flex-col gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2 text-gray-700 hover:bg-gray-50">
                {n.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-2">
              {signedIn ? (
                <Link href="/overview" className="flex-1 rounded-lg bg-gray-900 px-3 py-2 text-center text-sm font-medium text-white">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link href="/login" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-700">
                    Sign in
                  </Link>
                  <Link href="/register" className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-center text-sm font-medium text-white">
                    Get API Key
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
