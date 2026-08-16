import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARBON_VERSION } from './index.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string };

describe('CLI version', () => {
  it('keeps CARBON_VERSION in sync with package.json', () => {
    expect(CARBON_VERSION).toBe(pkg.version);
  });

  it('is a valid semver', () => {
    expect(CARBON_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
