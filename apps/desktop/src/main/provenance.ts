import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { workspaceDir } from './server';

const PROVENANCE_DIR = '.workbench';
const PROVENANCE_FILE = 'provenance.jsonl';

function provenancePath(): string {
  const dir = join(workspaceDir(), PROVENANCE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, PROVENANCE_FILE);
}

export function recordProvenance(
  sessionId: string,
  callId: string,
  tool: string,
  input: unknown,
  output: unknown,
  model: string | null,
): void {
  const record = {
    sessionId,
    callId,
    tool,
    input,
    output,
    model,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(provenancePath(), JSON.stringify(record) + '\n', 'utf-8');
}

export function listProvenance(path: string): unknown[] {
  const file = provenancePath();
  if (!existsSync(file)) return [];
  try {
    const text = readFileSync(file, 'utf-8');
    const records: unknown[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.path === path || r.input?.path === path) records.push(r);
      } catch {
        /* skip malformed */
      }
    }
    return records;
  } catch {
    return [];
  }
}

export function readEnvLockfile(hash: string): string {
  const dir = join(workspaceDir(), PROVENANCE_DIR, 'envs');
  const file = join(dir, `${hash}.txt`);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf-8');
}
