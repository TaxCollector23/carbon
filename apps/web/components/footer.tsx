import Link from 'next/link';
import { Wordmark } from './logo';

const columns = [
  {
    heading: 'Product',
    links: [
      ['Dashboard', '/dashboard'],
      ['Benchmarks', '/benchmarks'],
      ['Workflow', '/#workflow'],
      ['CLI', '/#cli'],
      ['SDK', '/#sdk'],
      ['Pricing', '/#pricing'],
      ['Inputs', '/#integrations'],
    ],
  },
  {
    heading: 'Community',
    links: [['GitHub', 'https://github.com/TaxCollector23/carbon']],
  },
] satisfies Array<{ heading: string; links: [string, string][] }>;

export function Footer() {
  return (
    <footer className="border-border bg-background border-t">
      <div className="container py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_3fr]">
          <div className="flex flex-col gap-4">
            <Wordmark />
            <p className="text-muted-foreground max-w-xs text-sm">
              Carbon compiles API specs and recorded traffic into stateful runtimes for development,
              tests, and CI.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8">
            {columns.map((col) => (
              <div key={col.heading}>
                <div className="text-2xs text-muted-foreground font-medium uppercase tracking-widest">
                  {col.heading}
                </div>
                <ul className="mt-4 flex flex-col gap-2.5 text-sm">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link
                        href={href}
                        className="text-foreground transition-opacity hover:opacity-70"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="border-border text-muted-foreground mt-14 flex flex-col items-start justify-between gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Carbon, Inc. All rights reserved.</span>
          <span className="font-mono">v0.1 private beta</span>
        </div>
      </div>
    </footer>
  );
}
