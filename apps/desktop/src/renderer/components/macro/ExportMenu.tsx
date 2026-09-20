import { Download } from 'lucide-react';
import { useState } from 'react';

/** Compact report actions: copy / export / print behind one button. */
export function ExportMenu({
  onCopy,
  onExport,
  onPrint,
}: {
  onCopy: () => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  const [open, setOpen] = useState(false);

  const item = (label: string, run: () => void) => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        run();
      }}
      className="w-full rounded-input px-2 py-1.5 text-left text-[12px] text-text hover:bg-surface-2"
    >
      {label}
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="print-hide flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
      >
        <Download size={13} />
        导出
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-[150px] rounded-card border border-border bg-surface p-1 shadow-card">
          {item('复制汇报摘要', onCopy)}
          {item('导出 Markdown', onExport)}
          {item('打印', onPrint)}
        </div>
      )}
    </div>
  );
}
