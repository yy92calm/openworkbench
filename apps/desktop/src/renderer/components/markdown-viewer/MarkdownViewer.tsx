import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import { Check, Clipboard, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { kernelExecute, formatExecResult } from "@/lib/kernel";

function useCopyCode(text: string) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };
  return { copied, onCopy };
}

type Variant = "chat" | "document";

const STYLES: Record<Variant, Record<string, string>> = {
  chat: {
    root: "text-[15px] leading-relaxed text-text",
    p: "my-2 first:mt-0 last:mb-0",
    a: "text-link underline underline-offset-2",
    code: "rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-link",
    pre: "my-3 overflow-x-auto rounded-input border-l-2 border-accent/30 bg-code-bg p-3 font-mono text-[13px] leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-code-text",
    ul: "my-2 ml-5 list-disc space-y-1",
    ol: "my-2 ml-5 list-decimal space-y-1",
    h1: "mb-3 mt-5 text-2xl font-semibold first:mt-0",
    h2: "mb-2 mt-5 text-xl font-semibold first:mt-0",
    h3: "mb-2 mt-4 text-lg font-semibold first:mt-0",
    h4: "mb-1.5 mt-3 text-base font-semibold first:mt-0",
    blockquote: "my-2 border-l-2 border-border pl-3 text-muted",
    hr: "my-4 border-border",
    table: "border-collapse text-sm",
    th: "border border-border bg-surface-2 px-3 py-1.5 text-left font-semibold",
    td: "border border-border px-3 py-1.5",
  },
  document: {
    root: "text-[16px] leading-[1.8] text-[#2b2620] antialiased [font-feature-settings:'liga','kern'] [font-family:-apple-system,'SF_Pro_Text','Segoe_UI','PingFang_SC','Microsoft_YaHei',sans-serif] selection:bg-[#f2d9cd]",
    p: "my-4 tracking-[0.006em] [text-wrap:pretty] first:mt-0 last:mb-0",
    a: "font-medium text-[#bf5a34] underline decoration-[#e2bdac] decoration-1 underline-offset-[3px] transition-colors hover:decoration-[#bf5a34]",
    code: "rounded-[4px] bg-[#f7f0ea] px-1.5 py-0.5 font-mono text-[13px] text-[#a94e2c] ring-1 ring-[#eee0d6]",
    pre: "my-5 overflow-x-auto rounded-lg bg-[#faf6f2] p-4 font-mono text-[13px] leading-6 ring-1 ring-[#ece2d9] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[#4b433a] [&_code]:ring-0",
    ul: "my-4 ml-[1.15em] list-disc space-y-2 marker:text-[#c98a6b]",
    ol: "my-4 ml-[1.15em] list-decimal space-y-2 marker:text-[13px] marker:font-medium marker:text-[#c98a6b]",
    h1: "mb-3 mt-10 text-[33px] font-bold leading-[1.25] tracking-[-0.01em] text-[#1c1915] [text-wrap:balance] first:mt-0 [font-family:'Iowan_Old_Style','Charter',Georgia,'Songti_SC','Noto_Serif_CJK_SC',serif]",
    h2: "mb-4 mt-11 flex items-baseline gap-2.5 text-[23px] font-semibold leading-snug tracking-[-0.005em] text-[#1c1915] [text-wrap:balance] before:relative before:top-[0.14em] before:h-[0.82em] before:w-[3px] before:shrink-0 before:rounded-full before:bg-[#c15f3c] before:content-[''] first:mt-0 [font-family:'Iowan_Old_Style','Charter',Georgia,'Songti_SC','Noto_Serif_CJK_SC',serif]",
    h3: "mb-2 mt-8 text-[18.5px] font-semibold leading-snug text-[#2b2620] first:mt-0 [font-family:'Iowan_Old_Style','Charter',Georgia,'Songti_SC','Noto_Serif_CJK_SC',serif]",
    h4: "mb-2 mt-6 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-[#9a8d7c] first:mt-0",
    blockquote: "my-5 rounded-r-md border-l-[3px] border-[#d98c6a] bg-[#faf6f2] py-1.5 pl-5 pr-4 text-[#6b6155] [&_p]:my-1.5",
    hr: "mx-auto my-10 w-12 border-t-2 border-[#e6ddd2]",
    table: "border-collapse text-[14px] tabular-nums",
    th: "border-b-2 border-[#e2d5c8] px-4 py-2.5 text-left font-semibold text-[#1c1915]",
    td: "border-b border-[#efe8df] px-4 py-2.5",
  },
};

