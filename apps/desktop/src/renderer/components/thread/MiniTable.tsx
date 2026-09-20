import { type ParsedTable, parseTableFile } from '@/lib/csv';

/** Compact read-only table preview shared by artifact cards and rich csv/tsv
 *  fences: first rows × first columns plus a dimension badge. Returns null
 *  when the text does not parse as a delimited table. */
export function MiniTable({
  filename,
  text,
  maxRows = 5,
  maxCols = 6,
  badge = true,
}: {
  filename: string;
  text: string;
  maxRows?: number;
  maxCols?: number;
  badge?: boolean;
}) {
  let table: ParsedTable | null = null;
  try {
    table = parseTableFile(filename, text);
  } catch {
    table = null;
  }
  if (!table || table.rows.length === 0) return null;
  const cols = table.columns.slice(0, maxCols);
  const rows = table.rows.slice(0, maxRows);
  return (
    <div className="overflow-hidden rounded border border-border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="truncate border-b border-border bg-surface-2 px-2 py-1 text-left font-semibold text-text"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((_, j) => (
                <td key={j} className="truncate border-b border-border/50 px-2 py-1 text-muted">
                  {r[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {badge && (
        <div className="bg-surface-2 px-2 py-1 text-[11px] text-muted">
          {table.rows.length} 行 × {table.columns.length} 列 · 前 {rows.length} 行
        </div>
      )}
    </div>
  );
}
