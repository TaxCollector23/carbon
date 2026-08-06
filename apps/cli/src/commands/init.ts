import { defineCommand } from 'citty';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '../ui.js';

const CONFIG_TEMPLATE = `import { defineConfig } from '@carbon/core/config';

export default defineConfig({
  project: {
    name: '__NAME__',
    slug: '__SLUG__',
  },
  runtime: {
    port: 8787,
  },
});
`;

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Scaffold a Carbon project in the current directory.' },
  args: {
    name: { type: 'string', description: 'Project name', default: 'carbon-project' },
    slug: { type: 'string', description: 'URL-safe project slug' },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const target = join(cwd, 'carbon.config.ts');
    if (existsSync(target)) {
      ui.warn('carbon.config.ts already exists — leaving it alone.');
      return;
    }
    const slug = args.slug ?? args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const content = CONFIG_TEMPLATE.replace('__NAME__', args.name).replace('__SLUG__', slug);
    await writeFile(target, content, 'utf8');
    await mkdir(join(cwd, '.carbon'), { recursive: true });
    ui.success(`Initialized Carbon project ${ui.code(args.name)}`);
    ui.step('Wrote', 'carbon.config.ts');
    ui.step('Next', `run ${ui.code('carbon record <url>')} to capture your first API`);
  },
});
