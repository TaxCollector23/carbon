'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Cross-cutting banner that surfaces the API's `IDEMPOTENCY_KEY_REQUIRED`
 * error taxonomy so every mutation that trips it is visible even when the
 * offending call happened deep inside a section-specific form. Listens for
 * the `carbon:api-error` CustomEvent the shared client dispatches.
 */

interface IdempotencyBannerContextValue {
  visible: boolean;
  dismiss: () => void;
  show: (reason?: string) => void;
}

const Ctx = createContext<IdempotencyBannerContextValue | null>(null);

export function useIdempotencyBanner(): IdempotencyBannerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdempotencyBanner must be used within IdempotencyBannerProvider');
  return v;
}

export function IdempotencyBannerProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onErr(evt: Event) {
      const custom = evt as CustomEvent<{ code?: string }>;
      if (custom.detail?.code === 'IDEMPOTENCY_KEY_REQUIRED') {
        setVisible(true);
      }
    }
    window.addEventListener('carbon:api-error', onErr as EventListener);
    return () => window.removeEventListener('carbon:api-error', onErr as EventListener);
  }, []);

  const value: IdempotencyBannerContextValue = {
    visible,
    dismiss: () => setVisible(false),
    show: () => setVisible(true),
  };

  return (
    <Ctx.Provider value={value}>
      {visible ? <BannerView onDismiss={value.dismiss} /> : null}
      {children}
    </Ctx.Provider>
  );
}

function BannerView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 fixed inset-x-0 top-0 z-50 flex items-start gap-3 border-b px-4 py-2.5 text-sm shadow-sm"
    >
      <div className="flex-1">
        <p className="font-medium">Idempotency key required</p>
        <p className="mt-0.5 text-xs opacity-90">
          The API requires an idempotency key on mutating requests. Generate one via{' '}
          <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">
            crypto.randomUUID()
          </code>{' '}
          for each POST/PATCH/DELETE.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="hover:bg-black/5 dark:hover:bg-white/10 -mr-1 grid h-7 w-7 place-items-center rounded-md"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
