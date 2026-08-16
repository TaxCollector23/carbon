import Link from 'next/link';
import { dashboardSignInUrl } from '@/lib/urls';
import { Wordmark } from './logo';

export function Footer() {
  const columns = [
    {
      heading: 'Product',
      links: [
        ['Dashboard', dashboardSignInUrl('/')],
        ['Benchmarks', '/benchmarks'],
        ['Workflow', '/#workflow'],
        ['CLI', '/#cli'],
        ['Download', '/#download'],
        ['Try it', '/try'],
        ['Emulators', '/emulators'],
        ['Pricing', '/#pricing'],
        ['Enterprise', '/enterprise'],
        ['Talk to us', '/contact'],
      ],
    },
    {
      heading: 'Resources',
      links: [
        ['Documentation', 'https://taxcollector23.github.io/carbon/'],
        ['Quickstart', 'https://taxcollector23.github.io/carbon/quickstart/'],
        ['CLI reference', 'https://taxcollector23.github.io/carbon/cli/reference/'],
        ['GitHub', 'https://github.com/TaxCollector23/carbon'],
        ['Releases', 'https://github.com/TaxCollector23/carbon/releases'],
      ],
    },
  ] satisfies Array<{ heading: string; links: [string, string][] }>;

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
                        className="text-muted-foreground hover:text-foreground transition-colors"
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
          <span>© {new Date().getFullYear()} Carbon. All rights reserved.</span>
          <span className="font-mono">v0.1 private beta</span>
        </div>
      </div>
    </footer>
  );
}
