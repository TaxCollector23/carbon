import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  // Project site on GitHub Pages.
  site: 'https://taxcollector23.github.io',
  base: '/carbon',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Carbon Docs',
      description: 'Stateful API replicas for development, tests, and CI.',
      logo: {
        light: './public/logo/light.svg',
        dark: './public/logo/dark.svg',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      editLink: {
        baseUrl: 'https://github.com/TaxCollector23/carbon/edit/master/apps/docs/',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/TaxCollector23/carbon' },
      ],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
      ],
      sidebar: [
        {
          label: 'Get started',
          items: [
            { label: 'Carbon', link: '/' },
            { label: 'Welcome', link: '/introduction/' },
            { label: 'Quickstart', link: '/quickstart/' },
            { label: 'Installation', link: '/installation/' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Spec to runtime', link: '/concepts/spec-to-runtime/' },
            { label: 'State engine', link: '/concepts/state-engine/' },
            { label: 'AI inference', link: '/concepts/ai-inference/' },
            { label: 'Chaos', link: '/concepts/chaos/' },
            { label: 'Architecture', link: '/concepts/architecture/' },
            { label: 'Behavior engine', link: '/concepts/behavior-engine/' },
            { label: 'Parser', link: '/concepts/parser/' },
          ],
        },
        {
          label: 'CLI reference',
          items: [
            { label: 'Reference', link: '/cli/reference/' },
            { label: 'Overview', link: '/cli/overview/' },
            { label: 'Init', link: '/cli/init/' },
            { label: 'Record', link: '/cli/record/' },
            { label: 'Emulate', link: '/cli/emulate/' },
            { label: 'Snapshot', link: '/cli/snapshot/' },
          ],
        },
        {
          label: 'Deployment',
          items: [
            { label: 'Fly.io', link: '/deployment/fly-io/' },
            { label: 'Self-hosted', link: '/deployment/self-hosted/' },
            { label: 'Prometheus', link: '/deployment/prometheus/' },
          ],
        },
        {
          label: 'Enterprise',
          items: [
            { label: 'Plans', link: '/plans/' },
            { label: 'SSO', link: '/enterprise/sso/' },
            { label: 'SCIM', link: '/enterprise/scim/' },
            { label: 'Slack', link: '/enterprise/slack/' },
            { label: 'Compliance export', link: '/security/compliance-export/' },
            { label: 'Secret scanning', link: '/security/secret-scanning/' },
          ],
        },
        {
          label: 'API',
          items: [{ label: 'Overview', link: '/api/overview/' }],
        },
        {
          label: 'SDK',
          items: [
            { label: 'Overview', link: '/sdk/overview/' },
            { label: 'Emulate', link: '/sdk/emulate/' },
            { label: 'State', link: '/sdk/state/' },
            { label: 'Snapshots', link: '/sdk/snapshots/' },
            { label: 'Generated client', link: '/sdk/generated/' },
            { label: 'Python', link: '/sdk/python/' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Testing', link: '/guides/testing/' },
            { label: 'CI', link: '/guides/ci/' },
            { label: 'Deployment', link: '/guides/deployment/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Config', link: '/reference/config/' },
            { label: 'FAQ', link: '/reference/faq/' },
            { label: 'Contributing', link: '/reference/contributing/' },
            { label: 'Style guide', link: '/reference/style-guide/' },
          ],
        },
      ],
    }),
  ],
});
