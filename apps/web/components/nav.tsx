'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

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
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Enter Dashboard
          </Link>
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
