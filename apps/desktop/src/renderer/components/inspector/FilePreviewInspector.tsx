import type { FilePreviewInspector as FilePreviewInspectorT } from '@workbench/shared';
import { Code2, ExternalLink, Eye, History, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CodeViewer } from '@/components/code-viewer/CodeViewer';
import { MarkdownViewer } from '@/components/markdown-viewer/MarkdownViewer';
import {
  base64ToBytes,
  openArtifactExternally,
  previewUrl,
  readArtifact,
} from '@/lib/artifactFile';
import { type PreviewKind, previewKindForName } from '@/lib/artifacts';
import { cn } from '@/lib/cn';
import { parseTableFile } from '@/lib/csv';
import { useScrollMemory } from '@/lib/scrollMemory';
import { canChart } from '@/lib/tableChart';

import { JsonView } from './JsonView';
import { DocxView, PptxView, XlsxView } from './OfficePreview';
import { ProvenancePanel } from './ProvenancePanel';
import { TableChart } from './TableChart';
import { TablePreview } from './TablePreview';

/**
 * Right-pane preview for any workspace file. Strategy (no format conversion):
 * pdf / image / html — served from the local file server (http://127.0.0.1)
 * and rendered by the webview's NATIVE viewers via <iframe>/<img>;
 * csv/tsv — parsed to a table; docx/xlsx/pptx — local JS renderers fed raw
 * bytes; everything else — code/text.
 */
