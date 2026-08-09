'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';

/**
 * Email/password sign-in.
 *
 * Uses Better Auth's browser client (`signIn.email`) which POSTs to the
 * handler at `/api/auth/sign-in/email` and, on success, sets the session
 * cookie that both the Next.js middleware and apps/api's session-auth
 * plugin honour.
 *
 * `?next=` controls the post-login redirect. To avoid open-redirect
 * abuse we only accept pathnames starting with `/` (not `//` or
 * `/\`, which browsers may treat as a scheme-relative host).
 */
function SignInInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? 'Sign-in failed');
        setPending(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm items-center p-6">
      <div className="bg-card w-full rounded-lg border p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to Carbon</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Use your email and password.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="text-muted-foreground">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-border bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border bg-background mt-1 block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="bg-primary text-primary-foreground w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-muted-foreground mt-6 text-xs">
          Don&apos;t have an account?{' '}
          <Link
            href={`/sign-up${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-foreground underline underline-offset-2"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}

function safeNext(raw: string | null): string {
  if (!raw) return '/';
  // Reject protocol-relative and absolute URLs; only allow same-origin paths.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
