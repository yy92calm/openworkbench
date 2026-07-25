import { useEffect, useState } from "react";
import { listDir } from "./artifactFile";

/**
 * Files at the workspace root, lazily loaded once for `@` mention candidates.
 * Non-recursive (root only) to keep the candidate list short; subdirectory
 * files aren't surfaced as mentions. Fails silently to an empty list when the
 * desktop workspace isn't available — callers fall back to artifact-derived paths.
 */
export function useWorkspaceFiles(): { files: string[]; loading: boolean } {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listDir("", "base")
      .then((entries) => {
        if (cancelled) return;
        setFiles(entries.filter((e) => !e.isDir).map((e) => e.name));
      })
      .catch(() => {
        // Desktop workspace unavailable — stay empty, callers fall back.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { files, loading };
}
