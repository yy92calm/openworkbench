// Interaction layer types: keyed renderer manifest + UI default preferences
// declared by the packager's `.opencode/interaction/` profile files.
// Browser-safe, shared by the main process (read via IPC) and renderer.

/** One renderer the packager enables. The actual rendering is a built-in React
 *  component in the app; the manifest only gates it on/off and carries options. */
export interface RendererManifest {
  /** Type key matching the `workbench:<type>` fence the agent emits. */
  type: string;
  /** Human label shown in the settings interaction panel. */
  title?: string;
  /** Passed through to the built-in renderer as its props. */
  options?: Record<string, unknown>;
}

/** Packager-supplied UI defaults. Renderer falls back to these before its own
 *  built-in defaults; the user's runtime settings (localStorage) still win. */
export interface UiDefaults {
  theme?: string;
  locale?: string;
  expandThreadDetails?: boolean;
}

/** Parsed result of the deployed interaction config. */
export interface InteractionConfig {
  renderers: RendererManifest[];
  ui: UiDefaults;
}

/** Parse a renderers.json file body; failures produce an empty list. */
export function parseRenderersJson(raw?: string): RendererManifest[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { renderers?: unknown };
    if (!Array.isArray(data.renderers)) return [];
    return data.renderers.filter(
      (r): r is RendererManifest =>
        !!r && typeof r === "object" && typeof (r as RendererManifest).type === "string",
    );
  } catch {
    return [];
  }
}

/** Parse a ui.json file body; invalid input yields an empty object. */
export function parseUiDefaultsJson(raw?: string): UiDefaults {
  if (!raw) return {};
  const ALLOWED = new Set(["theme", "locale", "expandThreadDetails"]);
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: UiDefaults = {};
    for (const key of Object.keys(data)) {
      if (!ALLOWED.has(key)) continue;
      const v = data[key];
      if (key === "theme" && typeof v === "string") out.theme = v;
      else if (key === "locale" && typeof v === "string") out.locale = v;
      else if (key === "expandThreadDetails" && typeof v === "boolean") out.expandThreadDetails = v;
    }
    return out;
  } catch {
    return {};
  }
}