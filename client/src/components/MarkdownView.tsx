import { Check, Clipboard } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Lightweight markdown renderer for the client. No syntax highlighting
 *  (highlight.js is too heavy for a mobile-first bundle); code blocks get
 *  a copy button and basic monospace styling instead. */
export const MarkdownView = memo(
  function MarkdownView({
    children,
    streaming = false,
  }: {
    children: string;
    streaming?: boolean;
  }) {
    return (
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="md-p">{children}</p>,
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noreferrer" className="md-a">
                {children}
              </a>
            ),
            code: ({ className, children }) => {
              const inline = !className;
              if (inline) return <code className="md-code-inline">{children}</code>;
              const language = className?.replace('language-', '');
              return (
                <CodeBlock
                  language={language}
                  code={String(children).replace(/\n$/, '')}
                  streaming={streaming}
                />
              );
            },
            pre: ({ children }) => <>{children}</>,
            ul: ({ children }) => <ul className="md-ul">{children}</ul>,
            ol: ({ children }) => <ol className="md-ol">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
            h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
            h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
            h4: ({ children }) => <h4 className="md-h4">{children}</h4>,
            blockquote: ({ children }) => <blockquote className="md-quote">{children}</blockquote>,
            hr: () => <hr className="md-hr" />,
            table: ({ children }) => (
              <div className="md-table-wrap">
                <table className="md-table">{children}</table>
              </div>
            ),
            th: ({ children }) => <th className="md-th">{children}</th>,
            td: ({ children }) => <td className="md-td">{children}</td>,
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    );
  },
  (a, b) => a.children === b.children && a.streaming === b.streaming,
);

function CodeBlock({
  language,
  code,
  streaming,
}: {
  language: string | undefined;
  code: string;
  streaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{language || 'text'}</span>
        {!streaming && (
          <button onClick={() => void copy()} className="md-code-copy">
            {copied ? <Check size={11} /> : <Clipboard size={11} />}
            {copied ? '已复制' : '复制'}
          </button>
        )}
      </div>
      <pre className="md-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Helper for callers that need to render plain text or markdown depending on
 *  content (e.g. reasoning blocks that may contain fenced code). */
export function maybeMarkdown(text: string): ReactNode {
  // Only invoke markdown for content that looks like it needs it; plain
  // single-line text gets a fast path to avoid unnecessary parsing.
  if (!/[`#*-]|^\d+\. /m.test(text)) return text;
  return <MarkdownView>{text}</MarkdownView>;
}
