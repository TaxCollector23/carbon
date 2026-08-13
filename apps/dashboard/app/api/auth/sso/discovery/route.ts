import { NextResponse, type NextRequest } from 'next/server';
import { findProviderByEmail } from '@/lib/sso-store';

/**
 * Public SSO discovery endpoint used by the sign-in page.
 *
 * The API's `/v1/sso/providers` route requires an admin API key so the
 * sign-in page (unauthenticated) cannot call it directly. This route
 * exposes only the minimum surface needed to render an "Sign in with
 * SSO" button — the provider id, display name, and type — never the
 * OIDC clientSecret or SAML certificate.
 *
 * Shape:
 *   GET /api/auth/sso/discovery?email=alice@acme.example
 *   → 200 { provider: { id, name, type } | null }
 */
export async function GET(req: NextRequest): Promise<Response> {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ provider: null });
  const provider = await findProviderByEmail(email);
  if (!provider) return NextResponse.json({ provider: null });
  return NextResponse.json({
    provider: { id: provider.id, name: provider.name, type: provider.type },
  });
}
