import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://carbon-web-psi.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Carbon — stateful API replicas for development and CI',
    template: '%s · Carbon',
  },
  description:
    'Carbon compiles OpenAPI, AsyncAPI, protobuf, gRPC, HAR, Postman, and GraphQL into a stateful local runtime.',
  openGraph: {
    title: 'Carbon',
    description: 'Stateful API replicas for development, tests, and CI.',
    type: 'website',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Carbon',
    description: 'Stateful API replicas for development, tests, and CI.',
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(){try{var k='carbon-theme',s=localStorage.getItem(k),t=s==='light'?'light':'dark';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}}();`,
          }}
        />
      </head>
      <body className="font-sans">
        <a
          href="#main"
          className="focus:bg-foreground focus:text-background sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
