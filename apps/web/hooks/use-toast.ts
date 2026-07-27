import * as React from "react";
import { create } from "zustand";

const TOAST_REMOVE_DELAY = 5000;

export type ToastVariant = "default" | "destructive";

export interface ToastData {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

type ToastState = ToastData & { open: boolean };

interface ToastStore {
  toasts: ToastState[];
  addToast: (toast: Omit<ToastData, "id">) => string;
  updateToast: (id: string, toast: Partial<ToastData>) => void;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
}

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string, duration: number) => {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    useToastStore.getState().removeToast(toastId);
  }, duration + 300);
  toastTimeouts.set(toastId, timeout);
};

const clearDismissTimeout = (toastId: string) => {
  const timeout = toastTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(toastId);
  }
};

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = genId();
    const duration = toast.duration ?? TOAST_REMOVE_DELAY;
    const newToast: ToastState = { ...toast, id, open: true };
    set((state) => ({ toasts: [newToast, ...state.toasts] }));
    addToRemoveQueue(id, duration);
    return id;
  },

  updateToast: (id, toast) => {
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...toast } : t)),
    }));
  },

  dismissToast: (id) => {
    clearDismissTimeout(id);
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, open: false } : t)),
    }));
    setTimeout(() => {
      get().removeToast(id);
    }, 300);
  },

  removeToast: (id) => {
    clearDismissTimeout(id);
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export function toast(props: Omit<ToastData, "id">) {
  const id = useToastStore.getState().addToast(props);
  return {
    id,
    dismiss: () => useToastStore.getState().dismissToast(id),
    update: (props: Partial<ToastData>) => useToastStore.getState().updateToast(id, props),
  };
}

export function dismiss(toastId?: string) {
  const { toasts, dismissToast } = useToastStore.getState();
  if (toastId) {
    dismissToast(toastId);
  } else {
    toasts.forEach((t) => dismissToast(t.id));
  }
}

export function useToast() {
  const toasts = useToastStore((state) => state.toasts);
  return {
    toasts,
    toast,
    dismiss,
  };
}
