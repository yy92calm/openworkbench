import type { PermissionAskedEvent, PermissionReply, QuestionAskedEvent } from '@workbench/sdk';
import { Check, HelpCircle, Paperclip, ShieldQuestion } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

import { PromptShelf } from './PromptShelf';

const actionLabel = (action: string) => action.replace(/[_-]+/g, ' ');

export function InteractionPrompt({
  question,
  permission,
  origin,
  fileSuggestions = [],
  onAnswer,
  onReject,
  onPermission,
}: {
  question?: QuestionAskedEvent;
  permission?: PermissionAskedEvent;
  origin?: string;
  fileSuggestions?: string[];
  onAnswer: (requestId: string, answers: string[][]) => void;
  onReject: (requestId: string) => void;
  onPermission: (requestId: string, reply: PermissionReply) => void;
}) {
  if (question) {
    return (
      <QuestionCard
        key={question.requestId}
        question={question}
        origin={origin}
        fileSuggestions={fileSuggestions}
        onAnswer={onAnswer}
        onReject={onReject}
      />
    );
  }
  if (permission) {
    return (
      <PermissionCard
        key={permission.requestId}
        permission={permission}
        origin={origin}
        onReply={onPermission}
      />
    );
  }
  return null;
}

function QuestionCard({
  question,
  origin,
  fileSuggestions,
  onAnswer,
  onReject,
}: {
  question: QuestionAskedEvent;
  origin?: string;
  fileSuggestions?: string[];
  onAnswer: (requestId: string, answers: string[][]) => void;
  onReject: (requestId: string) => void;
}) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  const items = question.questions;
  const toggle = (qi: number, label: string, multiple: boolean) =>
    setSelected((s) => {
      const cur = new Set(multiple ? (s[qi] ?? []) : []);
      if (cur.has(label)) cur.delete(label);
      else cur.add(label);
      return { ...s, [qi]: cur };
    });

  const answerFor = (qi: number): string[] => {
    const picked = [...(selected[qi] ?? [])];
    const c = custom[qi]?.trim();
    return c ? [...picked, c] : picked;
  };
  const ready = items.every((_, qi) => answerFor(qi).length > 0);
  const isQuickPick = items.length === 1 && !items[0].multiple && !items[0].custom;

  return (
    <PromptShelf
      icon={<HelpCircle size={15} className="text-accent" />}
      title="Agent 需要你的输入"
      subtitle={origin ? `由 ${origin} 提问` : undefined}
      tone="accent"
      headerRight={
        <button
          className="text-xs text-muted hover:text-text"
          onClick={() => onReject(question.requestId)}
        >
          跳过
        </button>
      }
      footer={
        !isQuickPick && (
          <>
            <button
              className="rounded-input px-3 py-1.5 text-xs text-muted hover:text-text"
              onClick={() => onReject(question.requestId)}
            >
              跳过
            </button>
            <div className="flex-1" />
            <button
              disabled={!ready}
              onClick={() =>
                onAnswer(
                  question.requestId,
                  items.map((_, qi) => answerFor(qi)),
                )
              }
              className="rounded-input bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              提交
            </button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {items.map((it, qi) => (
          <div key={qi} className="space-y-2">
            <div className="text-sm text-text">{it.question}</div>
            <div className="flex flex-col gap-1.5">
              {it.options.map((opt) => {
                const on = selected[qi]?.has(opt.label) ?? false;
                const act = () =>
                  isQuickPick
                    ? onAnswer(question.requestId, [[opt.label]])
                    : toggle(qi, opt.label, !!it.multiple);
                return (
                  <button
                    key={opt.label}
                    onClick={act}
                    className={cn(
                      'flex items-start gap-2.5 rounded-input border px-3 py-2 text-left transition-colors',
                      on
                        ? 'border-accent bg-accent/10'
                        : 'border-border bg-surface hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                        on ? 'border-accent bg-accent text-accent-fg' : 'border-muted/50',
                      )}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-text">{opt.label}</span>
                      {opt.description && (
                        <span className="mt-0.5 block text-xs leading-snug text-muted">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {it.custom && (
              <CustomInput
                value={custom[qi] ?? ''}
                onChange={(v) => setCustom((c) => ({ ...c, [qi]: v }))}
                fileSuggestions={fileSuggestions}
              />
            )}
          </div>
        ))}
      </div>
    </PromptShelf>
  );
}

/** Custom answer input with @ file mention support. */
function CustomInput({
  value,
  onChange,
  fileSuggestions,
}: {
  value: string;
  onChange: (v: string) => void;
  fileSuggestions?: string[];
}) {
  const ref = useRef<HTMLInputElement>(null);

  // @ mention detection
  const atMatch = useMemo(() => value.match(/@(\S*)$/), [value]);
  const atTyping = !!atMatch && atMatch.index !== undefined && atMatch.index >= 0;
  const atQuery = atTyping ? atMatch![1].toLowerCase() : '';
  const fileMatches =
    atTyping && fileSuggestions && fileSuggestions.length > 0
      ? fileSuggestions
          .filter((f) => f.toLowerCase().includes(atQuery))
          .sort(
            (a, b) =>
              Number(b.toLowerCase().startsWith(atQuery)) -
              Number(a.toLowerCase().startsWith(atQuery)),
          )
          .slice(0, 8)
      : [];
  const atOpen = fileMatches.length > 0;

  const pickFile = (filePath: string) => {
    if (!atMatch) return;
    const before = value.slice(0, atMatch.index);
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    onChange(`${before}@${fileName} `);
    ref.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (atOpen && e.key === 'Enter') {
      e.preventDefault();
      pickFile(fileMatches[0]);
    }
    if (atOpen && e.key === 'Escape') {
      e.preventDefault();
      if (atMatch) onChange(value.slice(0, atMatch.index));
    }
  };

  return (
    <div className="relative">
      {atOpen && (
        <div className="absolute bottom-full left-0 right-0 z-dropdown mb-1 max-h-36 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card">
          {fileMatches.map((f) => (
            <button
              key={f}
              className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-xs hover:bg-surface-2"
              onMouseDown={(e) => {
                e.preventDefault();
                pickFile(f);
              }}
            >
              <Paperclip size={11} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-text">{f}</span>
            </button>
          ))}
        </div>
      )}
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="或输入自定义答案…（输入 @ 引用文件）"
        className="w-full rounded-input border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/60"
      />
    </div>
  );
}

function PermissionCard({
  permission,
  origin,
  onReply,
}: {
  permission: PermissionAskedEvent;
  origin?: string;
  onReply: (requestId: string, reply: PermissionReply) => void;
}) {
  return (
    <PromptShelf
      icon={<ShieldQuestion size={15} className="text-warn" />}
      title={
        <span>
          Agent 请求权限：<span className="font-mono">{actionLabel(permission.action)}</span>
        </span>
      }
      subtitle={origin ? `由 ${origin} 请求` : undefined}
      tone="warn"
      footer={
        <>
          <button
            className="rounded-input px-3 py-1.5 text-xs text-error hover:bg-error/10"
            onClick={() => onReply(permission.requestId, 'reject')}
          >
            拒绝
          </button>
          <div className="flex-1" />
          <button
            className="rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"
            onClick={() => onReply(permission.requestId, 'always')}
          >
            始终允许
          </button>
          <button
            className="rounded-input bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
            onClick={() => onReply(permission.requestId, 'once')}
          >
            允许一次
          </button>
        </>
      }
    >
      {permission.resources.length > 0 && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-input border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] text-text">
          {permission.resources.join('\n')}
        </pre>
      )}
    </PromptShelf>
  );
}
