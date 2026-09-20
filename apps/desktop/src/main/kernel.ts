import { ChildProcess, spawn } from 'node:child_process';

import { getLogger } from './logging';
import { wrapSpawn } from './sandbox/manager';
import { effectiveSandboxConfig, sandboxPathsFor, workspaceDir } from './server';
import { enrichedPath } from './shell_env';

interface KernelEntry {
  child: ChildProcess;
  language: string;
}

const kernelMap = new Map<string, KernelEntry>();

function kernelKey(lang: string, notebook?: string): string {
  return `${lang}:${notebook ?? 'default'}`;
}

export async function kernelExecute(
  code: string,
  language: string,
  notebook?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const key = kernelKey(language, notebook);
  let entry = kernelMap.get(key);

  if (!entry) {
    const cmd = language === 'python3' ? 'python3' : language;
    const cwd = workspaceDir();
    let file = cmd;
    let args: string[] = ['-c', code];
    try {
      const wrapped = await wrapSpawn(
        { file: cmd, args, cwd },
        { config: effectiveSandboxConfig(), paths: sandboxPathsFor(cwd) },
      );
      file = wrapped.file;
      args = wrapped.args;
      if (!wrapped.wrapped) {
        getLogger().warn(`[kernel] ${wrapped.detail} — kernel runs unsandboxed`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      getLogger().error(`[kernel] sandbox required but unavailable: ${msg}`);
      throw err;
    }
    const child = spawn(file, args, {
      env: { ...process.env, PATH: enrichedPath(), HOME: process.env.HOME ?? '' },
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    entry = { child, language };
    kernelMap.set(key, entry);
  }

  return new Promise((resolve, reject) => {
    const { child } = entry!;
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('exit', (exitCode) => {
      kernelMap.delete(key);
      resolve({ stdout, stderr, exitCode });
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
