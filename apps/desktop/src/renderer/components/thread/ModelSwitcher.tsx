import { Check, ChevronDown, Cpu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { useRuntimeStore } from '@/lib/runtime';

const PRESET_MODELS = [
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-3.5-sonnet-20241022',
  'anthropic/claude-3.5-haiku-20241022',
  'openai/gpt-4o-2024-11-20',
  'openai/gpt-4o-mini-2024-07-18',
  'deepseek/deepseek-chat',
  'google/gemini-2.0-flash-001',
];

/**
 * Model switcher dropdown — allows changing the default model.
 * Inspired by Reasonix's ModelSwitcher.
 */
export function ModelSwitcher() {
  const defaultModel = useRuntimeStore((s) => s.defaultModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const currentName = defaultModel ? defaultModel.split('/').pop()! : '未设置';

  const handleSelect = (_model: string) => {
    // This would call the runtime to switch models
    // For now, it's a visual component
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-input px-2 text-[11px] transition-colors',
          open ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
        )}
        aria-label="切换模型"
        title={defaultModel ?? '未设置'}
      >
        <Cpu size={12} />
        <span className="max-w-[100px] truncate">{currentName}</span>
        <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-dropdown mt-1 w-64 overflow-hidden rounded-card border border-border bg-surface shadow-pop">
          <div className="border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
            选择模型
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {PRESET_MODELS.map((model) => {
              const active = model === defaultModel;
              const name = model.split('/').pop()!;
              const provider = model.split('/')[0];
              return (
                <button
                  key={model}
                  onClick={() => handleSelect(model)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-2',
                    active && 'bg-accent/5',
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {active && <Check size={12} className="text-accent" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text">{name}</span>
                    <span className="block text-[10px] text-muted">{provider}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
