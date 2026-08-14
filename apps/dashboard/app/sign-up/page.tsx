'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp } from '@/lib/auth-client';
import { AuthShell, FieldLabel, inputClass } from '@/components/auth-shell';
import { SocialAuthButtons } from '@/components/social-auth-buttons';

/**
 * Email/password sign-up. Same handler as /sign-in, different UI. On
 * success Better Auth issues a session cookie and we redirect to `?next=`.
 */
function SignUpInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  const fromCli = next.startsWith('/cli-auth/');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? 'Sign-up failed');
        setPending(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed');
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your Carbon account"
      subtitle="No email verification in dev. Takes about 15 seconds."
      fromCli={fromCli}
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={`/sign-in${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-foreground underline underline-offset-2"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <FieldLabel label="Name">
          <input
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </FieldLabel>
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
        <FieldLabel label="Password">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </FieldLabel>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <SocialAuthButtons next={next} onError={(message) => setError(message || null)} />
        <div className="flex items-center gap-3">
          <span className="bg-border h-px flex-1" />
          <span className="text-muted-foreground text-xs">or</span>
          <span className="bg-border h-px flex-1" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  );
}

function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
