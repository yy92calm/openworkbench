import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Reset the rendered DOM between tests so queries don't leak across cases
// (@testing-library/react's auto-cleanup only runs under globals: true, which
// this config does not enable). Skipped in node-env tests (no DOM).
afterEach(() => {
  if (typeof window !== 'undefined') cleanup();
});

// DOM stubs - only in a browser-like (jsdom) environment. The node-env tests
// (e.g. the OpenCode integration test) skip these.
if (typeof window !== 'undefined') {
  // Some vitest/jsdom combinations expose `window.localStorage` as an empty
  // object whose Storage methods (getItem/setItem/...) are undefined, breaking
  // any module that reads localStorage at load time (e.g. store.ts' theme
  // init). Polyfill a working in-memory Storage when the native one is broken.
  const makeStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    };
  };
  const defineStorage = (prop: 'localStorage' | 'sessionStorage') => {
    const native = (window as unknown as Record<string, unknown>)[prop] as Storage | undefined;
    if (typeof native?.getItem !== 'function') {
      Object.defineProperty(window, prop, {
        value: makeStorage(),
        configurable: true,
        writable: true,
      });
    }
  };
  defineStorage('localStorage');
  defineStorage('sessionStorage');

  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // The Electron preload bridge does not exist in jsdom. AppShell-level tests
  // mount Sidebar (and other components) whose effects subscribe to IPC events
  // via window.electronAPI; without a stub they crash the render. Provide a
  // noop bridge: `on*` methods return an unsubscribe function, everything else
  // returns a resolved Promise. Tests that need to assert calls can replace a
  // method (the property is writable) or vi.spyOn the stub object.
  if (!window.electronAPI) {
    const stub = new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (typeof prop === 'string' && prop.startsWith('on')) {
          return () => () => {};
        }
        return async () => undefined;
      },
    });
    Object.defineProperty(window, 'electronAPI', {
      value: stub,
      configurable: true,
      writable: true,
    });
  }
}
