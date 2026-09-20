import { cn } from '@/lib/cn';

/** Lightweight SVG sparkline for card mini-charts (no chart library needed). */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 100;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`)
    .join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className={up ? 'text-rise' : 'text-fall'}
      />
    </svg>
  );
}

/** One dashboard indicator: label + value + optional change/spark + actions. */
export function IndicatorCard({
  label,
  value,
  changePct,
  sub,
  spark,
  onOpen,
  onQuote,
}: {
  label: string;
  value: string;
  changePct?: number | null;
  sub?: string;
  spark?: number[] | null;
  onOpen?: () => void;
  onQuote?: () => void;
}) {
  const hasChange = typeof changePct === 'number';
  return (
    <div className="group relative rounded-card border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent/40">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className={cn('block w-full text-left', onOpen ? 'cursor-pointer' : 'cursor-default')}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12px] text-muted">{label}</span>
          {hasChange && (
            <span
              className={cn(
                'shrink-0 text-[12px] font-medium transition-opacity group-hover:opacity-0',
                changePct >= 0 ? 'text-rise' : 'text-fall',
              )}
            >
              {changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className="font-mono text-[17px] leading-none text-text">{value}</span>
          {spark && spark.length > 1 && <Sparkline values={spark} className="h-6 w-20" />}
        </div>
        {sub && <div className="mt-1 text-[11px] text-muted/70">{sub}</div>}
      </button>
      {onQuote && (
        <button
          type="button"
          onClick={onQuote}
          className="absolute right-1.5 top-1.5 hidden rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-text group-hover:block"
        >
          引用
        </button>
      )}
    </div>
  );
}
