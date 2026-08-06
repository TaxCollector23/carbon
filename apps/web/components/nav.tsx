'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants, cn } from '@carbon/ui';
import { Wordmark } from './logo';

const links = [
  { href: '/docs', label: 'Docs' },
  { href: '/cli', label: 'CLI' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: 'https://github.com/carbon-dev/carbon', label: 'GitHub' },
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
          : 'border-transparent bg-background/0',
      )}
    >
      <div className="container flex h-full items-center justify-between">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center" aria-label="Carbon home">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-7 text-sm text-muted-foreground">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-foreground"
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
            href="/dashboard"
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
          >
            Dashboard
          </Link>
          <Link
            href="/signin"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden md:inline-flex')}
          >
            Sign in
          </Link>
          <Link href="/get-started" className={buttonVariants({ size: 'sm' })}>
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
