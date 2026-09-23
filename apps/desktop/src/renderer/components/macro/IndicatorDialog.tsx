import { X } from 'lucide-react';
import { useEffect } from 'react';

export interface MacroSeriesPoint {
  x: string;
  y: number;
}

export function TrendChart({ points }: { points: MacroSeriesPoint[] }) {
  const w = 520;
  const h = 150;
  const pad = 10;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const px = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const py = (y: number) => h - pad - ((y - min) / span) * (h - pad * 2);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(p.y)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" preserveAspectRatio="none">
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="text-accent"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{points[0].x}</span>
        <span>
          {min.toFixed(2)} – {max.toFixed(2)}
        </span>
        <span>{points[points.length - 1].x}</span>
      </div>
    </div>
  );
}

/**
 * Indicator detail popup: recent history (already-loaded or fetched on open),
 * the series' definition/source, and the two conversation actions.
 */
export function IndicatorDialog({
  title,
  value,
  sub,
  meta,
  series,
  loading,
  onClose,
  onQuote,
  onGenerate,
}: {
  title: string;
  value: string;
  sub?: string;
  /** Definition / source line, e.g. "同比，来源：国家统计局（东财数据中心）". */
  meta?: string;
  series: MacroSeriesPoint[] | null;
  loading?: boolean;
  onClose: () => void;
  onQuote: () => void;
  onGenerate: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={title}
        className="w-[580px] max-w-[92vw] rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text">{title}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[22px] leading-none text-text">{value}</span>
              {sub && <span className="text-[12px] text-muted">{sub}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-3 rounded-card border border-border-soft bg-bg/40 p-3">
          {loading ? (
            <div className="h-36 animate-pulse rounded bg-surface-2" />
          ) : series && series.length > 1 ? (
            <TrendChart points={series} />
          ) : (
            <div className="flex h-36 items-center justify-center text-[12px] text-muted">
              暂无历史数据
            </div>
          )}
        </div>

        {meta && <div className="mt-2 text-[11px] text-muted/80">{meta}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
            onClick={onQuote}
          >
            引用到对话
          </button>
          <button
            className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            onClick={onGenerate}
          >
            就此生成洞察
          </button>
        </div>
      </div>
    </div>
  );
}
