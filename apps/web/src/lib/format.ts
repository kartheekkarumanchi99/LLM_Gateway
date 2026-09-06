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
