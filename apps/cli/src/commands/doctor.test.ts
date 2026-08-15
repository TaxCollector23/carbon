import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand } from './doctor.js';
import { setPrinterMode } from '../lib/printer.js';

describe('doctor command', () => {
  let home: string;
  let output = '';
  let writeSpy: { mockRestore: () => void };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'carbon-cli-doctor-'));
    vi.stubEnv('HOME', home);
    setPrinterMode('human');
    output = '';
    process.exitCode = undefined;
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      });
  });

  afterEach(async () => {
    writeSpy.mockRestore();
    setPrinterMode('human');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    await rm(home, { force: true, recursive: true });
  });

  it('checks the current Node floor and Carbon dev ports', async () => {
    await doctorCommand.run!({ args: { 'skip-network': true } } as never);

    expect(output).toContain('Node.js >= 22.13');
    expect(output).toContain('Web dev port 1223');
    expect(output).toContain('Dashboard dev port 3001');
    expect(output).toContain('API dev port 4000');
    expect(output).toContain('Saved credentials');
    expect(output).not.toContain('Carbon API reachable');
    expect(process.exitCode).toBeUndefined();
  });

  it('fails fast for an invalid API URL without probing the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await doctorCommand.run!({
      args: { 'api-url': 'not a url', 'skip-network': true },
    } as never);

    expect(output).toContain('Carbon API URL');
    expect(output).toContain('invalid URL: not a url');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('emits a structured summary in JSON mode', async () => {
    setPrinterMode('json');

    await doctorCommand.run!({ args: { 'skip-network': true } } as never);

    const lines = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'doctor.result',
      data: { ok: true, failed: 0 },
    });
    expect(
      lines[0].data.checks.some((check: { name: string }) => check.name === 'Node.js >= 22.13'),
    ).toBe(true);
    expect(output).not.toContain('carbon doctor');
  });
});
