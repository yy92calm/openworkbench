import type { ArtifactInspector as ArtifactInspectorT, ArtifactTab } from '@workbench/shared';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { CodeViewer } from '@/components/code-viewer/CodeViewer';
import { resolveArtifactContent } from '@/lib/artifacts';
import { cn } from '@/lib/cn';
import { saveTextWithFeedback } from '@/lib/download';
import { useScrollMemory } from '@/lib/scrollMemory';

const TABS: ArtifactTab[] = ['Code', 'Execution Log', 'Messages', 'Environment'];

export function ArtifactInspector({
  data,
  onClose,
}: {
  data: ArtifactInspectorT;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ArtifactTab>('Code');
  const [versionIdx, setVersionIdx] = useState(() =>
    Math.max(
      0,
      data.versions.findIndex((v) => v.label === data.activeVersion),
    ),
  );

  const activeLabel = data.versions[versionIdx]?.label ?? data.activeVersion;
  const content = resolveArtifactContent(data, activeLabel);
  const scriptName = data.filename ?? data.title;

  const step = (delta: number) =>
    setVersionIdx((i) => Math.min(data.versions.length - 1, Math.max(0, i + delta)));

  // Viewing position per artifact tab, restored when reopened.
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScroll = useScrollMemory(scrollRef, `artifact:${data.title}:${tab}`);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium text-text">{data.title}</span>
        <div className="ml-2 flex items-center gap-1 text-muted">
          <button
            className="disabled:opacity-30 hover:text-text"
            aria-label="Previous version"
            onClick={() => step(-1)}
            disabled={versionIdx === 0}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="rounded bg-surface-2 px-1.5 text-xs">{activeLabel}</span>
          <button
            className="disabled:opacity-30 hover:text-text"
            aria-label="Next version"
            onClick={() => step(1)}
            disabled={versionIdx >= data.versions.length - 1}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="flex-1" />
        <button
          className="text-muted hover:text-text"
          aria-label="Download"
          onClick={() => void saveTextWithFeedback(scriptName, content.code)}
        >
          <Download size={16} />
        </button>
        <button
          className="text-muted hover:text-text"
          aria-label="Close inspector"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <nav className="flex items-center gap-4 border-b border-border px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 py-2.5 text-sm',
              tab === t
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4">
        {tab === 'Code' && (
          <div className="space-y-3">
            <button
              className="flex items-center gap-2 rounded-input bg-link px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              onClick={() => void saveTextWithFeedback(scriptName, content.code)}
            >
              <Download size={15} /> Download script
            </button>
            {data.inputs.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Inputs</span>
                {data.inputs.map((f) => (
                  <span
                    key={f}
                    className="rounded-input bg-surface-2 px-2 py-1 font-mono text-xs text-text ring-1 ring-border"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            <CodeViewer
              code={content.code}
              language={data.language}
              startLine={data.codeStartLine}
            />
          </div>
        )}
        {tab === 'Execution Log' && <Pre text={content.executionLog ?? 'No execution log.'} />}
        {tab === 'Messages' && (
          <ul className="space-y-2">
            {(content.messages ?? []).map((m, i) => (
              <li key={i} className="rounded-input bg-surface-2 px-3 py-2 text-sm text-text">
                {m}
              </li>
            ))}
            {(content.messages ?? []).length === 0 && (
              <li className="text-sm text-muted">No messages for this version.</li>
            )}
          </ul>
        )}
        {tab === 'Environment' && <Pre text={content.environment ?? 'No environment info.'} />}
      </div>
    </div>
  );
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap rounded-input border border-border bg-surface-2 p-3 font-mono text-[12.5px] text-text">
      {text}
    </pre>
  );
}
