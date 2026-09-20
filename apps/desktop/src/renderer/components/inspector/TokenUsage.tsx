import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import { buildTurns, cleanSummary, type TurnEntry } from '@/lib/messageTurns';
import { DRAFT_KEY, useRuntimeStore } from '@/lib/runtime';

/** Conservative fallback when the provider reports no window for the model. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Resolve the context window for "provider/model": prefer the provider-reported
 * value, fall back to a conservative default.
 */
function resolveContextWindow(
  defaultModel: string | null,
  providers: import('@workbench/sdk').ProviderInfo[],
): number {
  if (defaultModel) {
    const slash = defaultModel.indexOf('/');
    const providerId = slash > 0 ? defaultModel.slice(0, slash) : '';
    const modelId = slash > 0 ? defaultModel.slice(slash + 1) : defaultModel;
    const found = providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId);
    if (found?.contextLimit) return found.contextLimit;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** Format a token count for compact display. */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost < 0.0001) return '$' + cost.toExponential(2);
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** One history line: role chip + cleaned single-line summary. */
function TurnRow({ label, chipClass, text }: { label: string; chipClass: string; text: string }) {
  return (
    <div className="flex items-start gap-1.5 px-1.5 py-0.5">
      <span className={cn('shrink-0 rounded px-1 py-px text-[10px] font-medium', chipClass)}>
        {label}
      </span>
      <span
        className="truncate text-muted"
        title={text.length > 400 ? `${text.slice(0, 400)}…` : text}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * The conversation as request turns: one user row + one AI row per turn, tool
 * calls folded behind a collapsible counter (they are noise as top-level rows
 * in tool-heavy sessions). Summaries go through cleanSummary so no markdown /
 * fence syntax leaks into the preview.
 */
function RequestHistory({ turns }: { turns: TurnEntry[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto">
      {turns.map((t, i) => (
        <div key={i}>
          {t.user !== undefined && (
            <TurnRow
              label="用户"
              chipClass="bg-accent/15 text-accent"
              text={cleanSummary(t.user)}
            />
          )}
          {t.agent !== undefined && (
            <TurnRow label="AI" chipClass="bg-ok/15 text-ok" text={cleanSummary(t.agent)} />
          )}
          {t.tools.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                aria-expanded={!!open[i]}
                className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] text-muted transition-colors hover:bg-surface-2/60 hover:text-text"
              >
                <ChevronRight
                  size={11}
                  className={cn(
                    'shrink-0 transition-transform duration-150',
                    open[i] && 'rotate-90',
                  )}
                />
                <span>工具调用 ×{t.tools.length}</span>
              </button>
              {open[i] && (
                <div className="pb-0.5">
                  {t.tools.map((tool, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-1.5 py-px pl-7 pr-1.5 text-[11px] text-muted"
                    >
                      <span className="h-1 w-1 shrink-0 rounded-full bg-link/60" />
                      <span className="truncate font-mono" title={tool.name}>
                        {tool.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {i < turns.length - 1 && <div className="my-1 ml-1.5 mr-1 h-px bg-border-soft" />}
        </div>
      ))}
    </div>
  );
}

/** Thresholds for the ring color (fraction of the context window). */
const WARNING_AT = 0.7;
const DANGER_AT = 0.9;

function Ring({ pct }: { pct: number }) {
  const safePct = Number.isFinite(pct) ? Math.min(pct, 1) : 0;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - safePct);
  const tone =
    safePct >= DANGER_AT ? 'var(--error)' : safePct >= WARNING_AT ? 'var(--warn)' : 'var(--ok)';

  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 48 48)"
        style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease' }}
      />
      <text
        x="48"
        y="48"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight="600"
        fill="var(--text)"
      >
        {(safePct * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

/**
 * Token usage panel — shows real API-reported token counts from the session,
 * a context window ring, cost, and per-message request history.
 */
export function TokenUsage() {
  const currentId = useRuntimeStore((s) => s.currentId);
  const thread = useRuntimeStore((s) =>
    s.currentId ? s.threads[s.currentId] : s.threads[DRAFT_KEY],
  );
  const sessions = useRuntimeStore((s) => s.sessions);
  const defaultModel = useRuntimeStore((s) => s.defaultModel);
  const providers = useRuntimeStore((s) => s.providers);
  const session = sessions.find((s) => s.id === currentId);
  const modelName = defaultModel ? defaultModel.split('/').pop()! : null;

  const contextWindow = useMemo(
    () => resolveContextWindow(defaultModel, providers),
    [defaultModel, providers],
  );

  // Real API-reported tokens from the session
  const inputTokens = session?.promptTokens ?? 0;
  const outputTokens = session?.completionTokens ?? 0;
  const reasoningTokens = session?.reasoningTokens ?? 0;
  const cacheRead = session?.cacheReadTokens ?? 0;
  const cacheWrite = session?.cacheWriteTokens ?? 0;
  const totalTokens = inputTokens + outputTokens + reasoningTokens;
  const cost = session?.cost ?? 0;
  const hasRealData = totalTokens > 0 || cost > 0;

  // Fallback: estimate from thread blocks when no real data yet
  const blockChars = useMemo(() => {
    let chars = 0;
    for (const b of thread?.blocks ?? []) {
      if (b.kind === 'user') chars += b.text.length;
      else if (b.kind === 'agent') chars += b.markdown.length;
      else if (b.kind === 'reasoning') chars += b.text.length;
      else if (b.kind === 'tool-call')
        chars += (b.inputSummary?.length ?? 0) + (b.outputSummary?.length ?? 0);
    }
    return chars;
  }, [thread?.blocks]);
  const estimatedTokens = Math.ceil(blockChars / 4);
  const displayTotal = hasRealData ? totalTokens : estimatedTokens;
  const pct = Math.min(displayTotal / contextWindow, 1);
  const safePct = Number.isFinite(pct) ? pct : 0;
  const tone =
    safePct >= DANGER_AT ? 'text-error' : safePct >= WARNING_AT ? 'text-warn' : 'text-ok';

  // Conversation as request turns: user + agent replies grouped, tools folded
  const turns = useMemo(() => buildTurns(thread?.blocks ?? []), [thread?.blocks]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Session info */}
      <div className="space-y-1 rounded-input bg-surface-2 px-3 py-2">
        {session?.title && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">会话</span>
            <span className="truncate text-text ml-2" title={session.title}>
              {session.title}
            </span>
          </div>
        )}
        {modelName && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">模型</span>
            <span className="text-text">{modelName}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">轮次</span>
          <span className="text-text">{turns.length}</span>
        </div>
      </div>

      {/* Ring */}
      <div className="flex flex-col items-center gap-1">
        <Ring pct={safePct} />
        <span className={cn('text-[11px] font-medium', tone)}>
          {safePct >= DANGER_AT ? '接近上限' : safePct >= WARNING_AT ? '即将占满' : '充足'}
        </span>
      </div>

      {/* Real token breakdown */}
      {hasRealData ? (
        <div className="w-full space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text">输入 Tokens</span>
            <span className="font-mono text-muted">{fmt(inputTokens)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text">输出 Tokens</span>
            <span className="font-mono text-muted">{fmt(outputTokens)}</span>
          </div>
          {reasoningTokens > 0 && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text">推理 Tokens</span>
              <span className="font-mono text-muted">{fmt(reasoningTokens)}</span>
            </div>
          )}
          {(cacheRead > 0 || cacheWrite > 0) && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text">缓存 读/写</span>
              <span className="font-mono text-muted">
                {fmt(cacheRead)} / {fmt(cacheWrite)}
              </span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-[11px]">
            <span className="font-medium text-text">合计</span>
            <span className="font-mono font-medium text-text">{fmt(totalTokens)}</span>
          </div>
          {cost > 0 && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted">费用</span>
              <span className="font-mono text-warn">{formatCost(cost)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">上下文窗口</span>
            <span className="font-mono text-muted">{fmt(contextWindow)}</span>
          </div>
        </div>
      ) : (
        <div className="w-full text-center">
          <div className="text-[18px] font-semibold text-text">{displayTotal.toLocaleString()}</div>
          <div className="text-[11px] text-muted">预估 Token 数（等待 API 数据）</div>
        </div>
      )}

      {/* Conversation / request history, one row set per turn */}
      {turns.length > 0 && (
        <div className="w-full">
          <div className="mb-1 text-[11px] font-medium text-muted">请求报文</div>
          <RequestHistory turns={turns} />
        </div>
      )}

      {displayTotal === 0 && turns.length === 0 && (
        <div className="py-8 text-center text-[12px] text-muted">
          暂无消息。开始对话后将显示 Token 用量。
        </div>
      )}
    </div>
  );
}
