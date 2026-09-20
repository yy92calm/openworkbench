import type { MacroNotification } from '@workbench/shared';
import { Bell } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import { useMacroStore } from '@/lib/macroStore';

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/** Bell menu: daily briefings + indicator alerts, with unread state. */
export function NotificationsMenu({ onOpen }: { onOpen: (n: MacroNotification) => void }) {
  const items = useMacroStore((s) => s.items);
  const unread = useMacroStore((s) => s.unread);
  const markRead = useMacroStore((s) => s.markRead);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="宏观通知"
        className="relative rounded-input p-1.5 text-muted hover:bg-surface-2 hover:text-text"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-[300px] rounded-card border border-border bg-surface p-2 shadow-card">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[12px] font-medium text-text">通知</span>
            <button
              type="button"
              onClick={() => void markRead()}
              className="text-[11px] text-muted hover:text-text"
            >
              全部已读
            </button>
          </div>
          {items.length === 0 && (
            <div className="px-1 py-3 text-[12px] leading-relaxed text-muted">
              暂无通知。每日简报生成、指标异动时会显示在这里。
            </div>
          )}
          <div className="max-h-[320px] overflow-y-auto">
            {items.slice(0, 20).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  void markRead(n.id);
                  setOpen(false);
                  onOpen(n);
                }}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-input px-2 py-1.5 text-left hover:bg-surface-2',
                  !n.read && 'bg-accent/5',
                )}
              >
                <span className="text-[12px] text-text">{n.title}</span>
                <span className="text-[11px] text-muted">
                  {stamp(n.createdAt)}
                  {n.body ? ` · ${n.body}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
