/**
 * Renders one rich fence (```html / ```svg / ```echarts) of an agent message.
 *
 * State machine (see docs/20260906-01-rich-fence-rendering.md):
 *   open + streaming   -> placeholder card (content never shown half-typed)
 *   closed + valid     -> live preview (sandboxed iframe / <img> / echarts)
 *   closed + invalid   -> plain CodeBlock fallback
 *   open + final       -> CodeBlock fallback (truncated output stays visible)
 *
 * Security: the content is untrusted model output. HTML only ever runs inside
 * a sandboxed opaque-origin iframe, SVG only via <img> (scripts never run in
 * image documents) and echarts parses declarative option JSON only. No channel
 * reaches back into app code.
 */
import { Check, Clipboard, Loader2 } from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useRef } from 'react';

import { MiniTable } from '@/components/thread/MiniTable';
import { type ParsedTable, parseTableFile } from '@/lib/csv';
import { useUiStore } from '@/lib/store';

import { CodeBlock, useCopyCode } from './CodeBlock';

/** Encode an SVG document as an <img>-safe data URI. Returns null when the
 *  content is not a parseable SVG document (caller falls back to code). */
function svgDataUri(raw: string): string | null {
  // DOMParser is a browser API — this module only runs in the renderer.
  const clean = raw.replace(/^\s*<\?xml[\s\S]*?\?>\s*/, '');
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (doc.documentElement?.localName !== 'svg') return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}

/** Strict JSON parse of an echarts option; null when not an object. */
function parseEchartsOption(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw.trim());
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Minimal instance surface we use, declared locally so the lazy echarts
 *  import never drags its full type surface into renderer bundles. */
type ChartInstance = {
  setOption(option: Record<string, unknown>, opts?: Record<string, unknown>): void;
  resize(): void;
  dispose(): void;
};

/** Lazily-loading echarts instance kept in sync with the parsed option. */
function EchartsPreview({ option }: { option: Record<string, unknown> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Subscribing to the theme keeps charts restyled when the user flips themes.
  const theme = useUiStore((s) => s.theme);
  const dark = theme === 'dark' || theme === 'black';

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let disposed = false;
    let chart: ChartInstance | null = null;
    let observer: ResizeObserver | null = null;
    // echarts (~1MB) loads on first use, never at app startup.
    void import('echarts').then((m) => {
      if (disposed) return;
      chart = m.init(el, dark ? 'dark' : undefined) as unknown as ChartInstance;
      chart.setOption(option, { notMerge: true });
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(el);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [option, dark]);

  return <div ref={boxRef} className="h-[380px] w-full" />;
}

/** The frame every rich fence preview shares: header with language chip and
 *  copy (source stays reachable), body holds the live renderer. */
function PreviewCard({
  language,
  content,
  children,
}: {
  language: string;
  content: string;
  children: ReactNode;
}) {
  const { copied, onCopy } = useCopyCode(content);
  return (
    <div className="group relative my-3 overflow-hidden rounded-input border border-border-soft bg-surface/40">
      <div className="flex items-center gap-1.5 border-b border-border-soft px-3 py-1.5 text-[11px] text-muted">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono uppercase ring-1 ring-border/60">
          {language}
        </span>
        <span className="text-[10px]">已渲染为预览 · 复制可取源码</span>
        <div className="flex-1" />
        <button
          onClick={onCopy}
          className="hidden items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-surface hover:text-text group-hover:flex"
          title="Copy source"
        >
          {copied ? <Check size={11} className="text-ok" /> : <Clipboard size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {children}
    </div>
  );
}

/** Placeholder shown while the fence is still streaming in. */
function PendingCard({ language }: { language: string }) {
  return (
    <div className="my-3 flex items-center gap-2 rounded-input border border-border-soft bg-surface/40 px-3 py-2.5 text-[11px] text-muted">
      <Loader2 size={12} className="animate-spin text-accent" />
      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono uppercase ring-1 ring-border/60">
        {language}
      </span>
      <span>正在生成预览…</span>
    </div>
  );
}

export const FencePreview = memo(function FencePreview({
  language,
  content,
  closed,
  streaming,
  variant = 'chat',
}: {
  language: string;
  content: string;
  closed: boolean;
  streaming?: boolean;
  /** Code-block style for the degraded fallback (chat vs document). */
  variant?: 'chat' | 'document';
}) {
  const parsed = useMemo(
    () =>
      language === 'svg'
        ? svgDataUri(content)
        : language === 'echarts'
          ? parseEchartsOption(content)
          : null,
    [language, content],
  );

  if (!closed) {
    // Truncated final message keeps its partial source visible; a live stream
    // shows the pending card instead of half-generated content.
    if (streaming) return <PendingCard language={language} />;
    return <CodeBlock language={language} code={content} variant={variant} />;
  }

  if (language === 'html') {
    // HTML never "fails" to parse — the sandboxed iframe shows it as-is.
    return (
      <PreviewCard language={language} content={content}>
        <iframe
          title="HTML preview"
          sandbox="allow-scripts"
          srcDoc={content}
          className="h-[420px] w-full border-0 bg-white"
        />
      </PreviewCard>
    );
  }
  if (language === 'svg') {
    if (parsed === null) {
      return <CodeBlock language={language} code={content} variant={variant} />;
    }
    return (
      <PreviewCard language={language} content={content}>
        <div className="bg-white p-3">
          <img src={parsed} alt="" className="mx-auto block max-w-full" />
        </div>
      </PreviewCard>
    );
  }
  if (language === 'echarts') {
    if (parsed === null) {
      return <CodeBlock language={language} code={content} variant={variant} />;
    }
    return (
      <PreviewCard language={language} content={content}>
        <div className="p-2">
          <EchartsPreview option={parsed} />
        </div>
      </PreviewCard>
    );
  }
  if (language === 'csv' || language === 'tsv') {
    // Same state machine as svg/echarts: validate first, fall back to the
    // code block when the text does not parse as a delimited table.
    let table: ParsedTable | null = null;
    try {
      table = parseTableFile(`data.${language}`, content);
    } catch {
      table = null;
    }
    if (table === null || table.rows.length === 0) {
      return <CodeBlock language={language} code={content} variant={variant} />;
    }
    return (
      <PreviewCard language={language} content={content}>
        <div className="p-2">
          <MiniTable filename={`data.${language}`} text={content} badge={false} />
        </div>
      </PreviewCard>
    );
  }
  return null;
});
