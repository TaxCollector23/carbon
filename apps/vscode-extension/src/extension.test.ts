import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shape test on package.json contributes — cheap smoke that guards against
 * accidental drift between the four command IDs the extension registers and
 * what's declared to VS Code. Booting `@vscode/test-electron` would drag a
 * full VS Code download into CI for a check this size.
 */
describe('vscode-extension package.json', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
  ) as {
    activationEvents: string[];
    main: string;
    engines: { vscode: string };
    contributes: {
      commands: Array<{ command: string; title: string }>;
      configuration: { properties: Record<string, unknown> };
    };
  };

  const expected = ['carbon.emulate', 'carbon.inspectGraph', 'carbon.newProject', 'carbon.viewLogs'];

  it('declares each command', () => {
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const id of expected) expect(ids.has(id)).toBe(true);
  });

  it('activates on each command', () => {
    for (const id of expected) {
      expect(pkg.activationEvents).toContain(`onCommand:${id}`);
    }
  });

  it('points main at the bundled CJS entry', () => {
    expect(pkg.main).toBe('./dist/extension.cjs');
    expect(pkg.main.endsWith('.cjs')).toBe(true);
  });

  it('targets VS Code 1.85+', () => {
    expect(pkg.engines.vscode).toBe('^1.85.0');
  });

  it('exposes required configuration keys', () => {
    const props = pkg.contributes.configuration.properties;
    expect(props['carbon.apiUrl']).toBeDefined();
    expect(props['carbon.telemetry']).toBeDefined();
    expect(props['carbon.judgeThreshold']).toBeDefined();
  });
});
