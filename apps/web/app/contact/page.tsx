import type { Metadata } from 'next';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Section, SectionHeading } from '@/components/section';
import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'Talk to us — Carbon Enterprise',
  description:
    'Get in touch about SSO, SCIM, self-hosted deployment, audit export, or an Enterprise pilot.',
};

export default function ContactPage() {
  return (
    <div className="bg-background text-foreground dark min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section id="contact" className="py-24">
          <div className="mx-auto grid max-w-5xl gap-16 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <SectionHeading
                title="Talk to us about Enterprise"
                description="Deployment, governance, and identity questions for teams past 10 seats. We reply within one business day."
              />
              <ul className="text-muted-foreground mt-8 space-y-3 text-sm">
                <li>• SSO (SAML, OIDC) and SCIM provisioning</li>
                <li>• Self-hosted control plane (VPC or on-prem)</li>
                <li>• Full audit export + SIEM webhook</li>
                <li>• Configurable / unlimited retention</li>
                <li>• Dedicated Slack + SLA</li>
                <li>• Bring-your-own LLM key for AI inference</li>
              </ul>
              <p className="text-muted-foreground mt-8 text-sm">
                Prefer email? Reach us at{' '}
                <a className="text-foreground underline" href="mailto:sales@carbon.dev">
                  sales@carbon.dev
                </a>
                .
              </p>
            </div>
            <ContactForm />
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
