/**
 * Firebase has been removed from Carbon. Human auth is now Better Auth,
 * hosted by the dashboard app (apps/dashboard) — see NEXT_PUBLIC_DASHBOARD_URL
 * for the sign-in surface (defaults to http://localhost:3001/sign-in).
 *
 * This file is retained as a stub so any stale import fails loudly at call
 * time rather than silently reintroducing a second auth system.
 */

function removed(): never {
  throw new Error(
    'apps/web/lib/firebase.ts has been removed — human auth is Better Auth on the dashboard. ' +
      'Redirect users to NEXT_PUBLIC_DASHBOARD_URL/sign-in instead.',
  );
}

export const firebaseApp: never = new Proxy({}, { get: removed }) as never;
export const auth: never = new Proxy({}, { get: removed }) as never;
export const googleProvider: never = new Proxy({}, { get: removed }) as never;

export async function loadAnalytics(): Promise<null> {
  return null;
}
