export type TabKey = "sessions" | "tasks" | "files" | "rooms" | "settings";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "sessions", label: "会话", icon: "💬" },
  { key: "tasks", label: "任务", icon: "⏰" },
  { key: "files", label: "文件", icon: "📁" },
  { key: "rooms", label: "会话分享", icon: "📡" },
  { key: "settings", label: "设置", icon: "⚙️" },
];

export function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="tab-bar">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`tab-item ${active === t.key ? "active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          <span className="tab-icon">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
