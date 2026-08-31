import type { ArtifactContent } from '@workbench/sdk';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getHostClient } from '@/lib/connection';

interface Props {
  path: string;
  root?: string;
  onBack: () => void;
}

const TEXT_EXT = new Set([
  'md',
  'txt',
  'json',
  'ts',
  'js',
  'tsx',
  'jsx',
  'py',
  'go',
  'rs',
  'sh',
  'yml',
  'yaml',
  'toml',
  'csv',
  'tsv',
  'html',
  'css',
  'xml',
  'log',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function FilePreviewPage({ path, root, onBack }: Props) {
  const [artifact, setArtifact] = useState<ArtifactContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const result = await getHostClient().readArtifact(path, root);
        setArtifact(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [path, root]);

  const name = path.split('/').pop() ?? path;
  const ext = extOf(path);

  return (
    <div className="page">
      <header className="page-header">
        <button onClick={onBack} className="icon-btn" aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <h1 className="page-title">{name}</h1>
      </header>

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="page-empty">加载中…</div>
      ) : !artifact ? (
        <div className="page-empty">文件不存在或无法读取</div>
      ) : artifact.binary && !IMAGE_EXT.has(ext) ? (
        <div className="page-empty">该文件类型暂不支持预览</div>
      ) : IMAGE_EXT.has(ext) ? (
        <div className="file-preview-image">
          {/* The host returns base64 content for binary files; render as data URL. */}
          <img src={`data:image/${ext};base64,${artifact.content}`} alt={name} />
        </div>
      ) : TEXT_EXT.has(ext) || !artifact.binary ? (
        <pre className="file-preview-text mono">{artifact.content}</pre>
      ) : (
        <div className="page-empty">该文件类型暂不支持预览</div>
      )}
    </div>
  );
}
