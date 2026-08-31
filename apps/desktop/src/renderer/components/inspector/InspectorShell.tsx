import type { FilePreviewInspector as FilePreviewInspectorT, Inspector } from '@workbench/shared';

import { ArtifactInspector } from './ArtifactInspector';
import { FilePreviewInspector } from './FilePreviewInspector';
import { NotebookInspector } from './NotebookInspector';
import { PdfInspector } from './PdfInspector';

/** Derive a FilePreviewInspector-compatible object from a NotebookFileInspector. */
function notebookFileToPreview(
  inspector: Extract<Inspector, { variant: 'notebook-file' }>,
): FilePreviewInspectorT {
  const filename = inspector.path.split(/[\\/]/).pop() ?? inspector.path;
  return {
    variant: 'file',
    path: inspector.path,
    root: inspector.root,
    filename,
    artifact: 'code',
    language: 'json',
  };
}

/** Right pane. Renders the correct inspector variant for the active session. */
export function InspectorShell({
  inspector,
  onClose,
  onEvaluate,
}: {
  inspector: Inspector;
  onClose: () => void;
  /** Forward notebook expressions to the agent's live kernel (live session only). */
  onEvaluate?: (expr: string) => void;
}) {
  return (
    <div className="h-full border-l border-border bg-surface" data-variant={inspector.variant}>
      {inspector.variant === 'artifact' && <ArtifactInspector data={inspector} onClose={onClose} />}
      {inspector.variant === 'notebook' && (
        <NotebookInspector data={inspector} onClose={onClose} onEvaluate={onEvaluate} />
      )}
      {inspector.variant === 'pdf' && <PdfInspector data={inspector} onClose={onClose} />}
      {inspector.variant === 'file' && <FilePreviewInspector data={inspector} onClose={onClose} />}
      {inspector.variant === 'notebook-file' && (
        <FilePreviewInspector data={notebookFileToPreview(inspector)} onClose={onClose} />
      )}
    </div>
  );
}
