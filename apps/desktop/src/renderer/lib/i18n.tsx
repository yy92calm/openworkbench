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
  "settings.display": "Conversation display",
  "settings.displayHint": "Default expand state for agent reasoning and tool calls",
  "settings.dataFlow.title": "Data flow",
  "settings.dataFlow.subtitle": "What stays on your machine, and what leaves it.",
  "settings.dataFlow.local": "Stays on this machine",
  "settings.dataFlow.local1": "Your workspace files and raw data",
  "settings.dataFlow.local2": "Code and terminal run locally - the Python/R kernel and shell execute here; datasets are never uploaded in bulk.",
  "settings.dataFlow.local3": "Session history, scheduled-task logs, and a traceable record of every artifact, in the app's private folder.",
  "settings.dataFlow.local4": "Provider keys and login tokens - a file only you can read; never written to the workspace, logs, or exports.",
  "settings.dataFlow.sent": "Sent to your model provider",
  "settings.dataFlow.sent1": "Your messages, and the file contents / command output the agent reads to do what you asked.",
  "settings.dataFlow.sent2": "Data leaves only during a conversation turn - including turns triggered by a scheduled task.",
  "settings.dataFlow.sent3": "What the provider keeps is governed by its own privacy policy.",
  "settings.dataFlow.footnote": "Bundled skills and MCP servers (e.g. web fetch) may make their own network calls - review the .opencode profile before packaging.",
  "settings.dataFlow.noModel": "no model configured",
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
  "settings.display": "对话显示",
  "settings.displayHint": "Agent 思考与工具调用的默认展开状态",
  "settings.dataFlow.title": "数据流向",
  "settings.dataFlow.subtitle": "哪些留在你的电脑上，哪些会发送出去。",
  "settings.dataFlow.local": "保留在本机",
  "settings.dataFlow.local1": "你的工作区文件和原始数据",
  "settings.dataFlow.local2": "代码与终端在本地运行--Python/R 内核与 shell 就地执行，数据集不会批量上传。",
  "settings.dataFlow.local3": "会话历史、定时任务记录与每个产物的可追溯记录，保存在应用私有目录。",
  "settings.dataFlow.local4": "供应商密钥与登录令牌——仅你可读的文件，永不写入工作区、日志或导出。",
  "settings.dataFlow.sent": "发送给模型供应商",
  "settings.dataFlow.sent1": "你的消息，以及 agent 为完成任务而读取的文件内容与命令输出。",
  "settings.dataFlow.sent2": "数据仅在对话轮次中离开本机--包括定时任务触发的轮次。",
  "settings.dataFlow.sent3": "供应商保留什么，由其自身隐私政策决定。",
  "settings.dataFlow.footnote": "内置技能与 MCP 服务器（如网页抓取）可能自行发起网络请求--打包前请检查 .opencode 配置。",
  "settings.dataFlow.noModel": "未配置模型",
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