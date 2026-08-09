import { describe, expect, it } from 'vitest';
import { CarbonError, helpUrlForCode, InvalidInputError, NotFoundError } from './errors.js';

describe('CarbonError', () => {
  it('defaults `help` to the canonical carbon.dev URL for known codes', () => {
    const err = new CarbonError({ code: 'CARBON_RATE_LIMITED', message: 'slow down' });
    expect(err.help).toBe('https://carbon.dev/errors/carbon-rate-limited');
  });

  it('honors an explicit help URL override', () => {
    const err = new CarbonError({
      code: 'CARBON_INTERNAL',
      message: 'boom',
      help: 'https://runbooks.internal/boom',
    });
    expect(err.help).toBe('https://runbooks.internal/boom');
  });

  it('treats an empty help string as opting out of the default', () => {
    const err = new CarbonError({ code: 'CARBON_INTERNAL', message: 'boom', help: '' });
    expect(err.help).toBeUndefined();
  });

  it('omits `help` when the code is not in the known set', () => {
    // Cast around the discriminated union — the runtime check is what matters.
    const err = new CarbonError({
      code: 'CARBON_MADE_UP' as unknown as 'CARBON_INTERNAL',
      message: 'noop',
    });
    expect(err.help).toBeUndefined();
  });

  it('subclasses inherit the default help URL', () => {
    expect(new NotFoundError('project', 'p1').help).toBe(
      'https://carbon.dev/errors/carbon-not-found',
    );
    expect(new InvalidInputError('bad').help).toBe(
      'https://carbon.dev/errors/carbon-invalid-input',
    );
  });

  it('helpUrlForCode returns undefined for unknown codes', () => {
    expect(helpUrlForCode('CARBON_MADE_UP')).toBeUndefined();
    expect(helpUrlForCode('CARBON_RATE_LIMITED')).toBe(
      'https://carbon.dev/errors/carbon-rate-limited',
    );
  });
});
