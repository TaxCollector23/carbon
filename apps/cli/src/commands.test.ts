import { describe, expect, it } from 'vitest';
import { cliCommandCatalog, cliSubCommands } from './commands.js';

describe('CLI command catalog', () => {
  it('lists every top-level command and snapshot subcommand', () => {
    const listed = cliCommandCatalog.map((entry) => entry.command);

    for (const command of Object.keys(cliSubCommands)) {
      expect(listed).toContain(`carbon ${command}`);
    }

    expect(listed).toContain('carbon snapshot save');
    expect(listed).toContain('carbon snapshot load');
    expect(listed).toContain('carbon snapshot list');
    expect(listed).toContain('carbon snapshot delete');
  });
});
