import type { TurnDividerBlock } from '@workbench/shared';

export function TurnDivider({ block }: { block: TurnDividerBlock }) {
  return (
    <div className="flex items-center gap-3 py-3" aria-hidden>
      <div className="h-px flex-1 bg-border-soft/60" />
      {block.label && (
        <span className="px-2 text-[11px] tracking-wide text-fg-faint">{block.label}</span>
      )}
      <div className="h-px flex-1 bg-border-soft/60" />
    </div>
  );
}
