import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, Mic, Paperclip, Square, Terminal, X } from "lucide-react";
import { addFilesToWorkspace, addTextToWorkspace, isTauri } from "@/lib/tauri";
import { isSttSupported, startListening, stopAndTranscribe, cancelListening, isRecording } from "@/lib/stt";
import { loadVoiceConfig, type VoiceConfig } from "@/lib/tts";
import { useUiStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/** A paste longer than this becomes a workspace file chip instead of raw text. */
const PASTE_AS_FILE_CHARS = 2000;
const PASTE_AS_FILE_LINES = 25;
/** Max composer height before it scrolls internally. */
const MAX_HEIGHT_PX = 160;

// Terminal-style input history: every sent input (prompt, "!cmd", "/name args")
// in its typed form, shared across sessions, newest last, ↑/↓ to recall.
const HISTORY_KEY = "workbench.inputHistory";
const HISTORY_MAX = 100;
function readHistory(): string[] {
  try {
    const arr = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function recordHistory(entry: string): void {
  if (!entry) return;
  const prev = readHistory();
  if (prev[prev.length - 1] === entry) return; // consecutive duplicate
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([...prev, entry].slice(-HISTORY_MAX)));
  } catch {
    /* full or unavailable storage never blocks a send */
  }
}

/** A "/" palette entry — the runtime's config commands, skills and MCP prompts. */
export interface ComposerCommand {
  name: string;
  description?: string;
  source?: string;
}

/**
 * The "Ask anything" composer. Static mock sessions pass no `onSend`; the live
 * OpenCode session passes one to submit prompts to the runtime. Attached
 * workspace files show as removable chips above the input, not as prompt text.
 *
 * Two prefix modes (only when their handler is provided):
 *   `!`  — shell mode: the rest of the line runs directly in the session's
 *          workspace folder (terminal styling, no model turn).
 *   `/`  — command palette: pick a slash command (config command / skill /
 *          MCP prompt) with ↑/↓ + Tab/Enter, then type arguments and send.
 *          A "/name" that matches no known command stays a plain prompt.
 */
export function Composer({
  onSend,
  onRunShell,
  onRunCommand,
  commands = [],
  fileSuggestions = [],
  disabled,
  working,
  onStop,
  placeholder = "有什么想问的？",
}: {
  onSend?: (text: string) => void;
  onRunShell?: (command: string) => void;
  onRunCommand?: (name: string, args: string) => void;
  commands?: ComposerCommand[];
  /** File paths available for @ mentions (from thread artifacts/tool-calls). */
  fileSuggestions?: string[];
  disabled?: boolean;
  /** A turn is running: the send button becomes Stop (wired to `onStop`). */
  working?: boolean;
  onStop?: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  /** Highlighted palette row; clamped to the current matches. */
  const [sel, setSel] = useState(0);
  /** Esc closed the palette for the current input; typing reopens it. */
  const [paletteClosed, setPaletteClosed] = useState(false);
  /** A committed slash command: shown as a chip, the input holds arguments. */
  const [command, setCommand] = useState<string | null>(null);
  /** ↑/↓ history navigation; `draft` is what was typed before recalling. */
  const [hist, setHist] = useState<{ index: number; draft: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sttEnabled, setSttEnabled] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const voiceCfgRef = useRef<VoiceConfig | null>(null);

  useEffect(() => {
    void loadVoiceConfig().then((c) => {
      voiceCfgRef.current = c;
      setSttEnabled(c.sttEnabled);
    });
    void isSttSupported().then(setSttSupported);
  }, []);

  const toggleRecording = async () => {
    if (!sttSupported || !sttEnabled) return;
    if (recording) {
      // Stop recording → transcribe
      setRecording(false);
      setTranscribing(true);
      await stopAndTranscribe(
        (text) => {
          setValue((v) => (v ? `${v} ${text}` : text));
          taRef.current?.focus();
        },
        (err) => {
          toast.error(`语音识别错误: ${err}`);
        },
      );
      setTranscribing(false);
      return;
    }
    try {
      await startListening();
      setRecording(true);
    } catch (err) {
      toast.error(`无法启动录音: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const composerDraft = useUiStore((s) => s.composerDraft);
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);

  const shellMode = !!onRunShell && !command && value.startsWith("!");
  // The palette is open while the command NAME is being typed ("/na…"); the
  // first space ends name-typing (arguments follow) and closes it.
  const slashTyping = !!onRunCommand && !command && /^\/\S*$/.test(value);
  const query = slashTyping ? value.slice(1).toLowerCase() : "";
  const matches = slashTyping
    ? commands
        .filter((c) => c.name.toLowerCase().includes(query))
        .sort(
          (a, b) =>
            Number(b.name.toLowerCase().startsWith(query)) -
            Number(a.name.toLowerCase().startsWith(query)),
        )
    : [];
  const paletteOpen = matches.length > 0 && !paletteClosed && !disabled;
  const selIndex = Math.min(sel, Math.max(matches.length - 1, 0));

  // @ mention: detect "@" followed by text (not at start — that's slash commands)
  const atMatch = value.match(/@(\S*)$/);
  const atTyping = !command && !slashTyping && !!atMatch && atMatch.index !== undefined && atMatch.index > 0;
  const atQuery = atTyping ? atMatch[1].toLowerCase() : "";
  const fileMatches = atTyping && fileSuggestions.length > 0
    ? fileSuggestions
        .filter((f) => f.toLowerCase().includes(atQuery))
        .sort(
          (a, b) =>
            Number(b.toLowerCase().startsWith(atQuery)) -
            Number(a.toLowerCase().startsWith(atQuery)),
        )
        .slice(0, 8)
    : [];
  const atOpen = fileMatches.length > 0 && !disabled;

  // Each edit resets the palette: selection back to the top, Esc-close undone.
  useEffect(() => {
    setSel(0);
    setPaletteClosed(false);
  }, [value]);

  // Committing a command turns it into a chip; the input then holds only the
  // arguments — the "/name" can never degrade into ordinary prompt text.
  const pick = (c: ComposerCommand) => {
    setCommand(c.name);
    setValue("");
    taRef.current?.focus();
  };

  // Pick a file @ mention: replaces the "@query" with "@filename "
  const pickFile = (filePath: string) => {
    if (!atMatch) return;
    const before = value.slice(0, atMatch.index);
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    setValue(`${before}@${fileName} `);
    taRef.current?.focus();
  };

  const onChange = (v: string) => {
    setHist(null); // an edit leaves history navigation
    // A full known command name followed by whitespace commits it, same as a
    // pick — whether typed ("/init ") or pasted whole ("/init focus\n…"); the
    // remainder becomes the arguments. Unknown names (paths) stay plain text.
    if (onRunCommand && !command) {
      const m = /^\/(\S+)\s([\s\S]*)$/.exec(v);
      if (m && commands.some((c) => c.name === m[1])) {
        setCommand(m[1]);
        setValue(m[2]);
        taRef.current?.focus();
        return;
      }
    }
    setValue(v);
  };

  const unchip = () => {
    if (!command) return;
    setValue(value ? `/${command} ${value}` : `/${command}`);
    setCommand(null);
    taRef.current?.focus();
  };

  // Consume a draft another surface prepared (e.g. provenance "Reproduce") —
  // prefilled, never auto-sent: the user reviews and presses send. Text the
  // user was already typing is kept, with the draft appended below it.
  useEffect(() => {
    if (composerDraft === null) return;
    setValue((v) => (v.trim() ? `${v.trimEnd()}\n\n${composerDraft}` : composerDraft));
    setComposerDraft(null);
    taRef.current?.focus();
  }, [composerDraft, setComposerDraft]);

  // Auto-grow with the content, scroll internally beyond the cap.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    if (disabled) return;
    const text = value.trim();
    setHist(null);
    // A chipped command runs as itself — arguments optional.
    if (command) {
      onRunCommand?.(command, text);
      recordHistory(text ? `/${command} ${text}` : `/${command}`);
      setCommand(null);
      setValue("");
      return;
    }
    // "!" — run the rest of the line as a shell command (no model turn).
    if (shellMode) {
      const line = value.slice(1).trim();
      if (!line) return;
      onRunShell?.(line);
      recordHistory(`!${line}`);
      setValue("");
      return;
    }
    // "/name args" — run a KNOWN slash command; unknown names stay a prompt
    // (a message can legitimately start with a path like "/etc/hosts …").
    if (onRunCommand && text.startsWith("/")) {
      const name = text.slice(1).split(/\s/, 1)[0];
      if (commands.some((c) => c.name === name)) {
        onRunCommand(name, text.slice(1 + name.length).trim());
        recordHistory(text);
        setValue("");
        return;
      }
    }
    if (!text && files.length === 0) return;
    const fileNote =
      files.length > 0 ? `Files added to the workspace: ${files.join(", ")}` : "";
    onSend?.(text && fileNote ? `${text}\n\n${fileNote}` : text || fileNote);
    if (text) recordHistory(text);
    setValue("");
    setFiles([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // During IME composition (e.g. pinyin), Enter picks a candidate — it must
    // not send. WebKit reports the committing keydown as legacy keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // While the palette is open, the keyboard drives it, not the send.
    if (paletteOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteClosed(true);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        pick(matches[selIndex]);
        return;
      }
    }
    // @ mention popup navigation
    if (atOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        // Simple: just pick the first match on Enter, navigate not needed for now
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Remove the @ to close the popup
        if (atMatch) {
          const before = value.slice(0, atMatch.index);
          setValue(before);
        }
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        pickFile(fileMatches[0]);
        return;
      }
    }
    // Backspace on an empty input dissolves the command chip back into text.
    if (e.key === "Backspace" && command && value === "") {
      e.preventDefault();
      unchip();
      return;
    }
    // Terminal-style history: ↑ at the very start of the input recalls the
    // previous sent input; while navigating, ↑/↓ walk older/newer and walking
    // past the newest restores the unsent draft. Any edit leaves navigation.
    if (e.key === "ArrowUp" && !command) {
      const el = taRef.current;
      const atStart = !!el && el.selectionStart === 0 && el.selectionEnd === 0;
      if (hist || atStart) {
        const entries = readHistory();
        const index = (hist ? hist.index : entries.length) - 1;
        if (index >= 0) {
          e.preventDefault();
          setHist({ index, draft: hist ? hist.draft : value });
          setValue(entries[index]);
        }
        return;
      }
    }
    if (e.key === "ArrowDown" && hist) {
      e.preventDefault();
      const entries = readHistory();
      const index = hist.index + 1;
      if (index < entries.length) {
        setHist({ ...hist, index });
        setValue(entries[index]);
      } else {
        setValue(hist.draft);
        setHist(null);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Very long pastes become a workspace file chip instead of flooding the box.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!isTauri || !onSend) return;
    const text = e.clipboardData.getData("text/plain");
    if (text.length <= PASTE_AS_FILE_CHARS && text.split("\n").length <= PASTE_AS_FILE_LINES) {
      return; // normal paste
    }
    e.preventDefault();
    void (async () => {
      try {
        const name = await addTextToWorkspace("pasted.txt", text);
        setFiles((f) => [...f, name]);
      } catch (err) {
        toast.error(`Could not save paste: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };

  // Copy local files into the agent workspace; they appear as chips.
  const addFiles = async () => {
    setAdding(true);
    try {
      const names = await addFilesToWorkspace();
      if (names.length > 0) setFiles((f) => [...f, ...names]);
    } catch (err) {
      toast.error(`Could not add files: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAdding(false);
    }
  };

  const canAttach = isTauri && !!onSend;
  const canSend =
    !disabled &&
    (command
      ? true // a chipped command may run without arguments
      : shellMode
        ? value.slice(1).trim().length > 0
        : !!value.trim() || files.length > 0);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-surface transition-colors",
        working
          ? "border-accent/40"
          : shellMode
            ? "border-warn/50"
            : command
              ? "border-accent/40"
              : "border-border focus-within:border-accent/50",
      )}
    >
      {/* Running status strip */}
      {working && (
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-1.5 text-[12px] text-accent">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="font-medium">Agent 工作中…</span>
        </div>
      )}
      {/* @ mention popup */}
      {atOpen && (
        <div
          role="listbox"
          aria-label="文件引用"
          className="absolute bottom-full left-0 right-0 z-dropdown mb-2 max-h-48 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
        >
          {fileMatches.map((f, i) => (
            <button
              key={f}
              role="option"
              aria-selected={i === 0}
              className={cn(
                "flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left",
                i === 0 ? "bg-surface-2" : "hover:bg-surface-2",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pickFile(f);
              }}
            >
              <span className="shrink-0 text-muted">
                <Paperclip size={11} />
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">{f}</span>
            </button>
          ))}
        </div>
      )}
      {paletteOpen && (
        <div
          role="listbox"
          aria-label="命令列表"
          className="absolute bottom-full left-0 right-0 z-dropdown mb-2 max-h-64 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
        >
          {matches.map((c, i) => (
            <button
              key={c.name}
              role="option"
              aria-selected={i === selIndex}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-input px-2 py-1.5 text-left",
                i === selIndex ? "bg-surface-2" : "hover:bg-surface-2",
              )}
              // mousedown, not click — a click would blur the textarea first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="shrink-0 font-mono text-xs text-text">/{c.name}</span>
              {c.description && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.description}</span>
              )}
              {(c.source === "skill" || c.source === "mcp") && (
                <span className="shrink-0 rounded px-1 py-0.5 text-[10px] uppercase text-muted ring-1 ring-border">
                  {c.source}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2">
          {files.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1.5 rounded-input bg-surface-2 py-1 pl-2 pr-1 font-mono text-xs text-text ring-1 ring-border"
            >
              <Paperclip size={11} className="shrink-0 text-muted" />
              <span className="max-w-[220px] truncate">{name}</span>
              <button
                className="rounded p-0.5 text-muted hover:bg-border hover:text-text"
                aria-label={`移除 ${name}`}
                onClick={() => setFiles((f) => f.filter((n) => n !== name))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={(e: DragEvent<HTMLTextAreaElement>) => {
          if (!isTauri || !onSend) return;
          const droppedFiles = e.dataTransfer.files;
          if (droppedFiles.length > 0) {
            e.preventDefault();
            const names: string[] = [];
            for (let i = 0; i < droppedFiles.length; i++) {
              names.push(droppedFiles[i].name);
            }
            setFiles((f) => [...f, ...names]);
          }
        }}
        placeholder={
          command
            ? "参数（可选）— Enter 运行"
            : shellMode
              ? "在工作区目录中运行 Shell 命令"
              : placeholder
        }
        className={cn(
          "max-h-[160px] w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-6 text-text outline-none placeholder:text-muted",
          (shellMode || command) && "font-mono",
        )}
        aria-label="有什么想问的？"
      />
      <div className={cn(
        "flex items-center gap-1.5 px-3 pb-2.5 pt-1",
        (value || files.length > 0 || command || shellMode) && "border-t border-border-soft/60 mt-0 pt-2",
      )}>
        {command ? (
          <span
            className="flex h-7 shrink-0 items-center gap-1 rounded-input bg-accent/15 pl-2 pr-1 font-mono text-xs text-accent"
            title="运行此命令 — 输入参数，或按 Backspace 编辑名称"
          >
            /{command}
            <button
              className="rounded p-0.5 hover:bg-accent/20"
              aria-label="移除命令"
              onClick={unchip}
            >
              <X size={11} />
            </button>
          </span>
        ) : shellMode ? (
          <span
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-input bg-warn/15 px-2 font-mono text-xs text-warn ring-1 ring-warn/20"
            title="直接在会话工作区目录中执行"
          >
            <Terminal size={12} />
            <span className="font-medium">shell</span>
          </span>
        ) : (
          canAttach && (
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
              aria-label="添加文件"
              title="添加本地文件到工作区"
              onClick={() => void addFiles()}
              disabled={adding}
            >
              <Paperclip size={15} />
            </button>
          )
        )}
        {sttSupported && sttEnabled && !command && !shellMode && (
          <button
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-input transition-colors disabled:opacity-40",
              recording
                ? "text-accent bg-accent/15"
                : transcribing
                  ? "text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-text",
            )}
            aria-label={recording ? "停止录音" : transcribing ? "转写中…" : "语音输入"}
            title={recording ? "点击停止录音并转写" : transcribing ? "正在转写…" : "语音输入"}
            onClick={() => void toggleRecording()}
            disabled={transcribing}
          >
            {transcribing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Mic size={15} className={recording ? "animate-pulse" : ""} />
            )}
          </button>
        )}
        <span className="flex-1" />
        {working && onStop ? (
          // Same spot, same shape, one action: the send button becomes Stop
          // while the agent works — always live, even though the input is not.
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity hover:opacity-85"
            aria-label="停止"
            title="中断本轮对话（Esc）"
            onClick={onStop}
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-all hover:opacity-85 disabled:opacity-30"
            aria-label="发送"
            onClick={submit}
            disabled={!canSend}
            title={!canSend ? "输入消息或添加文件后发送" : "发送消息"}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
