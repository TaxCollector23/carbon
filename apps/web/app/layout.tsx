import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { siteUrl } from '@/lib/urls';
import { TrackDelegation } from '@/components/track-delegation';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'Carbon — reliability testing for the cases you missed',
    template: '%s · Carbon',
  },
  description:
    'Carbon turns production-shaped failure modes into deterministic, inspectable tests for stateful apps and AI-generated code.',
  openGraph: {
    title: 'Carbon',
    description: 'Deterministic reliability testing for stateful apps.',
    type: 'website',
    url: '/',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Carbon',
    description: 'Stateful API replicas for development, tests, and CI.',
    images: ['/opengraph-image'],
  },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Carbon',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux, Windows',
      description:
        'Carbon turns production-shaped failure modes into deterministic, inspectable tests for stateful apps and AI-generated code.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      url: siteUrl(),
    },
    {
      '@type': 'WebSite',
      name: 'Carbon',
      url: siteUrl(),
    },
  ],
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(){try{var k='carbon-theme',s=localStorage.getItem(k),t=s==='light'?'light':'dark';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}}();`,
          }}
        />
      </head>
      <body className="font-sans">
        <TrackDelegation />
        <a
          href="#main"
          className="focus:bg-foreground focus:text-background sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </body>
    </html>
  );
}
