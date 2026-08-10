'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';

/**
 * Cross-app dashboard entry points.
 *
 * `NEXT_PUBLIC_DASHBOARD_URL` is baked at build time by Next.js. Fall back to
 * the local dev origin so `pnpm dev` works out of the box. The `?next=/`
 * param is honoured by apps/dashboard's /sign-in and /sign-up pages.
 */
function dashboardUrl(): string {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  return raw && raw.trim() !== '' ? raw.replace(/\/+$/, '') : 'http://localhost:3001';
}

function dashboardSignInUrl(): string {
  return `${dashboardUrl()}/sign-in?next=/`;
}

function dashboardSignUpUrl(): string {
  return `${dashboardUrl()}/sign-up?next=/`;
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const signIn = dashboardSignInUrl();
  const signUp = dashboardSignUpUrl();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 h-16 border-b transition-colors duration-200',
        scrolled
          ? 'border-border bg-background/80 backdrop-blur-md'
          : 'bg-background/0 border-transparent',
      )}
    >
      <div className="container flex h-full items-center justify-between">
        <Link href="/#top" className="flex items-center" aria-label="Carbon home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/#pricing"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
          >
            Pricing
          </Link>
          <Link
            href="/contact"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
          >
            Talk to us
          </Link>
          <a
            href={signIn}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Sign in
          </a>
          <a
            href={signUp}
            className={cn(buttonVariants({ size: 'sm' }))}
          >
            Sign up
          </a>
        </div>
      </div>
    </header>
  );
}
