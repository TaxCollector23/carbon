import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
    assert.equal(typeof auth.handler, 'function', 'auth.handler should be a function');
    assert.equal(typeof auth.api, 'object', 'auth.api should be an object');
    assert.equal(
      typeof auth.api.getSession,
      'function',
      'auth.api.getSession should be callable',
    );
  });

  it('has the email/password sign-in and sign-up endpoints enabled', () => {
    assert.equal(
      typeof auth.api.signInEmail,
      'function',
      'signInEmail endpoint should be available',
    );
    assert.equal(
      typeof auth.api.signUpEmail,
      'function',
      'signUpEmail endpoint should be available',
    );
  });
});
