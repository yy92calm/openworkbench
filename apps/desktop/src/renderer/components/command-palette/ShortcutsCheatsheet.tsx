import { X } from 'lucide-react';

interface ShortcutGroup {
  label: string;
  items: { keys: string[]; desc: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    label: '通用',
    items: [
      { keys: ['Cmd', 'K'], desc: '打开命令面板' },
      { keys: ['Cmd', 'B'], desc: '切换侧边栏' },
      { keys: ['Cmd', '+'], desc: '放大字体' },
      { keys: ['Cmd', '-'], desc: '缩小字体' },
      { keys: ['Cmd', '0'], desc: '重置字体大小' },
    ],
  },
  {
    label: '对话',
    items: [
      { keys: ['Enter'], desc: '发送消息' },
      { keys: ['Shift', 'Enter'], desc: '换行' },
      { keys: ['↑'], desc: '上一条历史输入' },
      { keys: ['↓'], desc: '下一条历史输入' },
      { keys: ['Esc'], desc: '中断 Agent 回复' },
    ],
  },
  {
    label: '编辑器',
    items: [
      { keys: ['/'], desc: '输入命令（斜杠命令）' },
      { keys: ['@'], desc: '引用文件' },
      { keys: ['!'], desc: 'Shell 模式' },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-surface-2 px-1.5 font-mono text-[10px] text-text shadow-sm">
      {children}
    </kbd>
  );
}

/**
 * Keyboard shortcuts reference cheatsheet. Rendered as a modal overlay.
 * Inspired by Reasonix's ShortcutsCheatsheet.
 */
export function ShortcutsCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-card border border-border bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text">快捷键</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
                {group.label}
              </div>
              <div className="space-y-1.5">
                {group.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[12px] text-text">{item.desc}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-muted">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
