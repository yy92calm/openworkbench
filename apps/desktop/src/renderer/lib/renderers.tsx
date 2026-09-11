// Keyed renderer registry (第二批「交互层」).
//
// The agent emits fenced blocks tagged `workbench:<type>` (e.g. a JSON payload
// for a summary card). The MarkdownViewer intercepts those fences and resolves
// `<type>` against this registry. A type the packager did not enable — or one
// with no built-in — degrades to a plain code block, so unknown output never
// breaks the thread.
//
// Security model: RECEIVED-CONTROLLED DECLARATIVE. Only code shipped in the app
// (this file) can render; the profile gates types on/off and carries options.
// No arbitrary React source or script from a profile is ever evaluated.
import type { RendererManifest } from '@workbench/shared';
import type { ReactNode } from 'react';

import { useUiStore } from './store';

/** Built-in renderer contract: given the fence payload (any JSON) and the
 *  manifest options, return a node. Returning null degrades to a code block. */
export type RendererFn = (payload: unknown, options?: Record<string, unknown>) => ReactNode;

/** Parse the JSON payload from a `workbench:<type>` fence. Invalid JSON yields
 *  a graceful degraded value the built-in renderers can still display. */
function parsePayload(raw: string): { ok: boolean; value: unknown } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, value: trimmed };
  }
}

function kvCell(row: [string, unknown]): [string, string] {
  const key = String(row[0]);
  const raw = row[1];
  if (typeof raw === 'string') return [key, raw];
  if (typeof raw === 'number' || typeof raw === 'boolean') return [key, String(raw)];
  if (raw === null) return [key, '—'];
  return [key, JSON.stringify(raw, null, 2)];
}

/** kv-card: renders `{ "标题可选项": {k: v, …} }` or `{k: v, …}` /
 *  `[ [k, v], … ]` as a titled key-value card. An optional top-level
 *  `actions: [{label, prompt}]` (max 4) renders buttons that PREFILL the
 *  composer draft — they never auto-send (docs/20260911-01). */
type KvAction = { label: string; prompt: string };

function extractKvActions(payload: unknown): { actions: KvAction[]; rest: unknown } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { actions: [], rest: payload };
  }
  const obj = payload as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) return { actions: [], rest: payload };
  const actions = obj.actions
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      label: typeof a.label === 'string' ? a.label : '',
      prompt: typeof a.prompt === 'string' ? a.prompt : '',
    }))
    .filter((a) => a.label && a.prompt)
    .slice(0, 4);
  const rest = { ...obj };
  delete rest.actions;
  return { actions, rest };
}

function KvCardActions({ actions }: { actions: KvAction[] }) {
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);
  return (
    <div className="flex flex-wrap gap-2 border-t border-border-soft px-4 py-2">
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => setComposerDraft(a.prompt)}
          className="rounded-input border border-border bg-surface px-2.5 py-1 text-[12px] text-text transition-colors hover:bg-surface-2"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function KvCard(payload: unknown, options?: Record<string, unknown>): ReactNode {
  const title = typeof options?.title === 'string' ? options.title : undefined;
  const { actions, rest } = extractKvActions(payload);
  let data: unknown = rest;
  let label = title;
  if (rest && typeof rest === 'object' && !Array.isArray(rest)) {
    const entries = Object.entries(rest as Record<string, unknown>);
    // A single inner object becomes the card body with its key as the title.
    if (
      entries.length === 1 &&
      entries[0][1] &&
      typeof entries[0][1] === 'object' &&
      !Array.isArray(entries[0][1])
    ) {
      label = label ?? String(entries[0][0]);
      data = entries[0][1];
    }
  }
  const rows = Array.isArray(data)
    ? (data as unknown[])
        .map((v) =>
          Array.isArray(v) && v.length === 2 ? ([String(v[0]), v[1]] as [string, unknown]) : null,
        )
        .filter((r): r is [string, unknown] => r !== null)
    : data && typeof data === 'object'
      ? Object.entries(data as Record<string, unknown>)
      : [['内容', data] as [string, unknown]];

  return (
    <div className="my-3 overflow-hidden rounded-input border border-border bg-surface shadow-card">
      {label && (
        <div className="border-b border-border bg-surface-2 px-4 py-2 text-[13px] font-medium text-text">
          {label}
        </div>
      )}
      <dl className="divide-y divide-border-soft">
        {rows.map((row, i) => {
          const [k, v] = kvCell(row);
          return (
            <div key={i} className="flex gap-4 px-4 py-2 text-[13px]">
              <dt className="w-36 shrink-0 text-muted">{k}</dt>
              <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text">{v}</dd>
            </div>
          );
        })}
      </dl>
      {actions.length > 0 && <KvCardActions actions={actions} />}
    </div>
  );
}

const BUILTINS: Record<string, RendererFn> = { 'kv-card': KvCard };

/** Requests a renderer, or null (degrade to code block) when the type has no
 *  built-in or the packager did not enable it. Passes manifest options through. */
export function renderWorkbenchFence(
  type: string,
  raw: string,
  enabled: Map<string, RendererManifest>,
): ReactNode | null {
  if (!enabled.has(type)) return null;
  const builtin = BUILTINS[type];
  if (!builtin) return null;
  const { value } = parsePayload(raw);
  return builtin(value, enabled.get(type)?.options);
}

const CONFIG_PATCH_RE = /```workbench:config-patch\s*([\s\S]*?)```/g;

/** Extract the raw JSON of the last `workbench:config-patch` fence from an
 *  agent reply. Returns null when absent or when the reply is still streaming
 *  (fence unclosed). Used by the settings config-conversation before the patch
 *  is handed to the main-process validator. */
export function extractConfigPatch(markdown: string): string | null {
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  CONFIG_PATCH_RE.lastIndex = 0;
  while ((match = CONFIG_PATCH_RE.exec(markdown)) !== null) {
    last = match;
  }
  // A trailing unclosed fence means the reply is mid-stream — hold off.
  const open = markdown.lastIndexOf('```workbench:config-patch');
  const close = markdown.lastIndexOf('```');
  if (open !== -1 && close <= open) return null;
  return last ? last[1].trim() : null;
}
