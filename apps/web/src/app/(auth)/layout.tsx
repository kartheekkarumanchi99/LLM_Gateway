import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BRAND } from '@/lib/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-[#fafafa] px-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 lg-glow" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 lg-grid" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-base font-bold text-white shadow-sm">
              {BRAND.charAt(0)}
            </span>
            <span className="text-lg font-semibold tracking-tight text-gray-900">{BRAND.toLowerCase()}</span>
          </Link>
        </div>
        {children}
        <Link
          href="/"
          className="mt-6 flex items-center justify-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </Link>
      </div>
    </div>
  );
}

