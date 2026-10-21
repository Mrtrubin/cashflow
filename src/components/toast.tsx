"use client";

import { useEffect, useState } from "react";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface ToastItem {
  id: number;
  message: string;
  action?: ToastAction;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function showToast(
  message: string,
  action?: ToastAction,
  durationMs = 5000,
): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, action }];
  emit();
  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** 保存/删除后的提示条（含撤销按钮），挂在根布局 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex w-full max-w-[480px] flex-col gap-2 px-4"
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center justify-between gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="shrink-0 font-semibold text-background underline underline-offset-2"
              onClick={() => {
                void toast.action?.run();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
