import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";

/**
 * Read-only list of the `.opencode/` profile's always-injected context: the
 * capabilities every session starts with. Read straight from the runtime store
 * (skills/agents/mcpServers), which are loaded by loadCatalog/loadMcpServers.
 *
 * Each group (agents / skills / MCP) is a collapsible section that defaults to
 * collapsed so a large profile doesn't dominate the panel. Empty sections
 * render nothing.
 */
export function AutoContext() {
  const skills = useRuntimeStore((s) => s.skills);
  const agents = useRuntimeStore((s) => s.agents);
  const mcpServers = useRuntimeStore((s) => s.mcpServers);

  const hasAny = skills.length > 0 || agents.length > 0 || mcpServers.length > 0;

  return (
    <div className="border-t border-border-soft/60 px-4 py-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
        自动上下文
      </div>
      {!hasAny && (
        <div className="text-[12px] text-muted">
          当前 profile 未注入 skills、agents 或 MCP 服务。
        </div>
      )}

      {agents.length > 0 && (
        <Section title={`Agents (${agents.length})`}>
          {agents.map((a) => (
            <Row key={a.name} name={a.name} hint={a.description} />
          ))}
        </Section>
      )}

      {skills.length > 0 && (
        <Section title={`Skills (${skills.length})`}>
          {skills.map((s) => (
            <Row key={s.name} name={s.name} hint={s.description} />
          ))}
        </Section>
      )}

      {mcpServers.length > 0 && (
        <Section title={`MCP (${mcpServers.length})`}>
          {mcpServers.map((m) => (
            <Row
              key={m.name}
              name={m.name}
              tone={m.status === "connected" ? "ok" : m.status === "failed" ? "error" : "muted"}
              hint={m.status}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2.5 last:mb-0">
      <button
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-surface-2"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight
          size={13}
          className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")}
        />
        <span className="flex-1 text-[11px] text-text-dim">{title}</span>
      </button>
      {open && <div className="mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}

function Row({
  name,
  hint,
  tone = "muted",
}: {
  name: string;
  hint?: string;
  tone?: "ok" | "error" | "muted";
}) {
  const dot = tone === "ok" ? "bg-ok" : tone === "error" ? "bg-error" : "bg-muted";
  return (
    <div className="flex items-center gap-1.5 rounded-input px-1 py-0.5">
      <span className={cn("h-1 w-1 shrink-0 rounded-full", dot)} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-text" title={name}>
        {name}
      </span>
      {hint && (
        <span className="shrink-0 truncate text-[11px] text-muted" title={hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
