import type { CreateTaskInput, ScheduledTask } from '@workbench/sdk';
import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getHostClient } from '@/lib/connection';

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天早上8点', value: '0 8 * * *' },
  { label: '工作日早上9点', value: '0 9 * * 1-5' },
  { label: '每周一', value: '0 9 * * 1' },
  { label: '每月1号', value: '0 8 1 * *' },
  { label: '自定义', value: '' },
];

interface Props {
  taskId?: string;
  onDone: () => void;
}

export function TaskFormPage({ taskId, onDone }: Props) {
  const [task, setTask] = useState<ScheduledTask | null>(null);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('');
  const [cron, setCron] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState('');
  const [model, setModel] = useState('');
  const [tags, setTags] = useState('');
  const [cronError, setCronError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!taskId) return;
    void (async () => {
      try {
        const t = (await getHostClient().listTasks()).find((x) => x.id === taskId);
        if (t) {
          setTask(t);
          setName(t.name);
          setCron(t.cron);
          setPrompt(t.prompt);
          setAgent(t.agent ?? '');
          setModel(t.model ?? '');
          setTags(t.tags?.join(', ') ?? '');
          const m = CRON_PRESETS.find((p) => p.value === t.cron);
          setPreset(m ? m.value : '');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [taskId]);

  const handlePreset = (value: string) => {
    setPreset(value);
    if (value) {
      setCron(value);
      setCronError('');
    }
  };

  const handleCron = (value: string) => {
    setCron(value);
    setPreset('');
    if (value.trim().split(/\s+/).length === 5) setCronError('');
  };

  const submit = async () => {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      setCronError('Cron 表达式需要 5 个字段（分 时 日 月 周）');
      return;
    }
    if (!name.trim() || !prompt.trim()) return;
    setSaving(true);
    setError('');
    try {
      const input: CreateTaskInput = {
        name: name.trim(),
        cron: cron.trim(),
        prompt: prompt.trim(),
        agent: agent.trim() || undefined,
        model: model.trim() || undefined,
        tags: tags.trim()
          ? tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
      };
      const host = getHostClient();
      if (task) {
        await host.updateTask(task.id, input);
      } else {
        await host.createTask(input);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button onClick={onDone} className="icon-btn" aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <h1 className="page-title">{task ? '编辑任务' : '新建任务'}</h1>
        <button
          onClick={() => void submit()}
          disabled={saving || !name.trim() || !prompt.trim()}
          className="icon-btn accent"
          aria-label="保存"
        >
          <Check size={18} />
        </button>
      </header>

      {error && <div className="page-error">{error}</div>}

      <div className="form-page">
        <div className="field">
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="任务名称" />
        </div>

        <div className="field">
          <label>执行计划</label>
          <select value={preset} onChange={(e) => handlePreset(e.target.value)}>
            {CRON_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Cron 表达式</label>
          <input
            value={cron}
            onChange={(e) => handleCron(e.target.value)}
            placeholder="0 8 * * *"
            className="mono"
          />
          {cronError && <span className="field-error">{cronError}</span>}
        </div>

        <div className="field">
          <label>提示词</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Agent 要执行的提示词"
            rows={5}
          />
        </div>

        <div className="field">
          <label>Agent（可选）</label>
          <input
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="留空使用默认"
          />
        </div>

        <div className="field">
          <label>模型（可选）</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="留空使用默认"
          />
        </div>

        <div className="field">
          <label>标签（逗号分隔）</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="report, daily"
          />
        </div>
      </div>
    </div>
  );
}
