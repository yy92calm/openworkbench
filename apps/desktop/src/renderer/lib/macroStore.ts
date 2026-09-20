// Renderer-side macro notification state: the unread count feeds the sidebar
// badge, the list feeds the page's bell menu. Events arrive from the main
// process (`macro-notification`), loaded lazily on first mount.

import type { MacroNotification } from '@workbench/shared';
import { create } from 'zustand';

import { macroNotifications, macroNotificationsRead } from './electron';

interface MacroState {
  items: MacroNotification[];
  unread: number;
  loaded: boolean;
  load: () => Promise<void>;
  add: (notification: MacroNotification) => void;
  markRead: (id?: string) => Promise<void>;
}

export const useMacroStore = create<MacroState>((set) => ({
  items: [],
  unread: 0,
  loaded: false,

  load: async () => {
    const r = await macroNotifications();
    set({ items: r.items, unread: r.unread, loaded: true });
  },

  add: (notification) =>
    set((s) => ({
      items: [notification, ...s.items].slice(0, 50),
      unread: s.unread + (notification.read ? 0 : 1),
    })),

  markRead: async (id) => {
    const r = await macroNotificationsRead(id);
    set({ items: r.items, unread: r.unread });
  },
}));
