import { createContext, useContext, useCallback, type ReactNode } from "react";

export type Locale = "en" | "zh-CN";

const LOCALE_KEY = "workbench.locale";

export function loadLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  const saved = window.localStorage.getItem(LOCALE_KEY);
  if (saved === "en" || saved === "zh-CN") return saved;
  return "zh-CN";
}

export function persistLocale(locale: Locale) {
  if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_KEY, locale);
}

type TranslationMap = Record<string, string>;

const en: TranslationMap = {
  "skills.title": "Skills & Agents",
  "skills.subtitle": "Loaded live from the agent runtime.",
  "skills.noAgents": "No agents loaded.",
  "skills.noSkills": "No skills loaded.",
  "skills.noDesc": "No description",
  "skills.builtin": "built-in",
  "skills.project": "project",
  "skills.user": "user",
  "skills.disconnected": "Connect the runtime to list the skills and agents it has loaded.",

  "settings.title": "Settings",
  "settings.subtitle":
    "Runtime connection, workspace, and appearance. The agent's providers, model, skills, and permissions come from the bundled profile.",
  "settings.runtime": "Agent runtime",
  "settings.runtimeHint": "Agent serve, driven over its HTTP + SSE API",
  "settings.runtimeKind": "Runtime engine",
  "settings.runtimeKindHint": "OpenCode (bundled sidecar) or Claude Code (requires the Agent SDK)",
  "settings.disconnect": "Disconnect",
  "settings.connect": "Connect",
  "settings.workspace": "Workspace",
  "settings.workspaceHint": "Local-first — each session works in its own dated subfolder created here",
  "settings.change": "Change…",
  "settings.reveal": "Reveal",
  "settings.appearance": "Appearance",
  "settings.language": "Language",
  "settings.model": "Model",
  "settings.modelHint": "Select the default model for the agent",
  "settings.tabGeneral": "General",
  "settings.tabRuntime": "Runtime",
  "settings.tabWorkspace": "Workspace",
  "settings.tabPrivacy": "Privacy & data",
  "settings.tabAbout": "About",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeSystem": "System",
  "settings.expandDetails": "Expand reasoning & tools by default",
  "settings.expandDetailsHint": "When off, reasoning and tool calls start collapsed; click to expand each",
  "settings.version": "Version",
  "settings.channel": "Channel",
  "settings.appId": "App identifier",
  "settings.checkUpdates": "Check for updates",
  "settings.exportLogs": "Export logs",
  "settings.exportLogsHint": "Save debug logs to a file",
  "settings.privacyHint": "Local-first - what stays on this machine vs. what leaves it",
  "settings.aboutHint": "App version and diagnostics",
  "settings.workspaceSet": "New sessions will be created in this folder.",
  "settings.workspaceError": "Could not set the folder:",

  "sidebar.new": "New",
  "sidebar.notebooks": "Notebooks",
  "sidebar.files": "Files",
  "sidebar.skills": "Skills",
  "sidebar.tasks": "Tasks",
  "sidebar.history": "History",
  "sidebar.noConversations": "No conversations yet.",
  "sidebar.settings": "Settings",
  "sidebar.example": "example",
  "sidebar.deleteSession": "Delete session?",
  "sidebar.hideExample": "Hide example?",
  "sidebar.delete": "Delete",
  "sidebar.hide": "Hide",
  "sidebar.deleteSessionBody": " and its messages will be deleted. This cannot be undone.",
  "sidebar.hideExampleBody": " will be hidden from the sidebar.",
};

const zhCN: TranslationMap = {
  "skills.title": "技能与智能体",
  "skills.subtitle": "从 Agent 运行时实时加载。",
  "skills.noAgents": "未加载智能体。",
  "skills.noSkills": "未加载技能。",
  "skills.noDesc": "无描述",
  "skills.builtin": "内置",
  "skills.project": "项目",
  "skills.user": "用户",
  "skills.disconnected": "连接运行时以列出已加载的技能和智能体。",

  "settings.title": "设置",
  "settings.subtitle":
    "运行时连接、工作区和外观。智能体的供应商、模型、技能和权限来自捆绑的配置文件。",
  "settings.runtime": "智能体运行时",
  "settings.runtimeHint": "Agent serve，通过 HTTP + SSE API 驱动",
  "settings.runtimeKind": "运行时引擎",
  "settings.runtimeKindHint": "OpenCode（内置 sidecar）或 Claude Code（需安装 Agent SDK）",
  "settings.disconnect": "断开连接",
  "settings.connect": "连接",
  "settings.workspace": "工作区",
  "settings.workspaceHint": "本地优先 — 每个会话在此处创建的带日期子文件夹中工作",
  "settings.change": "更改…",
  "settings.reveal": "显示",
  "settings.appearance": "外观",
  "settings.language": "语言",
  "settings.model": "模型",
  "settings.modelHint": "选择 Agent 默认模型",
  "settings.tabGeneral": "通用",
  "settings.tabRuntime": "运行时",
  "settings.tabWorkspace": "工作区",
  "settings.tabPrivacy": "隐私与数据",
  "settings.tabAbout": "关于",
  "settings.themeLight": "浅色",
  "settings.themeDark": "深色",
  "settings.themeSystem": "跟随系统",
  "settings.expandDetails": "默认展开思考与工具",
  "settings.expandDetailsHint": "关闭时思考过程与工具调用默认折叠，可逐个点击展开",
  "settings.version": "版本",
  "settings.channel": "渠道",
  "settings.appId": "应用标识",
  "settings.checkUpdates": "检查更新",
  "settings.exportLogs": "导出日志",
  "settings.exportLogsHint": "把调试日志保存到文件",
  "settings.privacyHint": "本地优先 - 明确什么留在本机、什么发往模型供应商",
  "settings.aboutHint": "应用版本与诊断工具",
  "settings.workspaceSet": "新会话将在此文件夹中创建。",
  "settings.workspaceError": "无法设置文件夹：",

  "sidebar.new": "新建",
  "sidebar.notebooks": "笔记本",
  "sidebar.files": "文件",
  "sidebar.skills": "技能",
  "sidebar.tasks": "任务",
  "sidebar.history": "历史",
  "sidebar.noConversations": "暂无对话。",
  "sidebar.settings": "设置",
  "sidebar.example": "示例",
  "sidebar.deleteSession": "删除会话？",
  "sidebar.hideExample": "隐藏示例？",
  "sidebar.delete": "删除",
  "sidebar.hide": "隐藏",
  "sidebar.deleteSessionBody": " 及其消息将被删除，无法撤销。",
  "sidebar.hideExampleBody": " 将从侧边栏中隐藏。",
};

const maps: Record<Locale, TranslationMap> = { en, "zh-CN": zhCN };

interface I18nContextValue {
  locale: Locale;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: (key) => key,
});

export function useI18n() {
  return useContext(I18nContext);
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const t = useCallback(
    (key: string) => maps[locale]?.[key] ?? key,
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, t }}>
      {children}
    </I18nContext.Provider>
  );
}