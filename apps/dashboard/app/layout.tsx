import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Sidebar } from '@/components/sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Carbon Dashboard',
  description: 'Manage your Carbon projects, graphs, and snapshots.',
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
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