function CodeBlock({
  language,
  code,
  variant,
  streaming,
}: {
  language: string | undefined;
  code: string;
  variant: Variant;
  /** True while the enclosing message is still streaming. A code block that
   *  has not yet hit its closing ``` re-runs on every token; skipping the
   *  highlight until the fence closes avoids burning CPU on a half-typed
   *  block (the fence's completion flips this back to highlighting once). */
  streaming?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const { copied, onCopy } = useCopyCode(code);
  const s = STYLES[variant];

  // Cache the highlight by its inputs — re-highlighting an unchanged code
  // block is pure waste (react-markdown re-parses the whole document each
  // render). Prefer the known-language path: hljs.highlightAuto is expensive.
  const highlighted = useMemo(() => {
    if (streaming) return null;
    return language
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value;
  }, [language, code, streaming]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setOutput("running…");
    try {
      const lang = language === "python" || language === "py" ? "python3" : "bash";
      const res = await kernelExecute(code, lang);
      setOutput(res ? formatExecResult(res) : "(execution unavailable)");
    } catch {
      setOutput("execution error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="group relative">
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3 py-1.5 text-[11px] text-muted">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono uppercase ring-1 ring-border/60">{language || "text"}</span>
        <div className="flex-1" />
        {/* Copy button — always visible on hover */}
        <button
          onClick={onCopy}
          className="hidden items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-surface hover:text-text group-hover:flex"
          title="Copy code"
        >
          {copied ? <Check size={11} className="text-ok" /> : <Clipboard size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {variant === "chat" && (
          <button
            onClick={() => void run()}
            disabled={running}
            className="hidden items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-surface hover:text-text group-hover:flex disabled:opacity-50"
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Run
          </button>
        )}
      </div>
      <pre className={cn(s.pre, "!mt-0 !rounded-t-none")}>
        {highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
      {output && (
        <pre className="overflow-x-auto rounded-b-input border-t border-border bg-surface-2 p-3 font-mono text-[12px] text-text">
          {output}
        </pre>
      )}
    </div>
  );
}

export const MarkdownViewer = memo(function MarkdownViewer({
  children,
  className,
  variant = "chat",
  streaming = false,
}: {
  children: string;
  className?: string;
  variant?: Variant;
  /** True while the message is still streaming in. Code blocks skip their
   *  highlight until the fence closes (see CodeBlock). */
  streaming?: boolean;
}) {
  const s = STYLES[variant];
  return (
    <div className={cn(s.root, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={s.p}>{children}</p>,
          a: ({ children, href }) => (
            <a href={href} className={s.a}>
              {children}
            </a>
          ),
          code: ({ className: cls, children }) => {
            const inline = !cls;
            if (inline) {
              return <code className={s.code}>{children}</code>;
            }
            const language = cls?.replace("language-", "");
            const code = String(children).replace(/\n$/, "");
            return <CodeBlock language={language} code={code} variant={variant} streaming={streaming} />;
          },
          pre: ({ children }) => <>{children}</>,
          ul: ({ children }) => <ul className={s.ul}>{children}</ul>,
          ol: ({ children }) => <ol className={s.ol}>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h1 className={s.h1}>{children}</h1>,
          h2: ({ children }) => <h2 className={s.h2}>{children}</h2>,
          h3: ({ children }) => <h3 className={s.h3}>{children}</h3>,
          h4: ({ children }) => <h4 className={s.h4}>{children}</h4>,
          blockquote: ({ children }) => <blockquote className={s.blockquote}>{children}</blockquote>,
          hr: () => <hr className={s.hr} />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className={s.table}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th className={s.th}>{children}</th>,
          td: ({ children }) => <td className={s.td}>{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}, (a, b) => a.children === b.children && a.streaming === b.streaming && a.className === b.className && a.variant === b.variant);