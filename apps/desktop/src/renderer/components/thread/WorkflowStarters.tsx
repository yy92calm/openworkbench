import { ChevronRight, FileSearch, LineChart, Terminal, Command } from "lucide-react";
import logo from "@/assets/logo.webp";

export interface WorkflowStarter {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  prompt: string;
}

/** One-click starter prompts for an empty session. */
export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    id: "analyze",
    icon: <LineChart size={17} strokeWidth={1.75} />,
    title: "分析我的数据",
    description: "让 Agent 分析你添加的文件，生成图表和报告。",
    prompt:
      "Analyze the data file I added to the workspace end to end: explore it, run the analysis in code, " +
      "save at least one figure as a PNG, and write report.md with the findings — every number traced to " +
      "the code that produced it. Ask me which file to use if there is more than one candidate.",
  },
  {
    id: "build",
    icon: <Terminal size={17} strokeWidth={1.75} />,
    title: "构建脚本或工具",
    description: "描述你的需求，Agent 编写、运行并迭代代码。",
    prompt:
      "Help me build a small tool: ask what I need, then write the code, run it to verify it works, " +
      "and iterate until it does what I described. Keep all files in the workspace.",
  },
  {
    id: "explain",
    icon: <FileSearch size={17} strokeWidth={1.75} />,
    title: "解释文件",
    description: "逐段解读工作区中的文件，总结其功能。",
    prompt:
      "Pick a file in the workspace and explain what it does, step by step. Ask me which file to " +
      "explain if there is more than one candidate.",
  },
];

/**
 * Empty-session welcome: a quiet, centered composition in the app's paper
 * aesthetic. The conversation is the point, so the copy invites a message
 * first; the starters below are an optional on-ramp, not a dashboard.
 */
export function WorkflowStarters({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="relative flex min-h-[62vh] flex-col items-center justify-center">
      {/* Subtle warm gradient background */}
      <div className="pointer-events-none absolute inset-0 -top-12 bg-gradient-to-b from-accent/[0.04] via-transparent to-transparent" />
      <div className="relative w-full max-w-[500px]">
        <div className="text-center">
          {/* Brand logo */}
          <img src={logo} alt="" className="mx-auto h-[36px] w-auto opacity-80" />
          <div className="mt-4 text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted">
            新会话
          </div>
          <h2 className="mt-2.5 text-[26px] font-semibold leading-tight tracking-tight text-text">
            今天想做什么？
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            在下方描述你的任务 — 或从以下模板开始。
          </p>
        </div>

        <div className="mt-7 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {WORKFLOW_STARTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.prompt)}
              className="group relative flex w-full items-center gap-3.5 border-t border-border px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
            >
              {/* Accent left border on hover */}
              <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-full bg-accent opacity-0 transition-opacity group-hover:opacity-100" />
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-accent ring-1 ring-border transition-colors group-hover:bg-surface">
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-text">{s.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">{s.description}</span>
              </span>
              <ChevronRight
                size={16}
                className="shrink-0 text-muted/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted"
              />
            </button>
          ))}
        </div>

        {/* Keyboard shortcut hint */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-fg-faint">
          <Command size={11} />
          <span>按</span>
          <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">/</kbd>
          <span>搜索命令</span>
        </div>
      </div>
    </div>
  );
}
