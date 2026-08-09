'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';
import { ThemeToggle } from './theme-toggle';

/**
 * Marketing-site "Dashboard" route.
 *
 * The real product dashboard is a separate Next.js app at
 * `apps/dashboard`, which owns sign-in (Better Auth) and every workspace
 * view. This route used to gate access with Firebase and render a
 * static workspace, but Firebase has been removed and the marketing site
 * no longer holds any workspace state. All this component does now is
 * hand visitors off to the dashboard's sign-in page.
 *
 * Env: `NEXT_PUBLIC_DASHBOARD_URL` — defaults to `http://localhost:3001`
 * for local dev. In production this points at the deployed dashboard.
 */
export function DashboardRoute() {
  const [signInUrl, setSignInUrl] = useState<string>(defaultSignInUrl());

  useEffect(() => {
    // Read the env at mount so a build with `NEXT_PUBLIC_DASHBOARD_URL`
    // baked in wins over the fallback without touching SSR output shape.
    setSignInUrl(resolveSignInUrl());
  }, []);

  return (
    <div className="bg-background text-foreground min-h-dvh">
      <header className="border-border bg-background/90 flex h-16 items-center justify-between gap-4 border-b px-4 backdrop-blur sm:px-6">
        <Link href="/" aria-label="Carbon home">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="p-6 sm:p-8">
        <section className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-2xl items-center">
          <div className="border-border w-full border-y py-8">
            <div className="bg-muted grid h-11 w-11 place-items-center rounded-md">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h2 className="mt-6 text-2xl font-medium tracking-tight">
              The dashboard has moved
            </h2>
            <p className="text-muted-foreground mt-3 text-sm leading-6">
              Carbon&apos;s workspace lives in a dedicated dashboard app. Sign in there to see
              your projects, snapshots, emulators, and API keys.
            </p>
            <div className="mt-7">
              <a
                href={signInUrl}
                className={cn(
                  buttonVariants({ variant: 'primary', size: 'lg' }),
                  'w-full gap-3 sm:w-auto',
                )}
              >
                Continue to sign-in
              </a>
            </div>
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground mt-7 inline-flex text-sm"
            >
              Back to landing
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function defaultSignInUrl(): string {
  return 'http://localhost:3001/sign-in?next=/';
}

function resolveSignInUrl(): string {
  const base = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  if (!base || base.trim() === '') return defaultSignInUrl();
  return `${base.replace(/\/+$/, '')}/sign-in?next=/`;
}
