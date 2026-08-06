import Link from 'next/link';
import { Wordmark } from './logo';

const columns = [
  {
    heading: 'Product',
    links: [
      ['Docs', '/docs'],
      ['CLI', '/cli'],
      ['SDK', '/sdk'],
      ['Pricing', '/pricing'],
      ['Changelog', '/changelog'],
    ],
  },
  {
    heading: 'Company',
    links: [
      ['Blog', '/blog'],
      ['Careers', '/careers'],
      ['Contact', '/contact'],
      ['Security', '/security'],
    ],
  },
  {
    heading: 'Community',
    links: [
      ['GitHub', 'https://github.com/carbon-dev/carbon'],
      ['Discord', 'https://discord.gg/carbon'],
      ['Twitter', 'https://twitter.com/carbondev'],
    ],
  },
  {
    heading: 'Legal',
    links: [
      ['Terms', '/legal/terms'],
      ['Privacy', '/legal/privacy'],
      ['DPA', '/legal/dpa'],
    ],
  },
] satisfies Array<{ heading: string; links: [string, string][] }>;

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_3fr]">
          <div className="flex flex-col gap-4">
            <Wordmark />
            <p className="max-w-xs text-sm text-muted-foreground">
              The closest thing to production. Carbon compiles APIs into local, deterministic runtimes.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {columns.map((col) => (
              <div key={col.heading}>
                <div className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
                  {col.heading}
                </div>
                <ul className="mt-4 flex flex-col gap-2.5 text-sm">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-foreground transition-opacity hover:opacity-70">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Carbon, Inc. All rights reserved.</span>
          <span className="font-mono">v0.1 · Built with intent.</span>
        </div>
      </div>
    </footer>
  );
}
