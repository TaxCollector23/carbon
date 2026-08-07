'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';

const links = [
  { href: '/#workflow', label: 'Workflow' },
  { href: '/#comparison', label: 'Compare' },
  { href: '/#cli', label: 'CLI' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: 'https://github.com/TaxCollector23/carbon', label: 'GitHub' },
];

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
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center" aria-label="Carbon home">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="text-muted-foreground flex items-center gap-7 text-sm">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="hover:text-foreground focus-visible:text-foreground after:bg-foreground relative transition-colors after:absolute after:-bottom-1.5 after:left-0 after:h-px after:w-0 after:transition-all hover:after:w-full focus-visible:outline-none focus-visible:after:w-full"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/#sdk"
            className="text-muted-foreground hover:text-foreground hidden text-sm transition-colors md:inline-flex"
          >
            SDK
          </Link>
          <Link
            href="/dashboard"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'hidden md:inline-flex',
            )}
          >
            Enter Dashboard
          </Link>
          <Link href="/#cli" className={buttonVariants({ size: 'sm' })}>
            Install CLI
          </Link>
        </div>
      </div>
    </header>
  );
}
