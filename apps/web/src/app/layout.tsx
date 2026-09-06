import type { Metadata } from 'next';
import './globals.css';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${BRAND} — Dashboard`,
  description: 'Unified LLM gateway dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
