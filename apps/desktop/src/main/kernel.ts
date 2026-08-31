import { ChildProcess, spawn } from 'node:child_process';

import { workspaceDir } from './server';
import { enrichedPath } from './shell_env';

interface KernelEntry {
  child: ChildProcess;
  language: string;
}

const kernelMap = new Map<string, KernelEntry>();

function kernelKey(lang: string, notebook?: string): string {
  return `${lang}:${notebook ?? 'default'}`;
}

export function kernelExecute(
  code: string,
  language: string,
  notebook?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const key = kernelKey(language, notebook);
    let entry = kernelMap.get(key);

    if (!entry) {
      const cmd = language === 'python3' ? 'python3' : language;
      const child = spawn(cmd, ['-c', code], {
        env: { ...process.env, PATH: enrichedPath(), HOME: process.env.HOME ?? '' },
        cwd: workspaceDir(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      entry = { child, language };
      kernelMap.set(key, entry);
    }

    const { child } = entry;
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('exit', (code) => {
      kernelMap.delete(key);
      resolve({ stdout, stderr, exitCode: code });
    });
    child.on('error', reject);
    child.stdin!.write(code);
    child.stdin!.end();
  });
}

export function kernelReset(language: string, notebook?: string): void {
  const key = kernelKey(language, notebook);
  const entry = kernelMap.get(key);
  if (entry) {
    entry.child.kill();
    kernelMap.delete(key);
  }
}

export function killAllKernels(): void {
  for (const [key, entry] of kernelMap) {
    entry.child.kill();
    kernelMap.delete(key);
  }
}
