import { defineCommand } from 'citty';
import open from 'open';
import { ui } from '../ui.js';

const DEFAULT_TRY_URL = 'https://carbon-web-psi.vercel.app/try';
const SAMPLES = new Set(['petstore', 'stripe', 'github', 'shopify', 'openai', 'twilio']);

export const tryCommand = defineCommand({
  meta: {
    name: 'try',
    description: 'Open the no-auth stateful API playground in your browser.',
  },
  args: {
    sample: {
      type: 'string',
      description: 'Sample deep link to open (petstore, stripe, github, shopify, openai, twilio).',
      default: 'petstore',
    },
    url: {
      type: 'string',
      description: 'Override the playground URL (useful for local web development).',
    },
    open: {
      type: 'boolean',
      description: 'Launch the URL in the default browser.',
      default: true,
    },
  },
  async run({ args }) {
    const sample = String(args.sample ?? 'petstore')
      .trim()
      .toLowerCase();
    if (!SAMPLES.has(sample)) {
      ui.error(`Unknown sample '${sample}'. Choose one of: ${[...SAMPLES].join(', ')}.`);
      process.exitCode = 1;
      return;
    }

    const base = String(args.url ?? process.env.CARBON_TRY_URL ?? DEFAULT_TRY_URL).replace(
      /\/+$/,
      '',
    );
    const url = `${base}?sample=${encodeURIComponent(sample)}`;
    ui.success(`Try Carbon at ${ui.code(url)}`);

    if (args.open !== false) {
      try {
        await open(url);
        ui.step('Browser', 'opened the Carbon playground');
      } catch (err) {
        ui.warn(`Could not open a browser automatically: ${(err as Error).message}`);
        ui.step('Next', `open ${ui.code(url)} manually`);
      }
    }
  },
});
