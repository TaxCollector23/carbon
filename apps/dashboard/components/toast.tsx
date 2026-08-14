'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@carbon/ui';

/**
 * Tiny in-app toast system. We don't ship a toast library; consumers call
 * `useToast().push({ kind, message })` and a stack renders in the corner.
 * Each toast auto-dismisses after `durationMs` (default 4000).
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
}

interface ToastContextValue {
  push(t: { kind: ToastKind; message: string; durationMs?: number }): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback no-op so calling outside the provider (e.g. in tests) doesn't
    // explode — but log so we catch misuse.
    if (typeof console !== 'undefined') {
      console.warn('useToast() called outside <ToastProvider> — messages will be dropped');
    }
    return { push: () => -1, dismiss: () => undefined };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({
      kind,
      message,
      durationMs = 4000,
    }: {
      kind: ToastKind;
      message: string;
      durationMs?: number;
    }) => {
      const id = ++idRef.current;
      setItems((cur) => [...cur, { id, kind, message, durationMs }]);
      if (durationMs > 0 && typeof window !== 'undefined') {
        window.setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, onDismiss }: { items: Toast[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      role="status"
    >
      {items.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const Icon =
    toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? XCircle : CheckCircle2;
  return (
    <div
      data-testid={`toast-${toast.kind}`}
      role="alert"
      className={cn(
        'pointer-events-auto flex max-w-md items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm transition-all duration-150',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        toast.kind === 'success'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : toast.kind === 'error'
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-border bg-background text-foreground',
      )}
      onClick={() => onDismiss(toast.id)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
    </div>
  );
}
