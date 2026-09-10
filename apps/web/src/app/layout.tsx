import type { Metadata } from 'next';
import './globals.css';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${BRAND} — One API for every model`,
  description:
    'Intelligent routing, self-healing failover, and full observability for every LLM — behind a single OpenAI-compatible endpoint.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
