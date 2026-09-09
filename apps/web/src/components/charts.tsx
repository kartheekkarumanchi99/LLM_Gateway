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

// Shared categorical palette (locale/theme-independent).
export const PALETTE = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
];

// Compact inline trend line (SVG, locale-free). Highlights the last point.
export function Sparkline({
  data,
  color = '#6366f1',
  width = 100,
  height = 26,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return <svg width={width} height={height} aria-hidden />;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const y = (v: number) => height - ((v - min) / range) * (height - 3) - 1.5;
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastX = (data.length - 1) * step;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lastX} cy={y(data[data.length - 1] ?? 0)} r={2} fill={color} />
    </svg>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  size?: number;
  kind?: 'frontier' | 'used' | 'other';
}

// Quality-vs-price scatter with an optional Pareto frontier. Log X for price.
export function Scatter({
  points,
  frontier = [],
  xLabel,
  yLabel,
  height = 340,
}: {
  points: ScatterPoint[];
  frontier?: { x: number; y: number }[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const W = 720;
  const H = height;
  const pad = { l: 46, r: 18, t: 16, b: 38 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const xs = points.map((p) => p.x).filter((x) => x > 0);
  const xmin = xs.length ? Math.min(...xs) : 0.01;
  const xmax = xs.length ? Math.max(...xs) : 1;
  const lmin = Math.log10(Math.max(xmin, 1e-4));
  const lmax = Math.log10(Math.max(xmax, xmin * 10));
  const tx = (x: number) => pad.l + ((Math.log10(Math.max(x, 1e-4)) - lmin) / (lmax - lmin || 1)) * iw;
  const ty = (y: number) => pad.t + (1 - Math.max(0, Math.min(100, y)) / 100) * ih;
  const color = (k?: string) => (k === 'frontier' ? '#059669' : k === 'used' ? '#7c3aed' : '#cbd5e1');
  const rOf = (p: ScatterPoint) => (p.size && p.size > 0 ? Math.min(11, 3.5 + Math.sqrt(p.size)) : 3);
  const yTicks = [0, 25, 50, 75, 100];
  const xTickVals = [0.01, 0.1, 1, 10, 100].filter((v) => v >= xmin / 2 && v <= xmax * 2);
  const sorted = [...points].sort((a, b) => (a.kind === 'other' ? -1 : 1) - (b.kind === 'other' ? -1 : 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={pad.l} y1={ty(t)} x2={W - pad.r} y2={ty(t)} stroke="#f1f5f9" />
          <text x={pad.l - 6} y={ty(t) + 3} textAnchor="end" className="fill-gray-400 text-[10px]">
            {t}
          </text>
        </g>
      ))}
      {xTickVals.map((t) => (
        <text key={t} x={tx(t)} y={H - pad.b + 14} textAnchor="middle" className="fill-gray-400 text-[10px]">
          {t < 1 ? `$${t}` : `$${t}`}
        </text>
      ))}
      {frontier.length > 1 ? (
        <polyline
          points={frontier.map((f) => `${tx(f.x).toFixed(1)},${ty(f.y).toFixed(1)}`).join(' ')}
          fill="none"
          stroke="#059669"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ) : null}
      {sorted.map((p, i) => (
        <circle
          key={i}
          cx={tx(p.x)}
          cy={ty(p.y)}
          r={rOf(p)}
          fill={color(p.kind)}
          fillOpacity={p.kind === 'other' ? 0.5 : 0.85}
          stroke="#fff"
          strokeWidth={0.6}
        >
          <title>{`${p.label} — $${p.x.toFixed(3)}/1M · quality ${p.y}${p.size ? ` · ${p.size} calls` : ''}`}</title>
        </circle>
      ))}
      {xLabel ? (
        <text x={pad.l + iw / 2} y={H - 4} textAnchor="middle" className="fill-gray-500 text-[11px]">
          {xLabel}
        </text>
      ) : null}
      {yLabel ? (
        <text x={12} y={pad.t + ih / 2} textAnchor="middle" transform={`rotate(-90 12 ${pad.t + ih / 2})`} className="fill-gray-500 text-[11px]">
          {yLabel}
        </text>
      ) : null}
    </svg>
  );
}

// Donut / ring chart (SVG). Segments are drawn proportionally with a hollow center.
export function Donut({
  segments,
  size = 148,
  thickness = 24,
  centerLabel,
  centerSub,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${c} ${c})`}>
        {segments.map((s, i) => {
          const dash = (s.value / total) * circ;
          const el = (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${Math.max(0, dash - 1.5)} ${circ - Math.max(0, dash - 1.5)}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
            />
          );
          offset += dash;
          return el;
        })}
      </g>
      {centerLabel ? (
        <text x={c} y={c - 1} textAnchor="middle" className="fill-gray-900 text-[17px] font-semibold">
          {centerLabel}
        </text>
      ) : null}
      {centerSub ? (
        <text x={c} y={c + 15} textAnchor="middle" className="fill-gray-400 text-[10px]">
          {centerSub}
        </text>
      ) : null}
    </svg>
  );
}

// Horizontal bar list — label, proportional bar, and a value on the right.
export function HBars({
  data,
  color = '#6366f1',
}: {
  data: { label: string; value: number; sub?: string; color?: string; badge?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              {d.badge ? <span className="text-xs text-gray-400">{d.badge}</span> : null}
              <span className="truncate text-gray-700">{d.label}</span>
            </span>
            {d.sub ? <span className="shrink-0 text-xs text-gray-400">{d.sub}</span> : null}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: d.color ?? color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
