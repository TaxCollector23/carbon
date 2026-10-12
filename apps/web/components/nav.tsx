'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@carbon/ui';
import { Wordmark } from './logo';
import { dashboardSignInUrl, dashboardSignUpUrl } from '@/lib/urls';

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const signIn = dashboardSignInUrl('/');
  const signUp = dashboardSignUpUrl('/');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('carbon-v2-nav', scrolled && 'carbon-v2-nav-scrolled')}>
      <div className="carbon-v2-shell carbon-v2-nav-inner">
        <Link href="/#top" aria-label="Carbon home"><Wordmark /></Link>
        <nav className="carbon-v2-nav-links" aria-label="Main navigation">
          <Link href="#failure-modes">Failure modes</Link>
          <Link href="#workflow">Workflow</Link>
          <Link href="#cli">CLI</Link>
          <Link href="https://github.com/TaxCollector23/carbon" target="_blank" rel="noreferrer">GitHub ↗</Link>
        </nav>
        <div className="carbon-v2-nav-actions"><a href={signIn}>Sign in</a><a className="carbon-v2-nav-cta" href={signUp}>Start testing <span>↗</span></a></div>
      </div>
    </header>
  );
}
