import type { FileRoot } from '@workbench/shared';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  result: string | null;
  error: string | null;
}

export type KernelLanguage = 'python' | 'r';

export function isCodeLanguage(lang: string): lang is KernelLanguage {
  return lang === 'python' || lang === 'r';
}

function electronAPI() {
  if (typeof window === 'undefined' || !window.electronAPI)
    throw new Error('not running in the desktop app');
  return window.electronAPI;
}

export async function kernelExecute(
  code: string,
  language: KernelLanguage = 'python',
  notebook?: string,
  _root?: FileRoot,
): Promise<ExecResult | null> {
  try {
    const result = await electronAPI().kernelExecute(code, language, notebook);
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout,
      result: result.exitCode === 0 ? result.stdout : null,
      error: result.stderr || null,
    };
  } catch {
    return null;
  }
}

export async function kernelReset(
  language?: KernelLanguage,
  notebook?: string,
  _root?: FileRoot,
): Promise<void> {
  try {
    await electronAPI().kernelReset(language, notebook);
  } catch {
    /* kernel reset must never fail */
  }
}

export function formatExecResult(r: ExecResult): string {
  if (!r.ok && r.error) return r.error.trimEnd();
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout.trimEnd());
  if (r.result !== null) parts.push(r.result);
  return parts.join('\n') || '(no output)';
}
