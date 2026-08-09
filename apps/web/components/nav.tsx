'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';

/**
 * Cross-app dashboard entry point.
 *
 * `NEXT_PUBLIC_DASHBOARD_URL` is baked at build time by Next.js. Fall
 * back to the local dev origin so `pnpm dev` works out of the box. The
 * `?next=/` param is honoured by apps/dashboard's /sign-in page.
 */
function dashboardSignInUrl(): string {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  const base = raw && raw.trim() !== '' ? raw.replace(/\/+$/, '') : 'http://localhost:3001';
  return `${base}/sign-in?next=/`;
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const dashUrl = dashboardSignInUrl();

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
          <Link href="/#cli" className={cn(buttonVariants({ size: 'sm' }))}>
            Install CLI
          </Link>
          <a
            href={dashUrl}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Enter Dashboard
          </a>
          <Link
            href="/#benchmarks"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Benchmarks
          </Link>
        </div>
      </div>
    </header>
  );
}
