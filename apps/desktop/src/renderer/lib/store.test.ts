import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from './store';

describe('uiStore theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ theme: 'light' });
  });

  it('toggles theme and persists to localStorage', () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('dark');
    expect(window.localStorage.getItem('workbench.theme')).toBe('dark');

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('light');
    expect(window.localStorage.getItem('workbench.theme')).toBe('light');
  });
});

describe('uiStore tabs — single session tab', () => {
  beforeEach(() => {
    useUiStore.setState({ tabs: [], activeTabId: null });
  });

  it('creates a session tab on first open', () => {
    useUiStore.getState().openSessionTab('ses_1', '会话一');
    const s = useUiStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: 'session', sessionId: 'ses_1', title: '会话一' });
    expect(s.activeTabId).toBe(s.tabs[0].id);
  });

  it('reuses the same session tab when switching sessions', () => {
    useUiStore.getState().openSessionTab('ses_1', '会话一');
    const firstId = useUiStore.getState().tabs[0].id;

    useUiStore.getState().openSessionTab('ses_2', '会话二');
    const s = useUiStore.getState();
    // Still only one session tab
    expect(s.tabs.filter((t) => t.kind === 'session')).toHaveLength(1);
    expect(s.tabs[0].id).toBe(firstId);
    expect(s.tabs[0]).toMatchObject({ kind: 'session', sessionId: 'ses_2', title: '会话二' });
    expect(s.activeTabId).toBe(firstId);
  });

  it('draft (null) converts into the real session on the same tab', () => {
    useUiStore.getState().openSessionTab(null, '新会话');
    const tabId = useUiStore.getState().tabs[0].id;

    useUiStore.getState().openSessionTab('ses_new', '实际会话');
    const s = useUiStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe(tabId);
    expect(s.tabs[0]).toMatchObject({ sessionId: 'ses_new', title: '实际会话' });
  });

  it('session tab is always first; file tabs follow', () => {
    useUiStore.getState().openSessionTab('ses_1', '会话');
    useUiStore.getState().openFileTab({
      kind: 'artifact',
      path: '/a/report.pdf',
      filename: 'report.pdf',
      artifact: 'report',
      tool: 'write',
    });
    const s = useUiStore.getState();
    expect(s.tabs[0].kind).toBe('session');
    expect(s.tabs[1].kind).toBe('file');
  });

  it('file tabs can be opened independently and closed', () => {
    useUiStore.getState().openSessionTab('ses_1', '会话');
    useUiStore.getState().openFileTab({
      kind: 'artifact',
      path: '/a/notes.md',
      filename: 'notes.md',
      artifact: 'code',
      tool: 'write',
    });
    const fileTabId = useUiStore.getState().tabs[1].id;
    expect(useUiStore.getState().tabs).toHaveLength(2);

    useUiStore.getState().closeTab(fileTabId);
    expect(useUiStore.getState().tabs).toHaveLength(1);
    expect(useUiStore.getState().tabs[0].kind).toBe('session');
  });

  it('openFileTab deduplicates by artifact path', () => {
    const artifact = {
      kind: 'artifact' as const,
      path: '/a/report.pdf',
      filename: 'report.pdf',
      artifact: 'report' as const,
      tool: 'write',
    };
    useUiStore.getState().openFileTab(artifact);
    useUiStore.getState().openFileTab(artifact);
    expect(useUiStore.getState().tabs.filter((t) => t.kind === 'file')).toHaveLength(1);
  });
});
