import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://carbon.dev'),
  title: {
    default: 'Carbon — local API replicas that actually behave',
    template: '%s · Carbon',
  },
  description:
    'Carbon compiles OpenAPI, HAR, Postman, and GraphQL into a stateful local runtime. Deterministic, offline, no rate limits.',
  openGraph: {
    title: 'Carbon',
    description: 'Local API replicas that actually behave.',
    type: 'website',
    url: 'https://carbon.dev',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Carbon',
    description: 'Local API replicas that actually behave.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={
        {
          '--font-sans': 'var(--font-geist-sans)',
          '--font-mono': 'var(--font-geist-mono)',
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main" className="pt-16">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
