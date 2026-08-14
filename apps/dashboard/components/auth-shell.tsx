import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared layout for /sign-in and /sign-up so the two pages stay visually
 * consistent — brand mark on the left, form on the right, and a "you got
 * here from the CLI" callout when appropriate.
 *
 * Sized generously (max-w-md, not max-w-sm) so the labels and buttons
 * actually breathe on a laptop screen instead of squishing.
 */
export function AuthShell({
  title,
  subtitle,
  fromCli,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  fromCli?: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Link
        href="/"
        className="text-foreground inline-flex items-center gap-2 self-start text-sm font-medium"
      >
        <span
          aria-hidden
          className="border-border bg-card grid size-6 place-items-center rounded-md border text-xs font-semibold"
        >
          C
        </span>
        <span>Carbon</span>
      </Link>

      <div className="bg-card border-border w-full rounded-xl border p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">{subtitle}</p>

        {fromCli ? (
          <div className="border-primary/30 bg-primary/5 mt-6 rounded-md border px-4 py-3 text-sm">
            <p className="text-foreground font-medium">Signing in from the CLI</p>
            <p className="text-muted-foreground mt-1 leading-6">
              Once you sign in here, the browser tab will ask you to approve the CLI. You can close
              the tab after that — the terminal picks up automatically.
            </p>
          </div>
        ) : null}

        <div className="mt-8">{children}</div>
      </div>

      <p className="text-muted-foreground text-center text-xs leading-5">{footer}</p>
    </main>
  );
}

/**
 * Shared field styles so every input on both pages matches without
 * copy-pasting the same set of border/focus classes into each label.
 */
export const inputClass =
  'border-border bg-background focus:ring-ring mt-2 block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2';

export function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
