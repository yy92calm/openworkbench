import { useMemo } from 'react';

import { cn } from '@/lib/cn';

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  oldLine?: number;
  newLine?: number;
  text: string;
}

/**
 * Parse a unified diff string into structured DiffLine[].
 * Supports standard `git diff` and `diff -u` output.
 */
function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('@@')) {
      // Chunk header: @@ -oldStart,count +newStart,count @@
      const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
      continue;
    }
    if (raw.startsWith('+')) {
      result.push({ type: 'add', newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      result.push({ type: 'del', oldLine, text: raw.slice(1) });
      oldLine++;
    } else {
      result.push({ type: 'ctx', oldLine, newLine, text: raw });
      oldLine++;
      newLine++;
    }
  }
  return result;
}

/**
 * Side-by-side or unified diff viewer for code changes.
 * Inspired by Reasonix's DiffView used in ToolCard.
 */
export function DiffView({
  diff,
  oldLabel = '旧版本',
  newLabel = '新版本',
  sideBySide = false,
  maxHeight = 400,
}: {
  diff: string;
  oldLabel?: string;
  newLabel?: string;
  sideBySide?: boolean;
  maxHeight?: number;
}) {
  const lines = useMemo(() => parseDiff(diff), [diff]);

  if (sideBySide) {
    return (
      <SideBySideDiff lines={lines} oldLabel={oldLabel} newLabel={newLabel} maxHeight={maxHeight} />
    );
  }

  return <UnifiedDiff lines={lines} maxHeight={maxHeight} />;
}

function UnifiedDiff({ lines, maxHeight }: { lines: DiffLine[]; maxHeight: number }) {
  return (
    <div
      className="overflow-auto rounded-md border border-border bg-bg-soft font-mono text-[12px] leading-5"
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              className={cn(line.type === 'add' && 'bg-ok/8', line.type === 'del' && 'bg-error/8')}
            >
              <td className="w-10 select-none px-2 text-right text-[11px] text-muted">
                {line.oldLine ?? ''}
              </td>
              <td className="w-10 select-none px-2 text-right text-[11px] text-muted">
                {line.newLine ?? ''}
              </td>
              <td
                className={cn(
                  'px-1',
                  line.type === 'add' && 'text-ok',
                  line.type === 'del' && 'text-error',
                )}
              >
                <span className="select-none mr-1">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </span>
                {line.text || '\u00A0'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SideBySideDiff({
  lines,
  oldLabel,
  newLabel,
  maxHeight,
}: {
  lines: DiffLine[];
  oldLabel: string;
  newLabel: string;
  maxHeight: number;
}) {
  const oldLines = lines.filter((l) => l.type !== 'add');
  const newLines = lines.filter((l) => l.type !== 'del');

  return (
    <div className="flex overflow-auto rounded-md border border-border" style={{ maxHeight }}>
      {/* Old */}
      <div className="min-w-0 flex-1 border-r border-border">
        <div className="sticky top-0 z-sticky border-b border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted">
          {oldLabel}
        </div>
        <table className="w-full border-collapse font-mono text-[12px] leading-5">
          <tbody>
            {oldLines.map((line, i) => (
              <tr key={i} className={line.type === 'del' ? 'bg-error/8' : ''}>
                <td className="w-10 select-none px-2 text-right text-[11px] text-muted">
                  {line.oldLine ?? ''}
                </td>
                <td className={cn('px-1', line.type === 'del' && 'text-error')}>
                  {line.text || '\u00A0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* New */}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-sticky border-b border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted">
          {newLabel}
        </div>
        <table className="w-full border-collapse font-mono text-[12px] leading-5">
          <tbody>
            {newLines.map((line, i) => (
              <tr key={i} className={line.type === 'add' ? 'bg-ok/8' : ''}>
                <td className="w-10 select-none px-2 text-right text-[11px] text-muted">
                  {line.newLine ?? ''}
                </td>
                <td className={cn('px-1', line.type === 'add' && 'text-ok')}>
                  {line.text || '\u00A0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
