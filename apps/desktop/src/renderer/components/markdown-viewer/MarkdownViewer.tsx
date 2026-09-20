import { memo, type ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/cn';
import { type FenceSegment, RICH_FENCE_LANGUAGES, splitRichFences } from '@/lib/fences';
import { renderWorkbenchFence } from '@/lib/renderers';
import { useInteractionStore } from '@/lib/store';

import { CodeBlock, STYLES, type Variant } from './CodeBlock';
import { FencePreview } from './FencePreview';

/** A plain markdown run between two rich fences. Memoized by its text so token
 *  updates that only grow the message tail re-parse just the changed segment
 *  (before the first rich fence appears this degrades to the original
 *  whole-message parse). The renderers map is subscribed via the store inside
 *  the chunk so toggling `workbench:` types updates every chunk. */
const MarkdownChunk = memo(function MarkdownChunk({
  text,
  variant,
  streaming,
}: {
  text: string;
  variant: Variant;
  streaming?: boolean;
}) {
  const s = STYLES[variant];
  const enabledRenderers = useInteractionStore((st) => st.renderers);
  return (
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
          const language = cls?.replace('language-', '');
          // Keyed renderer seam: a `workbench:<type>` fence dispatches to the
          // registered renderer; an unknown/disabled type falls back to the
          // plain code block so arbitrary agent output never breaks layout.
          if (language?.startsWith('workbench:')) {
            const node = renderWorkbenchFence(
              language.slice('workbench:'.length),
              String(children).replace(/\n+$/, ''),
              enabledRenderers,
            );
            if (node) return <>{node}</>;
          }
          const code = String(children).replace(/\n$/, '');
          return (
            <CodeBlock language={language} code={code} variant={variant} streaming={streaming} />
          );
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
      {text}
    </ReactMarkdown>
  );
});

/** Render fence segments in place; stable keys make a preview survive the
 *  surrounding text growing (fence i is always between md i and md i+1). */
function renderSegments(
  segments: FenceSegment[],
  variant: Variant,
  streaming: boolean,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let mdOrdinal = 0;
  for (const seg of segments) {
    if (seg.kind === 'md') {
      nodes.push(
        <MarkdownChunk
          key={`md-${mdOrdinal}`}
          text={seg.text}
          variant={variant}
          streaming={streaming}
        />,
      );
      mdOrdinal++;
    } else {
      nodes.push(
        <FencePreview
          key={`fence-${seg.index}`}
          language={seg.language}
          content={seg.content}
          closed={seg.closed}
          streaming={streaming}
          variant={variant}
        />,
      );
    }
  }
  return nodes;
}

export const MarkdownViewer = memo(
  function MarkdownViewer({
    children,
    className,
    variant = 'chat',
    streaming = false,
  }: {
    children: string;
    className?: string;
    variant?: Variant;
    /** True while the message is still streaming in. Code blocks skip their
     *  highlight until the fence closes (see CodeBlock) and rich fences show
     *  a pending card until they complete. */
    streaming?: boolean;
  }) {
    const s = STYLES[variant];
    const segments = useMemo(() => {
      // Rich-fence previews apply to BOTH variants (docs/20260909-01): chat
      // threads and document (report) views share the same fence semantics.
      return splitRichFences(children, RICH_FENCE_LANGUAGES);
    }, [children]);
    return (
      <div className={cn(s.root, className)}>
        {segments ? (
          renderSegments(segments, variant, streaming)
        ) : (
          <MarkdownChunk text={children} variant={variant} streaming={streaming} />
        )}
      </div>
    );
  },
  (a, b) =>
    a.children === b.children &&
    a.streaming === b.streaming &&
    a.className === b.className &&
    a.variant === b.variant,
);
