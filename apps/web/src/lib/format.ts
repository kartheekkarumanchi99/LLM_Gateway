export function formatBudget(value: string | null): string {
  if (value === null || value === undefined) return 'No limit';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'No limit';
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Deterministic (locale-free) so it is safe to render in client components.
export function formatUsd(value: number | string | null | undefined, digits = 2): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '$0.00';
  return '$' + (n as number).toFixed(digits);
}

// Compact token/context count, locale-free (e.g. 128000 -> "128K", 1000000 -> "1M").
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

// Price per 1M tokens, locale-free. 0 (or invalid) renders as "Free".
export function formatPricePerM(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'Free';
  if (n < 1) return '$' + n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return '$' + n.toFixed(2).replace(/\.00$/, '');
}
