import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://carbon.dev'),
  title: {
    default: 'Carbon — Develop against production without production',
    template: '%s · Carbon',
  },
  description:
    'Carbon creates intelligent local replicas of production APIs. Record real traffic, learn behavior, emulate on your machine. Build offline. Avoid staging. Ship faster.',
  openGraph: {
    title: 'Carbon',
    description: 'Develop against production without production.',
    type: 'website',
    url: 'https://carbon.dev',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Carbon',
    description: 'Develop against production without production.',
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
        <Nav />
        <main className="pt-16">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
