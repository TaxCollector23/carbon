'use client';

import { useState } from 'react';
import { Github } from 'lucide-react';
import { signIn } from '@/lib/auth-client';

type Provider = 'google' | 'github';

interface Props {
  readonly next: string;
  readonly onError: (message: string) => void;
}

export function SocialAuthButtons({ next, onError }: Props) {
  const [pending, setPending] = useState<Provider | null>(null);

  async function start(provider: Provider) {
    setPending(provider);
    onError('');
    try {
      const res = await signIn.social({ provider, callbackURL: next });
      if (res?.error) {
        onError(res.error.message ?? `Could not start ${label(provider)} sign-in.`);
        setPending(null);
        return;
      }
      if (res?.data?.url) window.location.assign(res.data.url);
    } catch (err) {
      onError(err instanceof Error ? err.message : `Could not start ${label(provider)} sign-in.`);
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void start('google')}
        disabled={pending !== null}
        className="border-border hover:bg-muted/40 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
      >
        <span className="grid h-4 w-4 place-items-center font-semibold">G</span>
        {pending === 'google' ? 'Opening Google...' : 'Continue with Google'}
      </button>
      <button
        type="button"
        onClick={() => void start('github')}
        disabled={pending !== null}
        className="border-border hover:bg-muted/40 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
      >
        <Github className="h-4 w-4" />
        {pending === 'github' ? 'Opening GitHub...' : 'Continue with GitHub'}
      </button>
    </div>
  );
}

function label(provider: Provider): string {
  return provider === 'google' ? 'Google' : 'GitHub';
}
