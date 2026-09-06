'use client';

// Deterministic integer formatting (locale-free — safe for SSR/hydration).
export function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function Bars({
  data,
  color = '#6366f1',
  height = 150,
  valueFmt,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  valueFmt?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 rounded-t transition-colors hover:opacity-80"
          title={`${d.label}: ${valueFmt ? valueFmt(d.value) : d.value}`}
          style={{
            height: `${(d.value / max) * (height - 4)}px`,
            minHeight: d.value > 0 ? 3 : 0,
            background: color,
          }}
        />
      ))}
    </div>
  );
}

export function StackedBars({
  data,
  series,
  height = 150,
}: {
  data: Record<string, number>[];
  series: { key: string; color: string; label: string }[];
  height?: number;
}) {
  const totals = data.map((d) => series.reduce((s, ser) => s + (d[ser.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col-reverse" style={{ height }}>
          {series.map((ser) => {
            const v = d[ser.key] ?? 0;
            return (
              <div
                key={ser.key}
                title={`${ser.label}: ${v}`}
                style={{ height: `${(v / max) * (height - 4)}px`, background: ser.color }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Heatmap({ points }: { points: { date: string; count: number }[] }) {
  const map = new Map(points.map((p) => [p.date, p.count]));
  const max = Math.max(1, ...points.map((p) => p.count));
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 370);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // align to Sunday

  const cells: { date: string; count: number }[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, count: map.get(key) ?? 0 });
  }
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const colors = ['#ebedf0', '#c6e6d3', '#8fd3ad', '#4caf82', '#2e7d5b'];
  const level = (c: number) =>
    c === 0 ? 0 : c / max > 0.66 ? 4 : c / max > 0.33 ? 3 : c / max > 0.1 ? 2 : 1;

  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {w.map((c, ci) => (
            <div
              key={ci}
              title={`${c.date}: ${c.count} request${c.count === 1 ? '' : 's'}`}
              className="h-[11px] w-[11px] rounded-[2px]"
              style={{ background: colors[level(c.count)] }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function HeatLegend() {
  const colors = ['#ebedf0', '#c6e6d3', '#8fd3ad', '#4caf82', '#2e7d5b'];
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <span>Less</span>
      {colors.map((c) => (
        <span key={c} className="h-[11px] w-[11px] rounded-[2px]" style={{ background: c }} />
      ))}
      <span>More</span>
    </div>
  );
}
