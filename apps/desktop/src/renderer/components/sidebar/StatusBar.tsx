import type { ModelStatus, RuntimeStatus } from '@workbench/shared';

import { cn } from '@/lib/cn';
import { useRuntimeStore } from '@/lib/runtime';

const RUNTIME_TONE: Record<RuntimeStatus, string> = {
  ready: 'bg-ok',
  connecting: 'bg-warn',
  error: 'bg-error',
  offline: 'bg-muted',
};

const MODEL_TONE: Record<ModelStatus, string> = {
  connected: 'bg-ok',
  disconnected: 'bg-muted',
  error: 'bg-error',
};

/**
 * Global bottom status bar — shows runtime connection and model info.
 * Inspired by Reasonix's cost dashboard, but focused on connection health.
 */
export function StatusBar() {
  const runtime = useRuntimeStore((s) => s.status);
  const defaultModel = useRuntimeStore((s) => s.defaultModel);
  const model: ModelStatus = defaultModel ? 'connected' : 'disconnected';
  const modelName = defaultModel ? defaultModel.split('/').pop()! : '未设置';

  return (
    <div className="flex h-7 shrink-0 items-center border-t border-border bg-surface px-3 text-[12px] text-muted">
      {/* Left: runtime status */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            RUNTIME_TONE[runtime],
            runtime === 'connecting' && 'animate-pulse',
          )}
        />
        <span className="capitalize">{runtime}</span>
      </div>

      <span className="mx-2 text-border">|</span>

      {/* Right: model info */}
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', MODEL_TONE[model])} />
        <span className="truncate" title={defaultModel ?? ''}>
          {modelName}
        </span>
      </div>

      <div className="flex-1" />

      {/* Far right: workspace hint (empty for now, can be extended) */}
      <span className="text-fg-faint">工作台</span>
    </div>
  );
}
