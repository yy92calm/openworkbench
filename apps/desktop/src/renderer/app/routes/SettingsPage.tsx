import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw, Download, Eye, EyeOff, RotateCw, Check, Plus, Trash2, Power, Volume2, Mic } from "lucide-react";
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
import {
  speak,
  cancelSpeak,
  getVoices,
  onVoicesReady,
  loadVoiceConfig,
  saveVoiceConfig,
  type VoiceConfig,
} from "@/lib/tts";
import { isSttSupported } from "@/lib/stt";

type Section = "general" | "models" | "runtime" | "voice" | "workspace" | "privacy" | "about";

/** A saved provider configuration. */
interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  providerName: string;
  active: boolean;
}

const PROVIDER_PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4o", providerName: "openai" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-chat", providerName: "deepseek" },
  { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelId: "qwen-max", providerName: "qwen" },
  { name: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4", modelId: "glm-4", providerName: "zhipu" },
  { name: "月之暗面", baseUrl: "https://api.moonshot.cn/v1", modelId: "moonshot-v1-8k", providerName: "moonshot" },
] as const;

/** Settings. The bundled OpenCode runtime's config - providers, model, skills,
 *  MCP, permissions - is decided by the packager's `.opencode/` profile and is
 *  NOT editable at runtime. This page only covers runtime connection, workspace,
 *  appearance, privacy, and about/diagnostics. */
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
  const { status, serverUrl, setServerUrl, connect, disconnect, defaultModel, providers, loadProviders, setDefaultModel, restart } = useRuntimeStore();
  const connected = status === "ready";
  const [wsPath, setWsPath] = useState<string | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);

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
    { id: "models", label: "模型配置" },
    { id: "runtime", label: t("settings.tabRuntime") },
    { id: "voice", label: "语音" },
    { id: "workspace", label: t("settings.tabWorkspace") },
    { id: "privacy", label: t("settings.tabPrivacy") },
    { id: "about", label: t("settings.tabAbout") },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 pb-16 pt-8">
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
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {([
                      { value: "light", label: "明亮", bg: "#f9f9f9", accent: "#10a37f" },
                      { value: "warm", label: "暖白", bg: "#faf8f5", accent: "#c15f3c" },
                      { value: "cool", label: "冷蓝", bg: "#f5f7fa", accent: "#3b82f6" },
                      { value: "dark", label: "暗色", bg: "#1a1a1a", accent: "#10a37f" },
                      { value: "black", label: "纯黑", bg: "#000000", accent: "#10a37f" },
                      { value: "system", label: "系统", bg: "linear-gradient(135deg,#f9f9f9 50%,#1a1a1a 50%)", accent: "#10a37f" },
                    ] as const).map((th) => (
                      <button
                        key={th.value}
                        onClick={() => setTheme(th.value as Theme)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-input border p-2.5 transition-all",
                          theme === th.value
                            ? "border-accent ring-1 ring-accent/40"
                            : "border-border hover:border-muted",
                        )}
                      >
                        <span
                          className="h-7 w-full rounded-md border border-black/10"
                          style={{ background: th.bg }}
                        />
                        <span className={cn("text-[11px]", theme === th.value ? "font-medium text-text" : "text-muted")}>
                          {th.label}
                        </span>
                      </button>
                    ))}
                  </div>
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

            {section === "models" && (
              <ModelsSection connected={connected} restart={restart} />
            )}

            {section === "voice" && (
              <VoiceSection />
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

                <Card title="运行时操作" hint="手动重启 sidecar 进程（读取最新配置）。">
                  <button
                    disabled={restartBusy || !connected}
                    onClick={async () => {
                      setRestartBusy(true);
                      try {
                        await restart();
                        toast.success("运行时已重启");
                      } catch (err) {
                        toast.error(`重启失败: ${err instanceof Error ? err.message : String(err)}`);
                      } finally {
                        setRestartBusy(false);
                      }
                    }}
                    className={btnGhost("gap-1.5")}
                  >
                    <RotateCw size={13} className={restartBusy ? "animate-spin" : ""} />
                    {restartBusy ? "重启中…" : "重启运行时"}
                  </button>
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

// ── Models section: manage multiple provider configs ──

function ModelsSection({ connected, restart }: { connected: boolean; restart: () => Promise<void> }) {
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state
  const [fName, setFName] = useState("");
  const [fBaseUrl, setFBaseUrl] = useState("");
  const [fApiKey, setFApiKey] = useState("");
  const [fModelId, setFModelId] = useState("");
  const [fProviderName, setFProviderName] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    void loadConfigs();
  }, []);

  async function loadConfigs() {
    const raw = await window.electronAPI?.storeGet("provider-configs");
    if (raw && Array.isArray(raw)) {
      setConfigs(raw as ProviderConfig[]);
    } else {
      // Migrate legacy single-config format
      const legacy = await window.electronAPI?.storeGet("provider-config");
      if (legacy && typeof legacy === "object") {
        const c = legacy as { baseUrl?: string; apiKey?: string; modelId?: string; providerName?: string };
        if (c.baseUrl || c.apiKey || c.modelId) {
          const migrated: ProviderConfig = {
            id: crypto.randomUUID(),
            name: c.providerName || "默认配置",
            baseUrl: c.baseUrl ?? "",
            apiKey: c.apiKey ?? "",
            modelId: c.modelId ?? "",
            providerName: c.providerName ?? "custom",
            active: true,
          };
          setConfigs([migrated]);
          await window.electronAPI.storeSet("provider-configs", [migrated]);
          await window.electronAPI.storeDelete("provider-config");
        }
      }
    }
  }

  async function persist(newConfigs: ProviderConfig[]) {
    setConfigs(newConfigs);
    await window.electronAPI.storeSet("provider-configs", newConfigs);
  }

  function resetForm() {
    setFName("");
    setFBaseUrl("");
    setFApiKey("");
    setFModelId("");
    setFProviderName("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(cfg: ProviderConfig) {
    setEditingId(cfg.id);
    setFName(cfg.name);
    setFBaseUrl(cfg.baseUrl);
    setFApiKey(cfg.apiKey);
    setFModelId(cfg.modelId);
    setFProviderName(cfg.providerName);
    setShowForm(true);
  }

  async function handleSave() {
    if (!fBaseUrl && !fApiKey && !fModelId) {
      toast.error("请至少填写 Base URL / API Key / 模型 ID");
      return;
    }
    const cfg: ProviderConfig = {
      id: editingId ?? crypto.randomUUID(),
      name: fName || fProviderName || "未命名配置",
      baseUrl: fBaseUrl,
      apiKey: fApiKey,
      modelId: fModelId,
      providerName: fProviderName || "custom",
      active: editingId ? configs.find((c) => c.id === editingId)?.active ?? false : configs.length === 0,
    };
    const newConfigs = editingId
      ? configs.map((c) => (c.id === editingId ? cfg : c))
      : [...configs, cfg];
    await persist(newConfigs);
    resetForm();
    toast.success(editingId ? "配置已更新" : "配置已添加");
  }

  async function handleActivate(id: string) {
    setBusy(true);
    try {
      const newConfigs = configs.map((c) => ({ ...c, active: c.id === id }));
      await persist(newConfigs);
      toast.success("正在重启运行时…");
      await restart();
      toast.success("已切换并重启");
    } catch (err) {
      toast.error(`切换失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    const cfg = configs.find((c) => c.id === id);
    if (!cfg) return;
    const wasActive = cfg.active;
    const newConfigs = configs.filter((c) => c.id !== id);
    if (wasActive && newConfigs.length > 0) {
      newConfigs[0].active = true;
    }
    await persist(newConfigs);
    if (wasActive) {
      toast.success("已删除激活配置，重启后恢复默认");
      try {
        await restart();
      } catch { /* ignore */ }
    } else {
      toast.success("已删除");
    }
  }

  return (
    <>
      <Card title="已保存的配置" hint="管理多个 OpenAI 兼容接口配置。激活的配置会在 sidecar 启动时合并到 opencode.json。">
        {configs.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted">
            暂无保存的配置，点击下方「新增配置」添加。
          </div>
        ) : (
          <div className="space-y-2">
            {configs.map((cfg) => (
              <div
                key={cfg.id}
                className={cn(
                  "flex items-center gap-3 rounded-input border p-3 transition-colors",
                  cfg.active ? "border-accent/50 bg-accent-soft" : "border-border bg-surface-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text">{cfg.name}</span>
                    {cfg.active && (
                      <span className="flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-strong">
                        <Check size={10} /> 已激活
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                    {cfg.providerName}/{cfg.modelId} · {cfg.baseUrl || "—"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!cfg.active && (
                    <button
                      disabled={busy}
                      onClick={() => void handleActivate(cfg.id)}
                      className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text transition-colors hover:border-accent/50 hover:bg-accent-soft disabled:opacity-50"
                    >
                      <Power size={11} /> 激活
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(cfg)}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text transition-colors hover:bg-surface-2"
                  >
                    编辑
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void handleDelete(cfg.id)}
                    className="flex items-center rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 flex items-center gap-1.5 rounded-input border border-dashed border-border px-3.5 py-2 text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-text"
          >
            <Plus size={14} /> 新增配置
          </button>
        )}
      </Card>

      {showForm && (
        <Card title={editingId ? "编辑配置" : "新增配置"} hint="OpenAI 兼容接口。保存后可点击「激活」切换使用。">
          {/* Presets */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            <span className="text-[11px] text-muted">快捷填充：</span>
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => {
                  setFName(preset.name);
                  setFBaseUrl(preset.baseUrl);
                  setFModelId(preset.modelId);
                  setFProviderName(preset.providerName);
                }}
                className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-text transition-colors hover:border-accent/50 hover:bg-accent-soft"
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">配置名称</span>
                <input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="我的 OpenAI 配置"
                  className={inputCls("w-full")}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Provider 名称（可选）</span>
                <input
                  value={fProviderName}
                  onChange={(e) => setFProviderName(e.target.value)}
                  placeholder="custom"
                  className={inputCls("w-full")}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Base URL</span>
              <input
                value={fBaseUrl}
                onChange={(e) => setFBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className={inputCls("w-full font-mono")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">API Key</span>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={fApiKey}
                  onChange={(e) => setFApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={inputCls("w-full font-mono pr-9")}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">模型 ID</span>
              <input
                value={fModelId}
                onChange={(e) => setFModelId(e.target.value)}
                placeholder="gpt-4o"
                className={inputCls("w-full font-mono")}
              />
            </label>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => void handleSave()} className={btnAccent()}>
                {editingId ? "更新" : "保存"}
              </button>
              <button onClick={resetForm} className={btnGhost()}>
                取消
              </button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function VoiceSection() {
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testing, setTesting] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);

  useEffect(() => {
    void loadVoiceConfig().then(setCfg);
    void isSttSupported().then(setSttSupported);
    const refresh = () => setVoices(getVoices());
    refresh();
    const off = onVoicesReady(refresh);
    return off;
  }, []);

  const update = (patch: Partial<VoiceConfig>) => {
    const next = { ...cfg!, ...patch };
    setCfg(next);
    void saveVoiceConfig(next);
  };

  const testSpeak = () => {
    if (testing) {
      cancelSpeak();
      setTesting(false);
      return;
    }
    setTesting(true);
    speak("你好，这是语音测试。Hello, this is a voice test.", {
      voiceURI: cfg?.voiceURI ?? undefined,
      rate: cfg?.rate,
      pitch: cfg?.pitch,
    });
    const check = setInterval(() => {
      if (!window.speechSynthesis?.speaking) {
        setTesting(false);
        clearInterval(check);
      }
    }, 200);
  };

  if (!cfg) return null;

  return (
    <>
      <Card title="文字转语音 (TTS)" hint="使用系统内置语音引擎，离线运行。启用后 AI 回复消息可朗读。">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text">启用朗读</div>
            <div className="text-[12px] text-muted">在 AI 消息上显示朗读按钮</div>
          </div>
          <button
            role="switch"
            aria-checked={cfg.ttsEnabled}
            onClick={() => update({ ttsEnabled: !cfg.ttsEnabled })}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
              cfg.ttsEnabled ? "bg-accent" : "bg-surface-2",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform",
                cfg.ttsEnabled ? "left-[18px]" : "left-0.5",
              )}
            />
          </button>
        </div>

        {cfg.ttsEnabled && (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs text-muted">
                <Volume2 size={12} /> 语音选择
              </span>
              <select
                value={cfg.voiceURI ?? ""}
                onChange={(e) => update({ voiceURI: e.target.value || null })}
                className={inputCls("w-full")}
              >
                <option value="">系统默认</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang}){v.localService ? " [本地]" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted">
                <span>语速</span>
                <span className="font-mono text-text">{cfg.rate.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={cfg.rate}
                onChange={(e) => update({ rate: Number(e.target.value) })}
                className="w-full accent-accent"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted">
                <span>音调</span>
                <span className="font-mono text-text">{cfg.pitch.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={cfg.pitch}
                onChange={(e) => update({ pitch: Number(e.target.value) })}
                className="w-full accent-accent"
              />
            </div>

            <button
              onClick={testSpeak}
              className={btnGhost("gap-1.5")}
            >
              <Volume2 size={13} className={testing ? "animate-pulse" : ""} />
              {testing ? "停止测试" : "测试朗读"}
            </button>
          </div>
        )}
      </Card>

      <Card title="语音转文字 (STT)" hint="使用 Whisper.cpp 本地模型转写，离线运行。启用后输入框显示麦克风按钮。">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
              <Mic size={13} />
              启用语音输入
            </div>
            <div className="text-[12px] text-muted">
              {sttSupported
                ? "点击麦克风开始录音，再次点击停止并自动转写为文字。使用 Whisper tiny 模型，全程离线。"
                : "未检测到 whisper-cli 或模型文件。请运行 scripts/dev/fetch-whisper.sh 下载。"}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={cfg.sttEnabled}
            disabled={!sttSupported}
            onClick={() => update({ sttEnabled: !cfg.sttEnabled })}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40",
              cfg.sttEnabled ? "bg-accent" : "bg-surface-2",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform",
                cfg.sttEnabled ? "left-[18px]" : "left-0.5",
              )}
            />
          </button>
        </div>
      </Card>
    </>
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
