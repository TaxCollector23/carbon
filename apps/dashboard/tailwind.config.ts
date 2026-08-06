import type { Config } from 'tailwindcss';
import preset from '@carbon/config/tailwind';

export default {
  ...preset,
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
