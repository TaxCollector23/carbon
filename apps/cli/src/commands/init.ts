import { defineCommand } from 'citty';
import { consola } from 'consola';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ui } from '../ui.js';
import { resolveApiKey } from '../lib/credentials.js';

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
    'from-project': {
      type: 'string',
      description:
        'Fetch an existing project (by slug) from the control plane and write its config locally.',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite an existing carbon.config.ts without prompting.',
      default: false,
    },
    'api-url': { type: 'string', description: 'Override the control-plane URL.' },
    'api-key': { type: 'string', description: 'Override the saved API key.' },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const target = join(cwd, 'carbon.config.ts');

    if (existsSync(target) && !args.force) {
      // Interactive path — an accidental `carbon init` in an initialized
      // project should never silently overwrite the user's config.
      const answer = await consola.prompt('carbon.config.ts already exists. Overwrite?', {
        type: 'confirm',
        initial: false,
      });
      if (!answer) {
        ui.warn('Aborted. No changes made.');
        return;
      }
    }

    let content: string;
    let displayName = args.name as string;

    if (args['from-project']) {
      const slug = String(args['from-project']);
      const resolved = await resolveApiKey(
        { flag: args['api-key'] as string | undefined },
        args['api-url'] as string | undefined,
      );
      if (!resolved) {
        ui.error('No API credentials found. Run `carbon login` first, or pass --api-key.');
        process.exitCode = 1;
        return;
      }
      const url = `${resolved.apiUrl.replace(/\/+$/, '')}/v1/projects/${encodeURIComponent(slug)}`;
      let res: Response;
      try {
        res = await fetch(url, { headers: { 'x-carbon-key': resolved.key } });
      } catch (err) {
        ui.error(`Could not reach ${url}: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
      if (!res.ok) {
        ui.error(`Fetch failed: HTTP ${res.status}`);
        process.exitCode = 1;
        return;
      }
      const project = (await res.json()) as {
        name?: string;
        slug?: string;
      };
      const projectName = project.name ?? slug;
      const projectSlug = project.slug ?? slug;
      displayName = projectName;
      content = CONFIG_TEMPLATE.replace('__NAME__', projectName).replace('__SLUG__', projectSlug);
    } else {
      const slug = args.slug ?? args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      content = CONFIG_TEMPLATE.replace('__NAME__', args.name).replace('__SLUG__', slug);
    }

    await writeFile(target, content, 'utf8');
    await mkdir(join(cwd, '.carbon'), { recursive: true });
    ui.success(`Initialized Carbon project ${ui.code(displayName)}`);
    ui.step('Wrote', 'carbon.config.ts');
    ui.step('Next', `run ${ui.code('carbon record <url>')} to capture your first API`);
  },
});
