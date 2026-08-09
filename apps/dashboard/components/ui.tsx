'use client';

import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Button, cn } from '@carbon/ui';

/**
 * Small internal UI kit shared by the section pages. Nothing here is
 * exhaustive — just the pieces we need until we build (or import) a real
 * primitive library.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-muted/40 animate-pulse rounded-md', className)} />;
}

export function ErrorBanner({
  error,
  onRetry,
}: {
  error: Error | string;
  onRetry?: () => void;
}) {
  const message = typeof error === 'string' ? error : error.message;
  // ApiError carries an optional docs URL served by the API; if present we
  // show a "Learn more" link so operators can jump straight to the runbook
  // rather than pasting the code into search.
  const help =
    typeof error === 'object' && error !== null && 'help' in error
      ? ((error as { help?: unknown }).help as string | undefined)
      : undefined;
  return (
    <div className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-3 rounded-md border px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">Something went wrong</p>
        <p className="text-destructive/80 mt-1 text-xs leading-5">{message}</p>
        {help ? (
          <p className="mt-1 text-xs leading-5">
            <a
              href={help}
              target="_blank"
              rel="noreferrer"
              className="text-destructive/80 hover:text-destructive underline underline-offset-2"
            >
              Learn more →
            </a>
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingRow({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}...
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  badge,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  badge?: string;
}) {
  return (
    <div className="border-border rounded-md border border-dashed px-6 py-10 text-center">
      {badge ? (
        <span className="border-border text-muted-foreground mb-3 inline-block rounded-full border px-2 py-0.5 text-xs">
          {badge}
        </span>
      ) : null}
      <h3 className="text-base font-medium">{title}</h3>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-6">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 py-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-background border-border w-full max-w-lg rounded-lg border shadow-lg"
      >
        <div className="border-border flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-medium tracking-tight">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground -mr-1 grid h-8 w-8 place-items-center rounded-md"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer ? <div className="border-border flex justify-end gap-2 border-t px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="border-border overflow-hidden rounded-md border">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'text-muted-foreground bg-muted/30 border-border border-b px-4 py-2 text-left text-xs font-medium uppercase tracking-wide',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cn('border-border border-b px-4 py-2 align-middle last:border-b-0', className)}>
      {children}
    </td>
  );
}
