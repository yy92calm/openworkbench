import type { PermissionAskedEvent, PermissionReply, QuestionAskedEvent } from '@workbench/sdk';
import { Check, HelpCircle, Loader2, ShieldQuestion, X } from 'lucide-react';
import { useState } from 'react';

/** A pending interactive request (question or permission) that blocks the
 *  agent until the user answers. Rendered as a bottom sheet overlay. */
export type Interaction = QuestionAskedEvent | PermissionAskedEvent;

interface Props {
  interaction: Interaction;
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
  onRejectQuestion: (requestId: string) => Promise<void>;
  onReplyPermission: (requestId: string, reply: PermissionReply) => Promise<void>;
  onDismiss: () => void;
}

export function InteractionSheet({
  interaction,
  onAnswerQuestion,
  onRejectQuestion,
  onReplyPermission,
  onDismiss,
}: Props) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onDismiss();
    } catch {
      setBusy(false);
    }
  };

  const isQuestion = interaction.type === 'question.asked';

  return (
    <div className="sheet-backdrop" onClick={onDismiss}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          {isQuestion ? (
            <HelpCircle size={16} style={{ color: 'var(--accent)' }} />
          ) : (
            <ShieldQuestion size={16} style={{ color: 'var(--warn)' }} />
          )}
          <span className="sheet-title">{isQuestion ? '需要你的回答' : '需要你的批准'}</span>
          <button onClick={onDismiss} className="sheet-close" disabled={busy} aria-label="收起">
            <X size={14} />
          </button>
        </div>

        {isQuestion ? (
          <QuestionBody
            q={interaction as QuestionAskedEvent}
            busy={busy}
            onAnswer={(answers) => run(() => onAnswerQuestion(interaction.requestId, answers))}
            onReject={() => run(() => onRejectQuestion(interaction.requestId))}
          />
        ) : (
          <PermissionBody
            p={interaction as PermissionAskedEvent}
            busy={busy}
            onReply={(reply) => run(() => onReplyPermission(interaction.requestId, reply))}
          />
        )}
      </div>
    </div>
  );
}

function QuestionBody({
  q,
  busy,
  onAnswer,
  onReject,
}: {
  q: QuestionAskedEvent;
  busy: boolean;
  onAnswer: (answers: string[][]) => void;
  onReject: () => void;
}) {
  // One selection set per question (multiple not used in practice — but the
  // API takes string[][], so we keep the shape).
  const [selected, setSelected] = useState<string[][]>(q.questions.map(() => []));

  const toggle = (qi: number, label: string, multiple: boolean) => {
    setSelected((prev) => {
      const next = prev.map((s) => [...s]);
      const cur = next[qi];
      if (multiple) {
        const idx = cur.indexOf(label);
        if (idx >= 0) cur.splice(idx, 1);
        else cur.push(label);
      } else {
        next[qi] = cur[0] === label ? [] : [label];
      }
      return next;
    });
  };

  const canSubmit = selected.every((s) => s.length > 0);

  return (
    <div className="sheet-body">
      {q.questions.map((item, qi) => (
        <div key={qi} className="q-block">
          {item.header && <div className="q-header">{item.header}</div>}
          <div className="q-text">{item.question}</div>
          <div className="q-options">
            {item.options.map((opt) => {
              const on = selected[qi].includes(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => toggle(qi, opt.label, !!item.multiple)}
                  className={`q-option ${on ? 'on' : ''}`}
                  disabled={busy}
                >
                  <span
                    className={`q-check ${item.multiple ? 'square' : 'circle'} ${on ? 'on' : ''}`}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="q-option-text">
                    <span className="q-option-label">{opt.label}</span>
                    {opt.description && <span className="q-option-desc">{opt.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="sheet-actions">
        <button onClick={onReject} className="btn-ghost" disabled={busy}>
          跳过
        </button>
        <button
          onClick={() => onAnswer(selected)}
          className="btn-primary"
          disabled={busy || !canSubmit}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          提交
        </button>
      </div>
    </div>
  );
}

function PermissionBody({
  p,
  busy,
  onReply,
}: {
  p: PermissionAskedEvent;
  busy: boolean;
  onReply: (reply: PermissionReply) => void;
}) {
  const actionLabel = actionText(p.action);
  return (
    <div className="sheet-body">
      <div className="perm-action">
        <span className="perm-badge">{actionLabel}</span>
      </div>
      {p.resources.map((r, i) => (
        <pre key={i} className="perm-resource">
          {r}
        </pre>
      ))}

      <div className="sheet-actions">
        <button onClick={() => onReply('reject')} className="btn-danger" disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <X size={14} />}
          拒绝
        </button>
        <button onClick={() => onReply('once')} className="btn-ghost" disabled={busy}>
          允许一次
        </button>
        <button onClick={() => onReply('always')} className="btn-primary" disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          总是允许
        </button>
      </div>
    </div>
  );
}

function actionText(action: string): string {
  const map: Record<string, string> = {
    bash: '执行命令',
    write: '写入文件',
    edit: '编辑文件',
    skill: '调用技能',
    external_directory: '访问外部目录',
    doom_loop: '循环操作',
  };
  return map[action] ?? action;
}
