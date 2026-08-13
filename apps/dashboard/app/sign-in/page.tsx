'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { AuthShell, FieldLabel, inputClass } from '@/components/auth-shell';

interface DiscoveredProvider {
  id: string;
  name: string;
  type: 'saml' | 'oidc';
}

/** Fetch /api/auth/sso/discovery for the typed email; 300ms debounced. */
function useSsoDiscovery(email: string): DiscoveredProvider | null {
  const [provider, setProvider] = useState<DiscoveredProvider | null>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!email.includes('@')) {
      setProvider(null);
      return;
    }
    const t = setTimeout(async () => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      try {
        const res = await fetch(`/api/auth/sso/discovery?email=${encodeURIComponent(email)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { provider: DiscoveredProvider | null };
        setProvider(body.provider);
      } catch {
        // Aborted or offline — leave provider null; user can still password-sign-in.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [email]);

  return provider;
}

function SignInInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  const fromCli = next.startsWith('/cli-auth/');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ssoProvider = useSsoDiscovery(email);

  // ?sso=<providerId> from an enterprise-provisioned deep-link skips the
  // password interstitial entirely.
  useEffect(() => {
    const sso = search.get('sso');
    if (!sso) return;
    window.location.assign(
      `/api/auth/sso/login?providerId=${encodeURIComponent(sso)}&next=${encodeURIComponent(next)}`,
    );
  }, [search, next]);

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
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Use your Carbon email and password."
      fromCli={fromCli}
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link
            href={`/sign-up${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-foreground underline underline-offset-2"
          >
            Create one
          </Link>
        </>
      }
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <FieldLabel label="Email">
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </FieldLabel>
        {ssoProvider ? null : (
          <FieldLabel label="Password">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </FieldLabel>
        )}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {ssoProvider ? (
          <a
            href={`/api/auth/sso/login?providerId=${encodeURIComponent(ssoProvider.id)}&next=${encodeURIComponent(next)}`}
            className="bg-primary text-primary-foreground block w-full rounded-md px-4 py-2.5 text-center text-sm font-medium"
          >
            Sign in with {ssoProvider.name}
          </a>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="bg-primary text-primary-foreground w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        )}
      </form>
    </AuthShell>
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
