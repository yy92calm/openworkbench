import { useState, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { TaskCard } from "@/components/scheduler/TaskCard";
import { TaskForm } from "@/components/scheduler/TaskForm";
import { ExecutionHistory } from "@/components/scheduler/ExecutionHistory";
import type { ScheduledTask, CreateTaskInput, UpdateTaskInput } from "@/lib/electron";
import {
  schedulerList,
  schedulerCreate,
  schedulerUpdate,
  schedulerDelete,
  schedulerToggle,
  schedulerFireNow,
} from "@/lib/electron";
import { useRuntimeStore } from "@/lib/runtime";
import { toast } from "@/lib/toast";

export function TasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();
  const agents = useRuntimeStore((s) => s.agents);

  const load = useCallback(async () => {
    const list = await schedulerList();
    setTasks(list);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCreate = async (input: CreateTaskInput) => {
    await schedulerCreate(input);
    setShowForm(false);
    load();
  };

  const handleUpdate = async (id: string, patch: UpdateTaskInput) => {
    await schedulerUpdate(id, patch);
    setEditingTask(undefined);
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await schedulerDelete(id);
    if (expandedId === id) setExpandedId(null);
    load();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await schedulerToggle(id, enabled);
    load();
  };

  const handleFireNow = async (id: string) => {
    try {
      const record = await schedulerFireNow(id);
      if (record) {
        toast.success(`任务已触发（${record.status}）`);
      } else {
        toast.error("触发失败：运行时未就绪或任务不存在");
      }
    } catch (err) {
      toast.error(`触发失败：${err instanceof Error ? err.message : String(err)}`);
    }
    load();
  };

  const handleEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const openNew = () => {
    setEditingTask(undefined);
    setShowForm(true);
  };

  const agentNames = agents.map((a) => a.name);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-xl text-text">定时任务</h1>
            <p className="mt-1 text-sm text-muted">
              配置周期性 Agent 提示词，自动执行
            </p>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
            onClick={openNew}
          >
            <Plus size={16} />
            新建任务
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="mt-6 rounded-card border border-border bg-surface p-10 text-center">
            <p className="text-sm text-muted">
              还没有定时任务，点击「新建任务」创建第一个。
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <div key={task.id}>
                <TaskCard
                  task={task}
                  expanded={expandedId === task.id}
                  onToggleExpand={() =>
                    setExpandedId(expandedId === task.id ? null : task.id)
                  }
                  onToggle={handleToggle}
                  onFireNow={handleFireNow}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
                {expandedId === task.id && (
                  <div className="rounded-b-card border border-t-0 border-border bg-surface px-4 pb-4">
                    <ExecutionHistory taskId={task.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="mt-8">
            <h2 className="font-serif text-base text-text mb-3">全部执行记录</h2>
            <div className="rounded-card border border-border bg-surface px-4 py-3">
              <ExecutionHistory />
            </div>
          </div>
        )}

        {showForm && (
          <TaskForm
            task={editingTask}
            agents={agentNames}
            onSave={handleCreate}
            onUpdate={handleUpdate}
            onCancel={() => {
              setShowForm(false);
              setEditingTask(undefined);
            }}
          />
        )}
      </div>
    </div>
  );
}