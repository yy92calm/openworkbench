import type { ToolUpdatedEvent } from '@workbench/sdk';
import type { ProvenanceRecord } from '@workbench/shared';

import { deriveArtifact } from './artifacts';
import { logDebug } from './electron';

export interface ProvenanceInput {
  path: string;
  tool: string;
  content?: string;
  log: string;
}

const JUPYTER_MUTATING = /insert|overwrite|delete|execute|write|edit|append|run/;

export function provenanceInputFromEvent(event: ToolUpdatedEvent): ProvenanceInput | null {
  if (event.status !== 'success') return null;
  const artifact = deriveArtifact(event);
  if (!artifact) return null;
  const tool = (event.tool ?? '').toLowerCase();
  if (tool.includes('jupyter') && !JUPYTER_MUTATING.test(tool)) return null;
  const title = event.title?.trim();
  const log =
    title && !title.endsWith(artifact.filename) ? title : `${event.tool} → ${artifact.path}`;
  return { path: artifact.path, tool: event.tool, content: artifact.content, log };
}

function electronAPI() {
  if (typeof window === 'undefined' || !window.electronAPI)
    throw new Error('not running in the desktop app');
  return window.electronAPI;
}

export async function recordProvenance(
  input: ProvenanceInput,
  sessionId: string | undefined,
  model: string | null,
): Promise<void> {
  try {
    await electronAPI().recordProvenance(
      sessionId ?? '',
      input.path,
      input.tool,
      { content: input.content ?? null, log: input.log },
      null,
      model,
    );
    void logDebug(`provenance ✓ ${input.path}`);
  } catch (e) {
    void logDebug(
      `provenance FAILED for ${input.path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function listProvenance(path: string): Promise<ProvenanceRecord[]> {
  try {
    return (await electronAPI().listProvenance(path)) as ProvenanceRecord[];
  } catch {
    return [];
  }
}

export async function readEnvLockfile(hash: string): Promise<string | null> {
  try {
    return await electronAPI().readEnvLockfile(hash);
  } catch {
    return null;
  }
}
