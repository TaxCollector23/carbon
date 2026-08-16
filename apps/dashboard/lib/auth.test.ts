import { describe, expect, it } from 'vitest';

import { auth, configuredSocialProviders } from './auth';

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

  it('keeps Google social auth enabled without re-enabling GitHub OAuth', () => {
    const previous = {
      googleId: process.env.GOOGLE_CLIENT_ID,
      googleSecret: process.env.GOOGLE_CLIENT_SECRET,
      githubId: process.env.GITHUB_CLIENT_ID,
      githubSecret: process.env.GITHUB_CLIENT_SECRET,
    };
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    process.env.GITHUB_CLIENT_ID = 'github-client';
    process.env.GITHUB_CLIENT_SECRET = 'github-secret';

    try {
      expect(configuredSocialProviders()).toEqual({
        google: {
          clientId: 'google-client',
          clientSecret: 'google-secret',
          prompt: 'select_account',
        },
      });
    } finally {
      restore('GOOGLE_CLIENT_ID', previous.googleId);
      restore('GOOGLE_CLIENT_SECRET', previous.googleSecret);
      restore('GITHUB_CLIENT_ID', previous.githubId);
      restore('GITHUB_CLIENT_SECRET', previous.githubSecret);
    }
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
