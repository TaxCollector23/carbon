import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import CliAuthApproval from './approval';

/**
 * `/cli-auth/:session` — approve-or-deny page hit by the browser after the
 * CLI launches a device-authorization login.
 *
 * Server component. Resolves the current Better Auth session first (redirect
 * to /sign-in if missing) and hands off to the client `CliAuthApproval` for
 * the actual approve/deny buttons. The child component uses the browser
 * fetch() so the same-origin session cookie is forwarded to
 * `POST /v1/cli-auth/:id/approve` on apps/api.
 */
export default async function CliAuthPage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params;
  const hdrs = await headers();
  const sessionResult = await auth.api.getSession({ headers: hdrs }).catch(() => null);

  if (!sessionResult?.user) {
    // Bounce through the sign-in page and come back here after auth. When the
    // /sign-in route lands (Phase 2 UI work), it should honour ?next=.
    redirect(`/sign-in?next=/cli-auth/${encodeURIComponent(session)}`);
  }

  const user = {
    id: sessionResult.user.id,
    email: sessionResult.user.email ?? '',
    name: sessionResult.user.name ?? null,
  };

  const apiUrl = process.env.NEXT_PUBLIC_CARBON_API_URL ?? 'http://localhost:4000';

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center p-6">
      <div className="bg-card w-full rounded-lg border p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Authorize the Carbon CLI</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          You’re about to grant the Carbon command-line tool access to your account.
        </p>

        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Signed in as</dt>
            <dd className="font-medium">{user.email || user.name || user.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Session code</dt>
            <dd className="font-mono">{session}</dd>
          </div>
        </dl>

        <div className="mt-6">
          <CliAuthApproval sessionId={session} apiUrl={apiUrl} />
        </div>

        <p className="text-muted-foreground mt-6 text-xs">
          If you didn’t start this login from your terminal, click Deny.
        </p>
      </div>
    </main>
  );
}
