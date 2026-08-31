import { Command } from 'cmdk';
import {
  FileSearch,
  Moon,
  NotebookPen,
  PackagePlus,
  Plus,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { WORKFLOW_STARTERS } from '@/components/thread/WorkflowStarters';
import { useRuntimeStore } from '@/lib/runtime';
import { useUiStore } from '@/lib/store';

interface Action {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

/** Prompt for a starter workflow by id, so ⌘K and the empty-session cards stay in sync. */
const starterPrompt = (id: string) => WORKFLOW_STARTERS.find((s) => s.id === id)?.prompt ?? '';

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useUiStore.getState().paletteOpen);
      }
      // "/" opens the palette when not typing in an input/textarea
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setOpen(true);
      }
      // Consume Esc only when the palette is open — a marked-handled Esc must
      // not also interrupt a running agent turn (LiveSessionPage listens too).
      if (e.key === 'Escape' && useUiStore.getState().paletteOpen) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const close = () => setOpen(false);

  // Start a new session and send a workflow prompt, then reveal that session.
  const runWorkflow = async (starterId: string) => {
    close();
    useRuntimeStore.getState().startDraft();
    const id = await useRuntimeStore.getState().sendPrompt(starterPrompt(starterId));
    if (id) navigate(`/live/${id}`);
  };

  const actions: Action[] = [
    {
      id: 'new',
      label: '新建会话',
      icon: <Plus size={16} />,
      run: () => {
        useRuntimeStore.getState().startDraft();
        navigate('/live');
        close();
      },
    },
    {
      id: 'analyze',
      label: '数据分析（新工作流）',
      icon: <FileSearch size={16} />,
      run: () => void runWorkflow('analyze'),
    },
    {
      id: 'review',
      label: '报告审核（可追溯审查）',
      icon: <ShieldCheck size={16} />,
      run: () => void runWorkflow('audit'),
    },
    {
      id: 'notebooks',
      label: '打开笔记本',
      icon: <NotebookPen size={16} />,
      run: () => {
        navigate('/notebooks');
        close();
      },
    },
    {
      id: 'skills',
      label: '管理技能',
      icon: <PackagePlus size={16} />,
      run: () => {
        navigate('/skills');
        close();
      },
    },
    {
      id: 'settings',
      label: '打开设置',
      icon: <Settings size={16} />,
      run: () => {
        navigate('/settings');
        close();
      },
    },
    {
      id: 'theme',
      label: '切换浅色/深色主题',
      icon: <Moon size={16} />,
      run: () => {
        toggleTheme();
        close();
      },
    },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-palette flex items-start justify-center bg-black/20 pt-[16vh]"
      onClick={close}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
        <Command
          label="命令面板"
          className="overflow-hidden rounded-card border border-border bg-surface shadow-pop"
        >
          <Command.Input
            autoFocus
            placeholder="输入命令…"
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-text outline-none placeholder:text-muted"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
              无结果。
            </Command.Empty>
            {actions.map((a) => (
              <Command.Item
                key={a.id}
                value={a.label}
                onSelect={a.run}
                className="flex cursor-pointer items-center gap-3 rounded-input px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-2"
              >
                <span className="text-muted">{a.icon}</span>
                {a.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
