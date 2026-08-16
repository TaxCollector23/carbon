'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';
import { dashboardSignInUrl, dashboardSignUpUrl } from '@/lib/urls';

/**
 * Cross-app dashboard entry points.
 *
 * `NEXT_PUBLIC_DASHBOARD_URL` is baked at build time by Next.js. The `?next=/`
 * param is honoured by apps/dashboard's /sign-in and /sign-up pages.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const signIn = dashboardSignInUrl('/');
  const signUp = dashboardSignUpUrl('/');

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
            href="/vs/msw"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Compare
          </Link>
          <a
            href="https://taxcollector23.github.io/carbon/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Docs
          </a>
          <Link
            href="/try"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Try it
          </Link>
          <Link
            href="/emulators"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Emulators
          </Link>
          <Link
            href="/changelog"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden lg:inline-flex',
            )}
          >
            Changelog
          </Link>
          <Link
            href="/#download"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Download
          </Link>
          <Link
            href="/#pricing"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Pricing
          </Link>
          <Link
            href="/enterprise"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Enterprise
          </Link>
          <Link
            href="/contact"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden sm:inline-flex',
            )}
          >
            Talk to us
          </Link>
          <a href={signIn} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            Sign in
          </a>
          <a href={signUp} className={cn(buttonVariants({ size: 'sm' }))}>
            Sign up
          </a>
        </div>
      </div>
    </header>
  );
}
