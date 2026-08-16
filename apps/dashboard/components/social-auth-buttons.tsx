'use client';

import { useState } from 'react';
import { signIn } from '@/lib/auth-client';

interface Props {
  readonly next: string;
  readonly onError: (message: string) => void;
}

export function SocialAuthButtons({ next, onError }: Props) {
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    onError('');
    try {
      const res = await signIn.social({ provider: 'google', callbackURL: next });
      if (res?.error) {
        onError(res.error.message ?? 'Could not start Google sign-in.');
        setPending(false);
        return;
      }
      if (res?.data?.url) window.location.assign(res.data.url);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start Google sign-in.');
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void start()}
        disabled={pending}
        className="border-border hover:bg-muted/40 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
      >
        <span className="grid h-4 w-4 place-items-center font-semibold">G</span>
        {pending ? 'Opening Google...' : 'Continue with Google'}
      </button>
    </div>
  );
}
