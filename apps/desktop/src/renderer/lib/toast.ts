import { create } from 'zustand';

export interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
  /** Optional click action (e.g. jump to the session a notification refers to). */
  onClick?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: Toast['tone'], message: string, onClick?: () => void) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const TOAST_MS = 3500;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message, onClick) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, tone, message, onClick }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (message: string, onClick?: () => void) =>
    useToastStore.getState().push('success', message, onClick),
  error: (message: string, onClick?: () => void) =>
    useToastStore.getState().push('error', message, onClick),
};
