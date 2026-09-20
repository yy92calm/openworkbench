import type { ModelStatus, RuntimeStatus, SandboxStatus } from '@workbench/shared';

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

/** Sandbox dot: green when enforced, grey for an explicit full-access
 *  configuration, amber when the platform/backend could not enforce it. */
function sandboxTone(s: SandboxStatus): string {
  if (s.effective) return 'bg-ok';
  return s.config.mode === 'full-access' ? 'bg-muted' : 'bg-warn';
}

/** Sandbox label: the mode when enforced (or deliberately off), otherwise
 *  the mode plus a visible "未生效" so a silent fallback never looks safe. */
function sandboxLabel(s: SandboxStatus): string {
  if (s.effective || s.config.mode === 'full-access') return s.config.mode;
  return `${s.config.mode} 未生效`;
}

/**
 * Global bottom status bar — shows runtime connection, model info and the
 * sandbox enforcement state. Inspired by Reasonix's cost dashboard, but
 * focused on connection health.
 */
export function StatusBar() {
  const runtime = useRuntimeStore((s) => s.status);
  const defaultModel = useRuntimeStore((s) => s.defaultModel);
  const sandbox = useRuntimeStore((s) => s.sandbox);
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

      {/* Model info */}
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', MODEL_TONE[model])} />
        <span className="truncate" title={defaultModel ?? ''}>
          {modelName}
        </span>
      </div>

      {/* Sandbox enforcement (hidden until the first IPC refresh lands) */}
      {sandbox && (
        <>
          <span className="mx-2 text-border">|</span>
          <div className="flex items-center gap-1.5" title={sandbox.detail}>
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', sandboxTone(sandbox))} />
            <span className="truncate">沙盒 {sandboxLabel(sandbox)}</span>
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Far right: workspace hint (empty for now, can be extended) */}
      <span className="text-fg-faint">工作台</span>
    </div>
  );
}
