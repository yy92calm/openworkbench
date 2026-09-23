// Industry treemap (Eastmoney boards): block area ∝ total market cap, A-share
// red/green shading by today's change, labels while the block is big enough.
// Clicking a block opens the pricing detail dialog for that board.

import type { MacroBoard } from '@workbench/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { squarify } from '@/lib/treemap';

/** Canvas height in px; the width is measured from the container. */
const HEIGHT = 380;

/** Static opacity buckets (Tailwind needs the literals). */
const RISE_LEVELS = ['bg-rise/10', 'bg-rise/25', 'bg-rise/40', 'bg-rise/60'] as const;
const FALL_LEVELS = ['bg-fall/10', 'bg-fall/25', 'bg-fall/40', 'bg-fall/60'] as const;

function level(pct: number): number {
  const abs = Math.abs(pct);
  if (abs < 0.5) return 0;
  if (abs < 1.5) return 1;
  if (abs < 3) return 2;
  return 3;
}

function blockClass(board: MacroBoard): string {
  if (board.changePct === null || board.changePct === 0) return 'bg-surface-2';
  return board.changePct > 0
    ? RISE_LEVELS[level(board.changePct)]
    : FALL_LEVELS[level(board.changePct)];
}

function pctText(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function mcapText(v: number | null): string {
  return v === null ? '—' : `${(v / 1e8).toFixed(0)} 亿`;
}

export function IndustryTreemap({
  boards,
  onSelect,
}: {
  boards: MacroBoard[];
  onSelect: (board: MacroBoard) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Market-cap share, with a visible floor for boards whose cap is missing.
  const items = useMemo(() => {
    const caps = boards.map((b) => b.mcap ?? 0).filter((v) => v > 0);
    const floor = caps.length > 0 ? Math.min(...caps) * 0.25 : 1;
    return boards
      .map((board) => ({
        board,
        value: (board.mcap ?? 0) > 0 ? (board.mcap as number) : floor,
      }))
      .sort((a, b) => b.value - a.value);
  }, [boards]);

  const rects = useMemo(
    () =>
      width > 0
        ? squarify(
            items.map((i) => i.value),
            width,
            HEIGHT,
          )
        : [],
    [items, width],
  );

  return (
    <div
      ref={ref}
      className="relative h-[380px] overflow-hidden rounded-card border border-border bg-surface"
    >
      {items.map((item, i) => {
        const r = rects[i];
        if (!r || r.w <= 0 || r.h <= 0) return null;
        const showName = r.w >= 56 && r.h >= 28;
        const showPct = r.w >= 92 && r.h >= 44;
        return (
          <button
            key={item.board.code}
            type="button"
            title={`${item.board.name} ${pctText(item.board.changePct)} · 市值 ${mcapText(
              item.board.mcap,
            )}`}
            onClick={() => onSelect(item.board)}
            className={cn(
              'absolute overflow-hidden rounded-[3px] text-left transition-[filter] hover:brightness-110',
              blockClass(item.board),
            )}
            style={{
              left: r.x + 0.5,
              top: r.y + 0.5,
              width: Math.max(0, r.w - 1),
              height: Math.max(0, r.h - 1),
            }}
          >
            {showName && (
              <span className="flex h-full flex-col justify-between p-1.5">
                <span className="truncate text-[11px] leading-tight text-text/90">
                  {item.board.name}
                </span>
                {showPct && (
                  <span className="font-mono text-[11px] leading-tight text-text/70">
                    {pctText(item.board.changePct)}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
