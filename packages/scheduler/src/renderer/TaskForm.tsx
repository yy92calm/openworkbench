import { useState, useEffect } from "react";
import type { ScheduledTask, CreateTaskInput, UpdateTaskInput } from "@/lib/electron";

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: "每小时", value: "0 * * * *" },
  { label: "每天早上8点", value: "0 8 * * *" },
  { label: "工作日早上9点", value: "0 9 * * 1-5" },
  { label: "每周一", value: "0 9 * * 1" },
  { label: "每月1号", value: "0 8 1 * *" },
  { label: "自定义", value: "" },
];

function humanCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return "";
  const [min, hour, dom, , dow] = parts;
  if (dom === "*" && dow === "*") return `每天 ${hour}:${min.padStart(2, "0")}`;
  if (dom === "*" && dow !== "*") {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    const dows = dow.split(",").map((d: string) => days[Number(d)] ?? d);
    return `每周${dows.join("、")} ${hour}:${min.padStart(2, "0")}`;
  }
  if (dom !== "*" && dow === "*") return `每月${dom}号 ${hour}:${min.padStart(2, "0")}`;
  return cron;
}

interface Props {
  task?: ScheduledTask;
  agents: string[];
  onSave: (task: CreateTaskInput) => void;
  onUpdate: (id: string, patch: UpdateTaskInput) => void;
  onCancel: () => void;
}

export function TaskForm({ task, agents, onSave, onUpdate, onCancel }: Props) {
  const [name, setName] = useState(task?.name ?? "");
  const [preset, setPreset] = useState("");
  const [cron, setCron] = useState(task?.cron ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [agent, setAgent] = useState(task?.agent ?? "");
  const [model, setModel] = useState(task?.model ?? "");
  const [tags, setTags] = useState(task?.tags?.join(", ") ?? "");
  const [cronError, setCronError] = useState("");

  useEffect(() => {
    const match = CRON_PRESETS.find((p) => p.value === cron);
    setPreset(match ? match.value : "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePreset = (value: string) => {
    setPreset(value);
    if (value) {
      setCron(value);
      setCronError("");
    }
  };

  const handleCron = (value: string) => {
    setCron(value);
    setPreset("");
    if (value.trim().split(/\s+/).length === 5) {
      setCronError("");
    }
  };

  const handleSubmit = () => {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      setCronError("Cron 表达式需要 5 个字段（分 时 日 月 周）");
      return;
    }
    if (!name.trim() || !prompt.trim()) return;

    const input: CreateTaskInput = {
      name: name.trim(),
      cron: cron.trim(),
      prompt: prompt.trim(),
      agent: agent.trim() || undefined,
      model: model.trim() || undefined,
      tags: tags.trim() ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    };

    if (task) {
      onUpdate(task.id, input);
    } else {
      onSave(input);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-[480px] rounded-card border border-border bg-surface p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-lg text-text">
          {task ? "编辑定时任务" : "新建定时任务"}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">名称</label>
            <input
              className="w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入任务名称"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">执行计划</label>
            <select
              className="w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              value={preset}
              onChange={(e) => handlePreset(e.target.value)}
            >
              <option value="">选择预设或自定义</option>
              {CRON_PRESETS.map((p) => (
                <option key={p.value || "__custom"} value={p.value}>{p.label}</option>
              ))}
            </select>
            <input
              className="mt-1 w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text font-mono placeholder:text-muted focus:outline-none focus:border-accent"
              value={cron}
              onChange={(e) => handleCron(e.target.value)}
              placeholder="分 时 日 月 周（如 0 8 * * 1-5）"
            />
            {cronError && <div className="mt-1 text-xs text-error">{cronError}</div>}
            {!cronError && cron && <div className="mt-1 text-xs text-muted">→ {humanCron(cron)}</div>}
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">提示词</label>
            <textarea
              className="w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent resize-none"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入要发送给 Agent 的提示词"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Agent（可选）</label>
              <select
                className="w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="">默认</option>
                {agents.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">模型（可选）</label>
              <input
                className="w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="默认"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">标签（可选，逗号分隔）</label>
            <input
              className="w-full rounded-input border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="市场, 日报"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
            onClick={handleSubmit}
          >
            {task ? "保存" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}