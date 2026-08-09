'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Browser-side Better Auth client.
 *
 * `baseURL` intentionally omitted — Better Auth defaults to the current
 * origin, which is what we want: the dashboard runs on its own host
 * (`localhost:3001` in dev), and the auth handler is mounted at
 * `/api/auth/[...all]` on that same origin.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
