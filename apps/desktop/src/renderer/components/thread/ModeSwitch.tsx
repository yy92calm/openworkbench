import { useState } from "react";
import { Shield, ShieldAlert, Zap } from "lucide-react";
import type { PermissionMode } from "@workbench/sdk";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const MODES: { value: PermissionMode; label: string; icon: React.ReactNode }[] = [
  { value: "review", label: "审核", icon: <ShieldAlert size={12} /> },
  { value: "auto", label: "自动", icon: <Shield size={12} /> },
  { value: "yolo", label: "YOLO", icon: <Zap size={12} /> },
];

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}) {
  // Switching INTO yolo needs a second confirmation — it disables the doom-loop
  // guard. Switching out of yolo does not.
  const [pendingYolo, setPendingYolo] = useState(false);
  const choose = (next: PermissionMode) => {
    if (next === "yolo" && mode !== "yolo") setPendingYolo(true);
    else onChange(next);
  };

  return (
    <>
      <div className="flex items-center gap-0.5 rounded-input bg-surface-2 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.value}
            className={cn(
              "flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
              mode === m.value
                ? m.value === "yolo"
                  ? "bg-warn/20 text-warn"
                  : m.value === "review"
                    ? "bg-error/15 text-error"
                    : "bg-accent/15 text-accent"
                : "text-muted hover:text-text",
            )}
            onClick={() => choose(m.value)}
            title={
              m.value === "review"
                ? "每次操作需确认"
                : m.value === "yolo"
                  ? "全自动，无需确认（关闭死循环防护）"
                  : "自动执行常规操作"
            }
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
      {pendingYolo && (
        <ConfirmDialog
          title="切换到 YOLO 模式？"
          body="YOLO 模式会自动批准所有操作，并关闭死循环（doom loop）防护。Agent 可能长时间无节制地执行命令或改写文件，请确认你了解风险。"
          confirmLabel="我了解风险，切换到 YOLO"
          onConfirm={() => {
            setPendingYolo(false);
            onChange("yolo");
          }}
          onCancel={() => setPendingYolo(false)}
        />
      )}
    </>
  );
}
