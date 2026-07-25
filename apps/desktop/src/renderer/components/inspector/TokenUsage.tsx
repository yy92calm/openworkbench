import { useMemo } from "react";
import { DRAFT_KEY, useRuntimeStore } from "@/lib/runtime";
import { cn } from "@/lib/cn";

interface TokenEstimate {
  label: string;
  chars: number;
  tokens: number;
  color: string;
}

/**
 * Rough token estimation: ~4 chars per token for mixed content.
 * Used for relative sizing, not exact billing.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Conservative fallback when the provider reports no window for the model. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Resolve the context window for "provider/model": prefer the provider-reported
 * value, fall back to a conservative default. Never hard-coded per model.
 */
function resolveContextWindow(
  defaultModel: string | null,
  providers: import("@workbench/sdk").ProviderInfo[],
): number {
  if (defaultModel) {
    const slash = defaultModel.indexOf("/");
    const providerId = slash > 0 ? defaultModel.slice(0, slash) : "";
    const modelId = slash > 0 ? defaultModel.slice(slash + 1) : defaultModel;
    const found = providers
      .find((p) => p.id === providerId)
      ?.models.find((m) => m.id === modelId);
    if (found?.contextLimit) return found.contextLimit;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

function countBlocks(blocks: import("@workbench/shared").ThreadBlock[]): TokenEstimate[] {
  let userChars = 0;
  let agentChars = 0;
  let toolInputChars = 0;
  let toolOutputChars = 0;
  let reasoningChars = 0;

  for (const b of blocks) {
    switch (b.kind) {
      case "user":
        userChars += b.text.length;
        break;
      case "agent":
        agentChars += b.markdown.length;
        break;
      case "reasoning":
        reasoningChars += b.text.length;
        break;
      case "tool-call": {
        toolInputChars += b.inputSummary?.length ?? 0;
        toolOutputChars += b.outputSummary?.length ?? 0;
        break;
      }
    }
  }

  return [
{ label: "用户", chars: userChars, tokens: estimateTokens(userChars), color: "var(--accent)" },
  { label: "Agent", chars: agentChars, tokens: estimateTokens(agentChars), color: "var(--ok)" },
  { label: "工具输入", chars: toolInputChars, tokens: estimateTokens(toolInputChars), color: "var(--link)" },
  { label: "工具输出", chars: toolOutputChars, tokens: estimateTokens(toolOutputChars), color: "var(--warn)" },
  { label: "推理", chars: reasoningChars, tokens: estimateTokens(reasoningChars), color: "var(--accent-strong)" },
  ];
}

/** Thresholds for the ring color (fraction of the context window). */
const WARNING_AT = 0.7;
const DANGER_AT = 0.9;

function Ring({ pct }: { pct: number }) {
  const safePct = Number.isFinite(pct) ? Math.min(pct, 1) : 0;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - safePct);
  const tone = safePct >= DANGER_AT ? "var(--error)" : safePct >= WARNING_AT ? "var(--warn)" : "var(--ok)";

  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
      <circle
        cx="48" cy="48" r={r}
        fill="none"
        stroke={tone}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.3s ease" }}
      />
      <text x="48" y="48" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="600" fill="var(--text)">
        {(safePct * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

/**
 * Token usage estimation panel — shows per-category token counts and a
 * context window ring. Inspired by Reasonix's context-window-ring.
 */
export function TokenUsage() {
  const currentId = useRuntimeStore((s) => s.currentId);
  const threads = useRuntimeStore((s) => s.threads);
  const sessions = useRuntimeStore((s) => s.sessions);
  const defaultModel = useRuntimeStore((s) => s.defaultModel);
  const providers = useRuntimeStore((s) => s.providers);
  const thread = currentId ? threads[currentId] : threads[DRAFT_KEY];
  const session = sessions.find((s) => s.id === currentId);
  const modelName = defaultModel ? defaultModel.split("/").pop()! : null;

  const contextWindow = useMemo(
    () => resolveContextWindow(defaultModel, providers),
    [defaultModel, providers],
  );
  const estimates = useMemo(() => countBlocks(thread?.blocks ?? []), [thread]);
  const totals = useMemo(() => {
    let tokens = 0;
    let chars = 0;
    for (const e of estimates) {
      tokens += Number.isFinite(e.tokens) ? e.tokens : 0;
      chars += Number.isFinite(e.chars) ? e.chars : 0;
    }
    return { tokens, chars };
  }, [estimates]);
  const totalTokens = totals.tokens;
  const totalChars = totals.chars;
  const pct = Math.min(totalTokens / contextWindow, 1);
  const safePct = Number.isFinite(pct) ? pct : 0;
  const tone = safePct >= DANGER_AT ? "text-error" : safePct >= WARNING_AT ? "text-warn" : "text-ok";

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Session info */}
      <div className="space-y-1 rounded-input bg-surface-2 px-3 py-2">
        {session?.title && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">会话</span>
            <span className="truncate text-text ml-2" title={session.title}>{session.title}</span>
          </div>
        )}
        {modelName && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">模型</span>
            <span className="text-text">{modelName}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">消息数</span>
          <span className="text-text">{thread?.blocks.length ?? 0}</span>
        </div>
      </div>

      {/* Ring */}
      <div className="flex flex-col items-center gap-1">
        <Ring pct={safePct} />
        <span className={cn("text-[11px] font-medium", tone)}>
          {safePct >= DANGER_AT ? "接近上限" : safePct >= WARNING_AT ? "即将占满" : "充足"}
        </span>
      </div>

      {/* Total */}
      <div className="w-full text-center">
        <div className="text-[18px] font-semibold text-text">{totalTokens.toLocaleString()}</div>
        <div className="text-[11px] text-muted">预估 Token 数</div>
        {totalTokens > 0 && (
          <div className="text-[11px] text-muted">
            上下文窗口上限 {contextWindow.toLocaleString()}
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="w-full space-y-1.5">
        {estimates
          .filter((e) => e.tokens > 0)
          .sort((a, b) => b.tokens - a.tokens)
          .map((e) => {
            const pctOfTotal = totalTokens > 0 ? (e.tokens / totalTokens) * 100 : 0;
            return (
              <div key={e.label}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text">{e.label}</span>
                  <span className="text-muted">{e.tokens.toLocaleString()} tok</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pctOfTotal}%`, background: e.color }}
                  />
                </div>
              </div>
            );
          })}
      </div>

      {totalChars === 0 && (
        <div className="py-8 text-center text-[12px] text-muted">
          暂无消息。开始对话后将显示 Token 用量。
        </div>
      )}
    </div>
  );
}