/**
 * Hosts one agent-created A2UI surface inside the thread.
 *
 * The Lit renderer element is created imperatively (a custom element, not a
 * React component) and mounted into a plain div — React 18 never sees its
 * internals, and the surface updates itself via its own signal subscriptions
 * as later parts update it, without re-rendering React.
 */

import { A2uiSurface, Context } from '@a2ui/lit/v0_9';
import { renderMarkdown } from '@a2ui/markdown-it';
import { ContextProvider } from '@lit/context';
import { useEffect, useRef } from 'react';

import type { A2uiSurfaceModel } from '@/lib/a2ui/engine';

export function A2uiSurfaceCard({ surface }: { surface: A2uiSurfaceModel }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = new A2uiSurface();
    // The basic catalog's Text component renders markdown through this
    // service; without it the element degrades to plain text with a warning.
    new ContextProvider(el, Context.markdown, renderMarkdown);
    el.surface = surface;
    hostRef.current?.appendChild(el);
    return () => {
      el.remove();
    };
  }, [surface]);

  return (
    <div
      ref={hostRef}
      className="overflow-x-auto rounded-xl border border-border-soft bg-surface/40 p-2.5"
    />
  );
}
