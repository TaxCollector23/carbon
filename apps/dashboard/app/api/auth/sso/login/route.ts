import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { findProviderById } from '@/lib/sso-store';

/**
 * `GET /api/auth/sso/login?providerId=X&next=/`
 *
 * Redirects the user to the SSO provider's authorize endpoint.
 * Currently supports OIDC only — SAML would need a signed AuthnRequest
 * plus IdP-metadata-driven redirect binding, both of which live in a
 * proper library (@better-auth/plugin-sso, not yet on npm for this
 * major).
 *
 * Sets a signed `sso_state` cookie so the callback can verify + recover
 * the `next` param, which mitigates open-redirect and CSRF on the flow.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const providerId = req.nextUrl.searchParams.get('providerId');
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 });

  const provider = await findProviderById(providerId);
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

  if (provider.type !== 'oidc') {
    return NextResponse.json(
      {
        error:
          'SAML providers not yet supported by this shim — install @better-auth/plugin-sso when available',
      },
      { status: 501 },
    );
  }

  const cfg = provider.config as {
    issuer?: string;
    clientId?: string;
    authorizeUrl?: string;
    scope?: string;
  };
  if (!cfg.clientId || !(cfg.authorizeUrl || cfg.issuer)) {
    return NextResponse.json(
      { error: 'provider missing clientId or authorize/issuer URL' },
      { status: 500 },
    );
  }

  // Some IdPs publish authorizeUrl directly, others expect /.well-known/openid-configuration
  // discovery. Prefer explicit authorizeUrl; otherwise assume the standard path.
  const authorize = cfg.authorizeUrl ?? `${cfg.issuer!.replace(/\/$/, '')}/authorize`;

  const state = randomBytes(24).toString('base64url');
  const redirectUri = `${req.nextUrl.origin}/api/auth/sso/callback`;
  const scope = cfg.scope ?? 'openid email profile';

  const authUrl = new URL(authorize);
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authUrl.toString(), { status: 302 });
  // Short-lived state cookie — 10 minutes. httpOnly + Secure in prod.
  res.cookies.set('sso_state', `${state}.${providerId}.${encodeURIComponent(next)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/api/auth/sso',
  });
  return res;
}
