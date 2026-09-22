import { useEffect, useId, useRef, useState } from 'react';

/** Track an element's width so SVG text stays crisp (no stretching). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

export interface Bar {
  label: string;
  value: number;
  /** Tooltip text; defaults to "label: value". */
  title?: string;
  highlight?: boolean;
}

/** Small hand-rolled SVG bar chart (no chart library). */
export function BarChart({
  data,
  height = 140,
  color = 'var(--primary)',
  highlightColor = 'var(--accent)',
  format = (n: number) => String(n),
  showValues = true,
  labelEvery = 1,
  ariaLabel,
}: {
  data: Bar[];
  height?: number;
  color?: string;
  highlightColor?: string;
  format?: (n: number) => string;
  showValues?: boolean;
  labelEvery?: number;
  ariaLabel?: string;
}) {
  const id = useId();
  const { ref, w: W } = useWidth<HTMLDivElement>(Math.max(280, data.length * 28));
  const top = showValues ? 18 : 6;
  const bottom = 20;
  const H = height;
  const inner = H - top - bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = W / Math.max(1, data.length);
  const bw = Math.min(34, slot * 0.62);
  if (!data.length) return <div className="chart-empty muted">No data yet</div>;
  return (
    <div ref={ref} style={{ width: '100%' }}>
    <svg className="barchart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel || 'Bar chart'}>
      <line x1="0" x2={W} y1={top + inner + 0.5} y2={top + inner + 0.5} stroke="var(--border)" />
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max(3, (d.value / max) * inner) : 0;
        const x = i * slot + (slot - bw) / 2;
        const y = top + inner - h;
        return (
          <g key={`${id}-${i}`}>
            <title>{d.title || `${d.label}: ${format(d.value)}`}</title>
            <rect x={i * slot} y={top} width={slot} height={inner} fill="transparent" />
            {h > 0 && <rect x={x} y={y} width={bw} height={h} rx={Math.min(5, bw / 3)} fill={d.highlight ? highlightColor : color} />}
            {h === 0 && <rect x={x} y={top + inner - 2} width={bw} height={2} rx={1} fill="var(--border)" />}
            {showValues && d.value > 0 && (
              <text x={x + bw / 2} y={y - 5} textAnchor="middle" className="bar-value">
                {format(d.value)}
              </text>
            )}
            {i % labelEvery === 0 && (
              <text x={x + bw / 2} y={H - 5} textAnchor="middle" className="bar-label">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/** Horizontal bars for "by status" / "top cities" style breakdowns. */
export function HBars({ data, format = (n: number) => String(n), color = 'var(--primary)' }: { data: { label: string; value: number }[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="chart-empty muted">No data yet</div>;
  return (
    <div className="hbars">
      {data.map((d) => (
        <div key={d.label} className="hbar">
          <span className="hbar-label">{d.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </span>
          <span className="hbar-value">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
