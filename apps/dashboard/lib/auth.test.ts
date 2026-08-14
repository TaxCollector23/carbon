import { describe, expect, it } from 'vitest';

import { auth } from './auth';

/**
 * Smoke test — the real behavioural coverage lives upstream in
 * better-auth's own suite. We only want to catch two kinds of accidents:
 *
 *   1. Someone accidentally deletes the `handler` export used by the
 *      Next.js route at `app/api/auth/[...all]/route.ts`.
 *   2. Someone breaks the plugin wiring so `auth.api.getSession` (used by
 *      the CLI-auth page and any future server component) disappears.
 */
describe('dashboard auth handle', () => {
  it('exposes a Better Auth handler and api namespace', () => {
    expect(typeof auth.handler).toBe('function');
    expect(typeof auth.api).toBe('object');
    expect(typeof auth.api.getSession).toBe('function');
  });

  it('has the email/password sign-in and sign-up endpoints enabled', () => {
    expect(typeof auth.api.signInEmail).toBe('function');
    expect(typeof auth.api.signUpEmail).toBe('function');
  });
});
