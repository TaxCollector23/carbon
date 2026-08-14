import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@carbon/ui/cn';
import { Section, SectionHeading } from './section';
import { COMPARE_ROWS, TIERS, docsUrl } from '@/lib/plans';

/**
 * Landing-page pricing block. Three tiers rendered as cards, followed by a
 * feature-comparison table sourced from `apps/web/lib/plans.ts` so the docs
 * `plans.mdx` page and this component stay in visual lockstep.
 *
 * Tiers now gate on the anxiety curve, not org size. Free is the full local
 * runtime forever. Pro hooks on *drift detection* — the day-two solo-dev
 * anxiety of "does my mock still match reality?". Team / Business is the
 * subsequent team-lead purchase for shared state + SSO + audit. Enterprise
 * adds self-host and regulated-scale controls.
 */
export function Pricing() {
  return (
    <Section id="pricing">
      <SectionHeading
        title="Free forever for solo devs. Paid the moment your emulator risks going stale."
        description="The CLI, all 8 adapters, local snapshots, and chaos stay free forever. Pro adds drift detection so your captured traffic keeps matching production. Team and Enterprise layer shared state and compliance on top."
        align="center"
        className="mx-auto"
      />

      <div className="border-border mx-auto mt-14 grid max-w-4xl border-y">
        {TIERS.map((tier, idx) => (
          <section
            key={tier.id}
            className={cn(
              'border-border grid gap-6 py-7 md:grid-cols-[0.72fr_1fr_auto] md:items-start',
              idx > 0 && 'border-t',
              tier.highlighted && 'bg-subtle/30 px-5 md:-mx-5 md:px-5',
            )}
          >
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-base font-medium">{tier.name}</h3>
                {tier.highlighted ? (
                  <span className="text-2xs text-muted-foreground border-border border px-1.5 py-0.5 uppercase tracking-widest">
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
            <ul className="grid gap-3 text-sm">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="text-foreground mt-0.5 h-4 w-4 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="md:min-w-36">
              <Link
                href={tier.cta.href}
                className={cn(
                  'focus-visible:ring-ring focus-visible:ring-offset-background inline-flex w-full items-center justify-center px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
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
            href={docsUrl('/plans')}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            Full breakdown in the docs
          </a>
        </div>
        <div className="border-border overflow-x-auto border-y">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="text-muted-foreground border-border border-b text-left text-xs uppercase tracking-widest">
              <tr>
                <th className="px-4 py-3 font-medium">Capability</th>
                <th className="px-4 py-3 font-medium">Free</th>
                <th className="px-4 py-3 font-medium">Pro</th>
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
                  <td className="text-muted-foreground px-4 py-3">{row.pro}</td>
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
