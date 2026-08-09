import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Auth gate for the dashboard app.
 *
 * Strategy: check for the presence of a Better Auth session cookie in the
 * request. This is the cheap, edge-safe check Better Auth recommends for
 * middleware — the real cryptographic verification still happens server-
 * side (in the route handlers, in apps/api's session-auth plugin, and in
 * Better Auth's own endpoint code). Middleware only pre-empts obviously
 * unauthenticated navigations so the user lands on /sign-in instead of a
 * blank workspace shell.
 *
 * Dev bypasses:
 *   - `NODE_ENV !== 'production'` (default): the auth-disabled dev flow
 *     that ships with `pnpm dev` keeps working. Contributors who haven't
 *     booted Postgres/Better Auth can still browse the shell.
 *   - `NEXT_PUBLIC_CARBON_DEV_ALLOW_UNAUTH=1`: an explicit knob for CI or
 *     preview builds that want to render the shell without auth.
 *
 * Public routes (always allowed):
 *   - `/sign-in`, `/sign-up` — the auth screens themselves
 *   - `/cli-auth/*` — device-authorization landing; the page component
 *     redirects to /sign-in server-side if there's no session, and we do
 *     NOT want the middleware to strip the `:session` code out of the URL
 *     by short-circuiting first.
 */

const PUBLIC_PATH_PREFIXES = ['/sign-in', '/sign-up', '/cli-auth'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isDevBypass(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.NEXT_PUBLIC_CARBON_DEV_ALLOW_UNAUTH === '1';
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();
  if (isDevBypass()) return NextResponse.next();

  const cookie = getSessionCookie(req);
  if (cookie) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(pathname + (search ?? ''))}`;
  return NextResponse.redirect(url);
}

/**
 * Skip Next.js internals and the auth handler itself. `_next/static`,
 * `_next/image`, and favicon aren't user-facing routes; `/api/auth/*` is
 * Better Auth's handler and must remain reachable to unauthenticated
 * clients so sign-in and sign-up can complete.
 */
export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
