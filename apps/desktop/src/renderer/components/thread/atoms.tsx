import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Paperclip, Pencil, Volume2, Square } from "lucide-react";
import type {
  ArtifactBlock,
  DataTableBlock,
  RunningJobsBlock,
  StatusLineBlock,
  UserMessageBlock,
} from "@workbench/shared";
import { cn } from "@/lib/cn";
import { speak, cancelSpeak, loadVoiceConfig, type VoiceConfig } from "@/lib/tts";
import { MarkdownViewer } from "@/components/markdown-viewer/MarkdownViewer";
import { extractArtifactRefs, refToArtifactBlock } from "@/lib/artifacts";
import { resolveArtifactPath } from "@/lib/artifactFile";

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return { copied, onCopy };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function UserMessage({ block, onEdit }: { block: UserMessageBlock; onEdit?: (text: string) => void }) {
  const { copied, onCopy } = useCopy(block.text);
  return (
    <div className="flex justify-end">
      <div className="group max-w-[80%]">
        <div
          className="rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed"
          style={{
            background: "var(--chat-user-bg)",
            border: "1px solid var(--chat-user-border)",
            color: "var(--chat-user-fg)",
          }}
        >
          <div className="whitespace-pre-wrap break-words">{block.text}</div>
        </div>
        <div className="mt-1 flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {block.timestamp && (
            <span className="text-[11px] text-muted">{formatTime(block.timestamp)}</span>
          )}
          {onEdit && (
            <button
              className="rounded p-0.5 text-muted hover:text-text"
              title="编辑并重新发送"
              onClick={() => onEdit(block.text)}
            >
              <Pencil size={11} />
            </button>
          )}
          <button
            className="rounded p-0.5 text-muted hover:text-text"
            title="复制"
            onClick={onCopy}
          >
            {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentMessage({
  markdown,
  timestamp,
  streaming,
  onOpenArtifact,
}: {
  markdown: string;
  timestamp?: number;
  /** True while the message is still streaming (no timestamp yet). Shows a
   *  blinking caret at the end of the text. */
  streaming?: boolean;
  onOpenArtifact?: (a: ArtifactBlock) => void;
}) {
  const { copied, onCopy } = useCopy(markdown);
  const [speaking, setSpeaking] = useState(false);
  const voiceCfgRef = useRef<VoiceConfig | null>(null);

  useEffect(() => {
    void loadVoiceConfig().then((c) => { voiceCfgRef.current = c; });
  }, []);

  const onSpeak = () => {
    if (speaking) {
      cancelSpeak();
      setSpeaking(false);
      return;
    }
    const cfg = voiceCfgRef.current;
    if (!cfg?.ttsEnabled) return;
    speak(markdown, { voiceURI: cfg.voiceURI ?? undefined, rate: cfg.rate, pitch: cfg.pitch });
    setSpeaking(true);
    // Poll until speech ends (no onend in speechSynthesis directly).
    const check = setInterval(() => {
      if (!window.speechSynthesis?.speaking) {
        setSpeaking(false);
        clearInterval(check);
      }
    }, 200);
  };
  // Files the agent mentions (e.g. a PDF produced by running code) become clickable.
  // Each mention is resolved to a real workspace path first — prose often names a
  // bare filename ("index.html") whose file lives in a subdirectory; mentions of
  // files that don't exist get no chip.
  const mentioned = onOpenArtifact ? extractArtifactRefs(markdown) : [];
  const [refs, setRefs] = useState<string[]>([]);
  const mentionedKey = mentioned.join("\n");
  useEffect(() => {
    let cancelled = false;
    if (!mentionedKey) {
      setRefs([]);
      return;
    }
    void Promise.all(mentionedKey.split("\n").map((p) => resolveArtifactPath(p).catch(() => null))).then(
      (resolved) => {
        if (cancelled) return;
        setRefs([...new Set(resolved.filter((p): p is string => p !== null))]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mentionedKey]);
  return (
    <div className="group flex gap-3">
      {/* Left accent line — subtle agent identifier */}
      <div className="w-[2px] shrink-0 self-stretch rounded-full bg-accent/25" />
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div className="text-[14px] leading-relaxed text-text">
          <MarkdownViewer>{markdown}</MarkdownViewer>
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse rounded-sm bg-accent align-text-bottom" />
          )}
        </div>
        {refs.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {refs.map((path) => (
              <button
                key={path}
                onClick={() => onOpenArtifact?.(refToArtifactBlock(path))}
                className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-2 py-1 text-xs text-text transition-colors hover:bg-surface-2 hover:border-accent/30"
                title={`预览 ${path}`}
              >
                <Paperclip size={12} className="text-accent" />
                <span className="font-mono">{path.split(/[\\/]/).pop()}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {timestamp && (
            <span className="text-[10px] text-muted">{formatTime(timestamp)}</span>
          )}
          {voiceCfgRef.current?.ttsEnabled && !streaming && (
            <button
              className={cn(
                "rounded p-0.5 text-muted hover:text-text",
                speaking && "text-accent",
              )}
              title={speaking ? "停止朗读" : "朗读"}
              onClick={onSpeak}
            >
              {speaking ? (
                <span className="flex h-3 w-3 items-center justify-center">
                  <span className="h-2 w-2 animate-pulse rounded-sm bg-accent" />
                </span>
              ) : (
                <Volume2 size={11} />
              )}
            </button>
          )}
          <button
            className="rounded p-0.5 text-muted hover:text-text"
            title="复制回复"
            onClick={onCopy}
          >
            {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DataTable({ block }: { block: DataTableBlock }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
      {block.caption && (
        <div className="border-b border-border px-4 py-2 text-xs text-muted">{block.caption}</div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            {block.columns.map((c) => (
              <th key={c} className="px-4 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-4 py-2 text-text",
                    j === row.length - 1 && "font-mono text-[13px] text-link",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunningJobsOverlay({ block }: { block: RunningJobsBlock }) {
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted">
        {block.title}
      </div>
      <ul className="divide-y divide-border/60">
        {block.jobs.map((j, i) => (
          <li key={i} className="flex items-center gap-2 px-4 py-2 text-sm">
            <Loader2 size={13} className="animate-spin text-accent" />
            <span className="flex-1 truncate text-text">{j.label}</span>
            <span className="text-xs text-muted">{j.elapsed}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TONE: Record<NonNullable<StatusLineBlock["tone"]>, string> = {
  running: "text-accent",
  done: "text-ok",
  error: "text-error",
};

export function StatusLine({ block }: { block: StatusLineBlock }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", TONE[block.tone ?? "done"])}>
      <Loader2
        size={14}
        className={cn(block.tone === "running" && "animate-spin", block.tone !== "running" && "hidden")}
      />
      <span>{block.text}</span>
    </div>
  );
}
