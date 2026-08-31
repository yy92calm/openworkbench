import type { FileRoot } from '@workbench/shared';

export type { FileRoot };

export interface ArtifactFile {
  path: string;
  mime: string;
  encoding: 'utf8' | 'base64';
  data: string;
  size: number;
}

export interface NotebookEntry {
  path: string;
  modified: number;
}

export interface DirEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

function electronAPI() {
  if (typeof window === 'undefined' || !window.electronAPI)
    throw new Error('not running in the desktop app');
  return window.electronAPI;
}

export async function readArtifact(path: string, root?: FileRoot): Promise<ArtifactFile | null> {
  try {
    const result = await electronAPI().readArtifact(path, root);
    if (!result) return null;
    return {
      path,
      mime: result.binary ? 'application/octet-stream' : 'text/plain',
      encoding: result.binary ? 'base64' : 'utf8',
      data: result.content,
      size: result.content.length,
    };
  } catch {
    return null;
  }
}

export async function previewUrl(path: string, root?: FileRoot): Promise<string | null> {
  try {
    return await electronAPI().previewUrl(path, root);
  } catch {
    return null;
  }
}

export async function resolveArtifactPath(path: string): Promise<string | null> {
  try {
    return await electronAPI().resolveArtifact(path);
  } catch {
    return path;
  }
}

export async function openArtifactExternally(path: string, root?: FileRoot): Promise<void> {
  try {
    await electronAPI().openPath(path, root);
  } catch {
    /* noop */
  }
}

export async function listNotebooks(root?: FileRoot): Promise<NotebookEntry[]> {
  try {
    const entries = await electronAPI().listNotebooks(root);
    return entries.map((e) => ({ path: e.path, modified: new Date(e.modified).getTime() / 1000 }));
  } catch {
    return [];
  }
}

export async function listDir(rel: string, root?: FileRoot): Promise<DirEntry[]> {
  try {
    const entries = await electronAPI().listDir(rel, root);
    return entries.map((e) => ({
      path: e.name,
      name: e.name,
      isDir: e.is_dir,
      size: e.size,
      modified: 0,
    }));
  } catch {
    return [];
  }
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
  root?: FileRoot,
): Promise<void> {
  try {
    await electronAPI().writeWorkspaceFile(path, content, root);
  } catch {
    throw new Error('not running in the desktop app');
  }
}

export function toDataUrl(f: ArtifactFile): string {
  if (f.encoding === 'base64') return `data:${f.mime};base64,${f.data}`;
  return `data:${f.mime};charset=utf-8,${encodeURIComponent(f.data)}`;
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
