import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { findProviderById } from '@/lib/sso-store';

/**
 * `GET /api/auth/sso/callback?code=&state=`
 *
 * Completes the OIDC authorization-code flow: exchanges `code` for an
 * `id_token`, extracts the user's email, and hands off to Better Auth's
 * server-side APIs to create (or reuse) a user + session cookie.
 *
 * When @better-auth/plugin-sso publishes for the 1.6.x line, replace this
 * whole file with the plugin's handler — the shim is intentionally
 * minimal so the migration is a delete rather than a rewrite.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  if (!code || !stateParam) {
    return NextResponse.json({ error: 'code + state required' }, { status: 400 });
  }

  const cookie = req.cookies.get('sso_state')?.value;
  if (!cookie) {
    return NextResponse.json({ error: 'sso_state cookie missing — restart the flow' }, { status: 400 });
  }

  const [cookieState, providerId, encodedNext] = cookie.split('.');
  if (cookieState !== stateParam || !providerId) {
    return NextResponse.json({ error: 'state mismatch — CSRF check failed' }, { status: 400 });
  }
  const next = encodedNext ? decodeURIComponent(encodedNext) : '/';

  const provider = await findProviderById(providerId);
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

  const cfg = provider.config as {
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    tokenUrl?: string;
  };
  if (!cfg.clientId || !cfg.clientSecret || !(cfg.tokenUrl || cfg.issuer)) {
    return NextResponse.json({ error: 'provider missing token config' }, { status: 500 });
  }
  const tokenUrl = cfg.tokenUrl ?? `${cfg.issuer!.replace(/\/$/, '')}/token`;
  const redirectUri = `${req.nextUrl.origin}/api/auth/sso/callback`;

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '');
    return NextResponse.json(
      { error: 'token exchange failed', status: tokenRes.status, detail: detail.slice(0, 200) },
      { status: 502 },
    );
  }
  const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) {
    return NextResponse.json({ error: 'IdP did not return an id_token' }, { status: 502 });
  }

  const claims = decodeJwtClaims(tokens.id_token);
  const email = typeof claims.email === 'string' ? claims.email : null;
  if (!email) {
    return NextResponse.json({ error: 'id_token missing email claim' }, { status: 400 });
  }

  // Best-effort domain gate — the discovery endpoint filtered by domain
  // already, but a stolen state cookie could still land here with a
  // wrong email.
  if (provider.emailDomain) {
    const domain = email.slice(email.indexOf('@') + 1).toLowerCase();
    if (domain !== provider.emailDomain.toLowerCase()) {
      return NextResponse.json({ error: 'email domain does not match provider' }, { status: 403 });
    }
  }

  // Hand off to Better Auth. Its exposed API accepts an email/password
  // sign-in path we can reuse here by minting a signed one-time token —
  // but the cleanest cross-plugin approach is to call the internal
  // adapter directly through `auth.api.signInMagicLink`-style helpers.
  // Since this shim's job is to unblock enterprise SSO without waiting
  // on the plugin, we take the simpler route: upsert a user row and
  // set the session cookie the same way Better Auth does via its own
  // session store, then redirect to `next`.
  //
  // Better Auth exposes createSession under $context.internalAdapter —
  // guarded here so a future version rename fails loudly with a clear
  // message instead of silently issuing an invalid cookie.
  const ctx = await (auth as unknown as {
    $context: Promise<{
      internalAdapter: {
        findUserByEmail: (email: string) => Promise<{ user: { id: string } } | null>;
        createUser: (input: {
          email: string;
          name?: string;
          emailVerified?: boolean;
        }) => Promise<{ id: string }>;
        createSession: (
          userId: string,
          request: Request,
        ) => Promise<{ token: string; expiresAt: Date }>;
      };
      authCookies: { sessionToken: { name: string; attributes: unknown } };
    }>;
  }).$context;
  if (!ctx?.internalAdapter?.createSession) {
    return NextResponse.json(
      { error: 'Better Auth internal adapter shape changed — swap this shim for @better-auth/plugin-sso.' },
      { status: 500 },
    );
  }

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  const userId = existing?.user.id
    ?? (await ctx.internalAdapter.createUser({
      email,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      emailVerified: true,
    })).id;

  const session = await ctx.internalAdapter.createSession(userId, req as unknown as Request);

  const res = NextResponse.redirect(new URL(next.startsWith('/') ? next : '/', req.nextUrl.origin), {
    status: 302,
  });
  const cookieName = (ctx.authCookies?.sessionToken?.name as string | undefined) ?? 'better-auth.session_token';
  res.cookies.set(cookieName, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt,
    path: '/',
  });
  // Clear the state cookie
  res.cookies.set('sso_state', '', { path: '/api/auth/sso', maxAge: 0 });
  return res;
}

function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split('.');
  if (!payload) return {};
  try {
    // base64url → base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
