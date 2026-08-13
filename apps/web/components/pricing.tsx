import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';
import { COMPARE_ROWS, TIERS } from '@/lib/plans';

/**
 * Landing-page pricing block. Three tiers rendered as cards, followed by a
 * feature-comparison table sourced from `apps/web/lib/plans.ts` so the docs
 * `plans.mdx` page and this component stay in visual lockstep.
 *
 * Tiers gate on the collaboration/scale axis — the free tier is deliberately
 * generous (full CLI + adapters + local snapshots + chaos) so the paid tiers
 * are the moment a team needs shared state, compliance, or scale rather than
 * an artificial capability wall.
 */
export function Pricing() {
  return (
    <Section id="pricing">
      <SectionHeading
        title="Free forever for solo devs. Paid the moment your team needs shared state."
        description="The CLI, all 8 adapters, local snapshots, and chaos stay free forever. Team and Enterprise add cloud sync, dashboard collaboration, compliance controls, and scale."
        align="center"
        className="mx-auto"
      />

      <div className="mx-auto mt-14 grid max-w-6xl gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <section
            key={tier.id}
            className={cn(
              'border-border bg-background flex flex-col rounded-lg border p-6 sm:p-8',
              tier.highlighted && 'bg-subtle/60 ring-foreground/10 shadow-sm ring-1',
            )}
          >
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-base font-medium">{tier.name}</h3>
                {tier.highlighted ? (
                  <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                    Most popular
                  </span>
                ) : null}
              </div>
              <div className="mt-5 flex flex-wrap items-baseline gap-1">
                <span className="text-3xl font-medium tracking-tight">{tier.price}</span>
                <span className="text-muted-foreground text-sm">{tier.period}</span>
              </div>
              <p className="text-muted-foreground mt-3 max-w-xs text-sm leading-6">
                {tier.tagline}
              </p>
            </div>
            <ul className="mt-6 grid gap-3 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="text-foreground mt-0.5 h-4 w-4 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link
                href={tier.cta.href}
                className={cn(
                  'inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition',
                  tier.highlighted
                    ? 'bg-foreground text-background hover:opacity-90'
                    : 'border-border text-foreground hover:bg-subtle border',
                )}
              >
                {tier.cta.label}
              </Link>
            </div>
          </section>
        ))}
      </div>

      <div className="mx-auto mt-20 max-w-6xl">
        <div className="mb-6 flex items-baseline justify-between">
          <h3 className="text-xl font-medium tracking-tight">Compare features</h3>
          <a
            href={(process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.carbon.dev') + '/plans'}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            Full breakdown in the docs →
          </a>
        </div>
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-subtle/50 text-muted-foreground text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Capability</th>
                <th className="px-4 py-3 font-medium">Free</th>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="border-border border-t align-top">
                  <td className="px-4 py-3">
                    {row.href ? (
                      <a
                        href={row.href}
                        className="text-foreground underline decoration-dotted underline-offset-4"
                      >
                        {row.label}
                      </a>
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{row.developer}</td>
                  <td className="text-muted-foreground px-4 py-3">{row.team}</td>
                  <td className="text-muted-foreground px-4 py-3">{row.enterprise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
