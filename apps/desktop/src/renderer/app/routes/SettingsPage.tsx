import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw, Download } from "lucide-react";
import { useUiStore, type AgentRuntimeKind, type Theme } from "@/lib/store";
import { useRuntimeStore } from "@/lib/runtime";
import { useI18n } from "@/lib/i18n";
import {
  openWorkspaceBase,
  pickFolder,
  setWorkspaceBase,
  workspaceBase,
  checkForUpdates,
  exportLogs,
  channelName,
  appIdentifier,
  appVersion,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { DataFlowCard } from "@/components/settings/DataFlowCard";

type Section = "general" | "runtime" | "workspace" | "privacy" | "about";

/**
 * Settings. The bundled OpenCode runtime's config - providers, model, skills,
 * MCP, permissions - is decided by the packager's `.opencode/` profile and is
 * NOT editable at runtime. This page only covers runtime connection, workspace,
 * appearance, privacy, and about/diagnostics.
 */
export function SettingsPage() {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("general");

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

  const tabs: { id: Section; label: string }[] = [
    { id: "general", label: t("settings.tabGeneral") },
    { id: "runtime", label: t("settings.tabRuntime") },
    { id: "workspace", label: t("settings.tabWorkspace") },
    { id: "privacy", label: t("settings.tabPrivacy") },
    { id: "about", label: t("settings.tabAbout") },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-16 pt-8">
        <h1 className="text-xl font-semibold tracking-tight text-text">{t("settings.title")}</h1>
        <p className="mt-0.5 text-xs text-muted">{t("settings.subtitle")}</p>

        <div className="mt-6 flex gap-6">
          <nav className="w-52 shrink-0">
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setSection(tab.id)}
                    className={cn(
                      "w-full rounded-input px-3 py-2 text-left text-[13px] transition-colors",
                      section === tab.id
                        ? "bg-surface-2 text-text"
                        : "text-muted hover:bg-surface-2/50 hover:text-text",
                    )}
                  >
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 flex-1">
            {section === "general" && (
              <>
                <Card title={t("settings.language")}>
                  <div className="inline-flex rounded-input border border-border bg-surface-2 p-0.5">
                    {([
                      { value: "en", label: "English" },
                      { value: "zh-CN", label: "中文" },
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

                <Card title={t("settings.appearance")}>
                  <div className="inline-flex rounded-input border border-border bg-surface-2 p-0.5">
                    {([
                      { value: "light", label: t("settings.themeLight") },
                      { value: "dark", label: t("settings.themeDark") },
                      { value: "system", label: t("settings.themeSystem") },
                    ] as const).map((th) => (
                      <button
                        key={th.value}
                        onClick={() => setTheme(th.value as Theme)}
                        className={cn(
                          "rounded-[5px] px-4 py-1.5 text-[13px] transition-colors",
                          theme === th.value
                            ? "bg-surface text-text shadow-card"
                            : "text-muted hover:text-text",
                        )}
                      >
                        {th.label}
                      </button>
                    ))}
                  </div>
                </Card>
              </>
            )}

            {section === "runtime" && (
              <>
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

                <Card title={t("settings.model")} hint={t("settings.modelHint")}>
                  <select
                    value={defaultModel ?? ""}
                    onChange={(e) => { void setDefaultModel(e.target.value); }}
                    className={inputCls("w-full")}
                    disabled={!connected}
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

                <Card title={t("settings.display")} hint={t("settings.displayHint")}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-text">{t("settings.expandDetails")}</div>
                      <div className="text-[12px] text-muted">{t("settings.expandDetailsHint")}</div>
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
              </>
            )}

            {section === "workspace" && (
              <Card title={t("settings.workspace")} hint={t("settings.workspaceHint")}>
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
            )}

            {section === "privacy" && (
              <div className="mt-0">
                <p className="mb-3 text-xs text-muted">{t("settings.privacyHint")}</p>
                <DataFlowCard model={defaultModel} workspace={wsPath} />
              </div>
            )}

            {section === "about" && (
              <AboutSection />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useI18n();
  const [name, setName] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState<"updates" | "logs" | null>(null);

  useEffect(() => {
    void channelName().then(setName);
    void appIdentifier().then(setId);
    void appVersion().then(setVersion);
  }, []);

  const onCheckUpdates = async () => {
    setBusy("updates");
    try {
      await checkForUpdates(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onExportLogs = async () => {
    setBusy("logs");
    try {
      const path = await exportLogs();
      if (path) toast.success(path);
      else toast.error(t("settings.exportLogs"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card title={t("settings.tabAbout")} hint={t("settings.aboutHint")}>
        <dl className="space-y-2.5">
          <Row label={t("settings.channel")} value={name} />
          <Row label={t("settings.appId")} value={id} />
          <Row label={t("settings.version")} value={version} />
        </dl>
      </Card>

      <Card title={t("settings.exportLogs")} hint={t("settings.exportLogsHint")}>
        <div className="flex flex-wrap gap-2">
          <button
            className={btnGhost("gap-1.5")}
            onClick={() => void onCheckUpdates()}
            disabled={busy === "updates"}
          >
            <RefreshCw size={13} className={busy === "updates" ? "animate-spin" : ""} />
            {t("settings.checkUpdates")}
          </button>
          <button
            className={btnGhost("gap-1.5")}
            onClick={() => void onExportLogs()}
            disabled={busy === "logs"}
          >
            <Download size={13} />
            {t("settings.exportLogs")}
          </button>
        </div>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-mono text-text">{value ?? "—"}</dd>
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
        <h2 className="text-[15px] font-medium text-text">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