export function FilePreviewInspector({
  data,
  onClose,
}: {
  data: FilePreviewInspectorT;
  onClose: () => void;
}) {
  const kind = previewKindForName(data.filename);
  const needsUrl =
    kind === 'pdf' || kind === 'image' || kind === 'html' || kind === 'audio' || kind === 'video';
  const needsText =
    kind === 'table' ||
    kind === 'text' ||
    kind === 'html' ||
    kind === 'markdown' ||
    kind === 'json';
  const needsBytes = kind === 'docx' || kind === 'xlsx' || kind === 'pptx';

  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(data.content ?? null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'code'>(kind === 'text' ? 'code' : 'preview');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    // Reset per-file state up front: the same inspector instance is reused when
    // the user opens a different file, and the async loads below only fill in
    // what the NEW file needs — without this, the previous file's text/url/bytes
    // would linger and bleed into the new preview.
    setText(data.content ?? null);
    setUrl(null);
    setBytes(null);
    (async () => {
      try {
        if (needsUrl) {
          const u = await previewUrl(data.path, data.root);
          if (cancelled) return;
          setUrl(u);
          // Browser dev has no local server; html can still preview inline content.
          if (!u && kind !== 'html') {
            setError('Preview is available in the desktop app.');
          }
        }
        if (needsText && data.content === undefined) {
          const f = await readArtifact(data.path, data.root);
          if (cancelled) return;
          if (f && f.encoding === 'utf8') setText(f.data);
          // The file was read but isn't text — say so instead of falling
          // through to the "desktop app" note while inside the desktop app.
          else if (f) setError('This file is binary and has no preview — open it externally.');
          else if (kind !== 'html' && kind !== 'markdown')
            setError('Preview is available in the desktop app.');
        }
        if (needsBytes) {
          const f = await readArtifact(data.path, data.root);
          if (cancelled) return;
          if (f && f.encoding === 'base64') setBytes(base64ToBytes(f.data));
          else setError('Preview is available in the desktop app.');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.path, data.content, data.root, kind, needsUrl, needsText, needsBytes]);

  const canToggle = kind === 'html' || kind === 'markdown' || kind === 'json';

  // Where the user was in this file, restored when they come back to it —
  // history browsing keeps its own offset so the two don't clobber each other.
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScroll = useScrollMemory(
    scrollRef,
    showHistory ? `history:${data.path}` : `file:${data.path}`,
    showHistory || !loading,
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium text-text">{data.filename}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
          {data.artifact}
        </span>
        {canToggle && (
          <div className="ml-2 flex items-center gap-1 rounded-input bg-surface-2 p-0.5">
            <ToggleBtn active={tab === 'preview'} onClick={() => setTab('preview')}>
              <Eye size={13} /> Preview
            </ToggleBtn>
            <ToggleBtn active={tab === 'code'} onClick={() => setTab('code')}>
              <Code2 size={13} /> Code
            </ToggleBtn>
          </div>
        )}
        <div className="flex-1" />
        <button
          className={cn(showHistory ? 'text-text' : 'text-muted hover:text-text')}
          aria-label="History"
          title="History — every recorded version with its code and conversation"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          <History size={16} />
        </button>
        <button
          className="text-muted hover:text-text"
          aria-label="Open externally"
          title="Open in the default app"
          onClick={() => void openArtifactExternally(data.path, data.root)}
        >
          <ExternalLink size={16} />
        </button>
        <button
          className="text-muted hover:text-text"
          aria-label="Close inspector"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-surface-2"
      >
        {showHistory && <ProvenancePanel path={data.path} language={data.language} />}
        {!showHistory && loading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Loading {data.filename}…
          </div>
        )}
        {!showHistory && !loading && error && (
          <PreviewError
            error={error}
            onOpenExternally={() => void openArtifactExternally(data.path, data.root)}
          />
        )}
        {!showHistory && !loading && !error && (
          <Body
            kind={kind}
            url={url}
            text={text}
            bytes={bytes}
            showCode={tab === 'code'}
            filename={data.filename}
            path={data.path}
            language={data.language}
          />
        )}
      </div>
    </div>
  );
}

function Body({
  kind,
  url,
  text,
  bytes,
  showCode,
  filename,
  path,
  language,
}: {
  kind: PreviewKind;
  url: string | null;
  text: string | null;
  bytes: ArrayBuffer | null;
  showCode: boolean;
  filename: string;
  path: string;
  language?: string;
}) {
  if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
    // Office views scroll internally (the outer pane never does), so they
    // carry their own scroll memory, keyed apart from the outer container's.
    if (!bytes) return <Note text="Preview is available in the desktop app." />;
    if (kind === 'docx') return <DocxView bytes={bytes} scrollKey={`office:${path}`} />;
    if (kind === 'xlsx') return <XlsxView bytes={bytes} scrollKey={`office:${path}`} />;
    return <PptxView bytes={bytes} scrollKey={`office:${path}`} />;
  }
  if (kind === 'json') {
    if (showCode) {
      return text !== null ? (
        <div className="p-3">
          <CodeViewer code={text} language="json" />
        </div>
      ) : (
        <Note text="Source is available in the desktop app." />
      );
    }
    if (text !== null) {
      try {
        const parsed = JSON.parse(text);
        return <JsonView data={parsed} />;
      } catch {
        return (
          <div className="p-3">
            <CodeViewer code={text} language="json" />
          </div>
        );
      }
    }
    return <Note text="Preview is available in the desktop app." />;
  }
  if (kind === 'audio') {
    return url ? (
      <div className="flex items-center justify-center p-8">
        <audio controls className="w-full max-w-lg">
          <source src={url} />
        </audio>
      </div>
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === 'video') {
    return url ? (
      <div className="flex items-center justify-center p-4">
        <video controls className="max-h-[60vh] max-w-full rounded-sm bg-black">
          <source src={url} />
        </video>
      </div>
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === 'markdown') {
    if (showCode) {
      return text !== null ? (
        <div className="p-3">
          <CodeViewer code={text} language="markdown" />
        </div>
      ) : (
        <Note text="Source is available in the desktop app." />
      );
    }
    // A document reads as a page: white paper, black text, whatever the app
    // theme — the same document-neutral canvas the Office previews use.
    return text !== null ? (
      <div className="min-h-full px-6 py-8">
        <div className="mx-auto max-w-[760px] rounded-sm bg-white px-12 py-11 shadow-[0_1px_4px_rgba(0,0,0,.25)] max-sm:px-6 max-sm:py-7">
          <MarkdownViewer variant="document">{text}</MarkdownViewer>
        </div>
      </div>
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === 'html' && showCode) {
    return text !== null ? (
      <div className="p-3">
        <CodeViewer code={text} language="html" />
      </div>
    ) : (
      <Note text="Source is available in the desktop app." />
    );
  }
  if (kind === 'html') {
    // Served URL preferred (relative assets resolve); srcdoc as browser fallback.
    if (url) {
      return (
        <iframe
          title="HTML preview"
          src={url}
          sandbox="allow-scripts"
          className="h-full min-h-[480px] w-full bg-white"
        />
      );
    }
    if (text !== null) {
      return (
        <iframe
          title="HTML preview"
          srcDoc={text}
          sandbox="allow-scripts"
          className="h-full min-h-[480px] w-full bg-white"
        />
      );
    }
    return <Note text="Preview is available in the desktop app." />;
  }
  if (kind === 'pdf') {
    // The webview's native PDF viewer (WKWebView / WebView2) renders the served URL.
    return url ? (
      <iframe title="PDF preview" src={url} className="h-full min-h-[480px] w-full" />
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === 'image') {
    return url ? (
      <div className="flex justify-center p-4">
        <img src={url} alt={filename} className="max-w-full rounded-sm bg-white shadow-card" />
      </div>
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  if (kind === 'table') {
    return text !== null ? (
      <TableView table={parseTableFile(filename, text)} />
    ) : (
      <Note text="Preview is available in the desktop app." />
    );
  }
  return text !== null ? (
    <div className="p-3">
      <CodeViewer code={text} language={language} />
    </div>
  ) : (
    <Note text="Preview is available in the desktop app." />
  );
}

function Note({ text }: { text: string }) {
  return <div className="p-4 text-sm text-muted">{text}</div>;
}

/** Tabular file preview with a Table ↔ Chart toggle. The Chart tab appears only
 *  when the data has a numeric column to plot. */
function TableView({ table }: { table: import('@/lib/csv').ParsedTable }) {
  const [view, setView] = useState<'table' | 'chart'>('table');
  const chartable = canChart(table);
  return (
    <div className="flex h-full flex-col">
      {chartable && (
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          <ToggleBtn active={view === 'table'} onClick={() => setView('table')}>
            Table
          </ToggleBtn>
          <ToggleBtn active={view === 'chart'} onClick={() => setView('chart')}>
            Chart
          </ToggleBtn>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'chart' && chartable ? (
          <TableChart table={table} />
        ) : (
          <TablePreview table={table} />
        )}
      </div>
    </div>
  );
}

/** Preview errors. A "too large" file gets a helpful card — the preview is
 *  capped so a huge file can't lock the app; the user can open it in the OS app. */
export function PreviewError({
  error,
  onOpenExternally,
}: {
  error: string;
  onOpenExternally: () => void;
}) {
  const tooLarge = /too large/i.test(error);
  if (!tooLarge) return <div className="p-4 text-sm text-muted">{error}</div>;
  return (
    <div className="p-4">
      <div className="rounded-card border border-border bg-surface p-4 text-sm text-muted">
        <div className="mb-1 font-medium text-text">This file is too large to preview</div>
        <p className="mb-3">
          Previews are capped so a large file can't freeze the app. Open it in your system app to
          view it.
        </p>
        <button
          className="inline-flex items-center gap-1.5 rounded-input border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text hover:bg-surface"
          onClick={onOpenExternally}
        >
          <ExternalLink size={13} /> Open externally
        </button>
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-2 py-1 text-xs',
        active ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
