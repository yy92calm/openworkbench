import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useUiStore, type AgentRuntimeKind } from "@/lib/store";
import { useRuntimeStore } from "@/lib/runtime";
import { useI18n } from "@/lib/i18n";
import { openWorkspaceBase, pickFolder, setWorkspaceBase, workspaceBase } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

/**
 * Settings. The bundled OpenCode runtime's config — providers, model, skills,
 * MCP, permissions — is decided by the packager's `.opencode/` profile and is
 * NOT editable at runtime. This page only covers runtime connection, workspace,
 * privacy, and appearance.
 */
export function SettingsPage() {
  const { t } = useI18n();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const locale = useUiStore((s) => s.locale);
  const setLocale = useUiStore((s) => s.setLocale);
  const agentRuntimeKind = useUiStore((s) => s.agentRuntimeKind);
  const setAgentRuntimeKind = useUiStore((s) => s.setAgentRuntimeKind);
  const expandThreadDetails = useUiStore((s) => s.expandThreadDetails);
  const setExpandThreadDetails = useUiStore((s) => s.setExpandThreadDetails);
  const { status, serverUrl, setServerUrl, connect, disconnect, defaultModel, providers, loadProviders, setDefaultModel } = useRuntimeStore();
  const connected = status === "ready";
  const [wsPath, setWsPath] = useState<string | null>(null);

  useEffect(() => {
    void workspaceBase().then(setWsPath);
    if (connected) void loadProviders();
  }, [connected, loadProviders]);

  const changeWorkspaceBase = async () => {
    const picked = await pickFolder();
    if (!picked) return;
    try {
      setWsPath(await setWorkspaceBase(picked));
      toast.success(t("settings.workspaceSet"));
    } catch (err) {
      toast.error(`${t("settings.workspaceError")} ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-8">
        <h1 className="font-serif text-xl text-text">{t("settings.title")}</h1>
        <p className="mt-0.5 text-xs text-muted">
          {t("settings.subtitle")}
        </p>

        {/* ---- Agent runtime ---- */}
        <Card title={t("settings.runtime")} hint={t("settings.runtimeHint")}>
          <div className="flex items-center gap-2">
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:4096"
              className={inputCls("flex-1 font-mono")}
            />
            {connected ? (
              <button onClick={disconnect} className={btnGhost()}>
                {t("settings.disconnect")}
              </button>
            ) : (
              <button onClick={connect} className={btnAccent()}>
                {t("settings.connect")}
              </button>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? "bg-ok" : status === "error" ? "bg-error" : "bg-muted",
              )}
            />
            <span className="capitalize">{status}</span>
            {connected && defaultModel && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono">{defaultModel}</span>
              </>
            )}
          </div>
        </Card>

        {/* ---- Runtime engine ---- */}
        <Card title={t("settings.runtimeKind")} hint={t("settings.runtimeKindHint")}>
          <div className="inline-flex rounded-input border border-border bg-surface-2 p-0.5">
            {([
              { value: "opencode", label: "OpenCode" },
              { value: "claude-code", label: "Claude Code" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAgentRuntimeKind(opt.value as AgentRuntimeKind)}
                className={cn(
                  "rounded-[5px] px-4 py-1.5 text-[13px] transition-colors",
                  agentRuntimeKind === opt.value
                    ? "bg-surface text-text shadow-card"
                    : "text-muted hover:text-text",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {agentRuntimeKind === "claude-code" && (
            <p className="mt-2.5 text-xs text-warn">
              Claude Code requires <span className="font-mono">@anthropic-ai/claude-agent-sdk</span> and an
              Anthropic API key. Reconnect after switching.
            </p>
          )}
        </Card>

        {/* ---- Workspace ---- */}
        <Card
          title={t("settings.workspace")}
          hint={t("settings.workspaceHint")}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                inputCls("flex-1 truncate font-mono leading-9"),
                "select-all bg-surface-2 text-muted",
              )}
            >
              {wsPath ?? "available in the desktop app"}
            </span>
            {wsPath && (
              <>
                <button className={btnGhost("gap-1.5")} onClick={() => void changeWorkspaceBase()}>
                  {t("settings.change")}
                </button>
                <button className={btnGhost("gap-1.5")} onClick={() => void openWorkspaceBase()}>
                  <FolderOpen size={13} /> {t("settings.reveal")}
                </button>
              </>
            )}
          </div>
        </Card>

        {/* ---- Appearance ---- */}
        <Card title={t("settings.appearance")}>
          <div className="inline-flex rounded-input border border-border bg-surface-2 p-0.5">
            {(["light", "dark"] as const).map((th) => (
              <button
                key={th}
                onClick={() => setTheme(th)}
                className={cn(
                  "rounded-[5px] px-4 py-1.5 text-[13px] capitalize transition-colors",
                  theme === th ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
                )}
              >
                {th}
              </button>
            ))}
          </div>

          {/* Default expand for reasoning + tool-call cards. Off (collapsed)
              by default; turning it on expands them when first rendered. */}
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-text">默认展开思考与工具</div>
              <div className="text-[12px] text-muted">关闭时思考过程与工具调用默认折叠，可逐个点击展开</div>
            </div>
            <button
              role="switch"
              aria-checked={expandThreadDetails}
              onClick={() => setExpandThreadDetails(!expandThreadDetails)}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                expandThreadDetails ? "bg-accent" : "bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform",
                  expandThreadDetails ? "left-[18px]" : "left-0.5",
                )}
              />
            </button>
          </div>
        </Card>

        {/* ---- Language ---- */}
        <Card title={t("settings.language")}>
          <div className="inline-flex rounded-input border border-border bg-surface-2 p-0.5">
            {([
              { value: "en", label: "English" },
              { value: "zh-CN", label: "中文" },
              { value: "zh-CN", label: "简体中文" },
            ] as const).map((lang) => (
              <button
                key={lang.value}
                onClick={() => setLocale(lang.value)}
                className={cn(
                  "rounded-[5px] px-4 py-1.5 text-[13px] transition-colors",
                  locale === lang.value
                    ? "bg-surface text-text shadow-card"
                    : "text-muted hover:text-text",
                )}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </Card>

        {/* ---- Model ---- */}
        <Card title={t("settings.model")} hint={t("settings.modelHint")}>
          <select
            value={defaultModel ?? ""}
            onChange={(e) => { void setDefaultModel(e.target.value); }}
            className={inputCls("w-full")}
          >
            {providers.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {p.models.map((m) => {
                  const modelId = `${p.id}/${m.id}`;
                  return (
                    <option key={modelId} value={modelId}>
                      {m.name}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </Card>
      </div>
    </div>
  );
}

/* ---- Shared bits: one look for every control on this page ---- */

const inputCls = (extra = "") =>
  cn(
    "h-9 rounded-input border border-border bg-surface px-3 text-[13px] text-text outline-none",
    "placeholder:text-muted focus:border-accent/60",
    extra,
  );

const btnGhost = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1 rounded-input border border-border bg-surface px-3.5",
    "text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-50",
    extra,
  );

const btnAccent = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium",
    "text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50",
    extra,
  );

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 rounded-card border border-border bg-surface shadow-card">
      <header className="border-b border-border px-5 py-3">
        <h2 className="font-serif text-[15px] text-text">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}