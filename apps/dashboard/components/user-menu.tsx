'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useSession, signOut } from '@/lib/auth-client';

/**
 * Topbar user menu.
 *
 * Shows the current user email and a Sign out button. The menu is
 * intentionally invisible when there is no session — the auth-disabled
 * dev flow (CARBON_AUTH_MODE=disabled) leaves useSession() empty and we
 * shouldn't render a fake identity.
 */
export function UserMenu() {
  const { data, isPending } = useSession();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (isPending || !data?.user) return null;

  const email = data.user.email ?? data.user.name ?? data.user.id;

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/sign-in');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground max-w-[16rem] truncate" title={email}>
        {email}
      </span>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="border-border hover:bg-muted/40 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
