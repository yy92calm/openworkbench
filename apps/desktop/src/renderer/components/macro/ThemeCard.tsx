import type { MacroThemeMeta } from '@workbench/shared';
import type { LucideIcon } from 'lucide-react';

/** One insight theme: generate (send), quote (prefill), or schedule daily. */
export function ThemeCard({
  theme,
  icon: Icon,
  onGenerate,
  onQuote,
  onSchedule,
}: {
  theme: MacroThemeMeta;
  icon: LucideIcon;
  onGenerate: () => void;
  onQuote: () => void;
  onSchedule: () => void;
}) {
  return (
    <div className="flex flex-col rounded-card border border-border bg-surface p-3.5 transition-colors hover:border-accent/40">
      <div className="flex items-center gap-2">
        <span className="rounded-input bg-accent/10 p-1.5 text-accent">
          <Icon size={15} />
        </span>
        <span className="text-[13px] font-medium text-text">{theme.title}</span>
      </div>
      <p className="mt-2 flex-1 text-[12px] leading-relaxed text-muted">{theme.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          className="rounded-input bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
        >
          生成洞察
        </button>
        <button
          type="button"
          onClick={onQuote}
          className="rounded-input border border-border px-2.5 py-1 text-[12px] text-text hover:bg-surface-2"
        >
          引用到对话
        </button>
        <button
          type="button"
          onClick={onSchedule}
          className="ml-auto text-[11px] text-muted hover:text-text"
        >
          设为每日任务
        </button>
      </div>
    </div>
  );
}
