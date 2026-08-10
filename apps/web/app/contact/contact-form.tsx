'use client';

import { useState } from 'react';

/**
 * Enterprise lead-capture form. POSTs directly to the API's public
 * `/v1/leads` route (rate-limited per IP). Kept as a client component so we
 * can render inline success/error state without a full navigation.
 */
type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  return raw && raw.trim() !== '' ? raw.replace(/\/+$/, '') : 'http://localhost:4000';
}

export function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus({ kind: 'submitting' });
    try {
      const res = await fetch(`${apiBase()}/v1/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') ?? '').trim(),
          email: String(data.get('email') ?? '').trim(),
          company: String(data.get('company') ?? '').trim(),
          seats: Number(data.get('seats') ?? 0),
          useCase: String(data.get('useCase') ?? '').trim(),
          source: 'marketing:/contact',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStatus({
          kind: 'error',
          message:
            body?.error?.message ??
            `We could not submit the form (HTTP ${res.status}). Try again shortly.`,
        });
        return;
      }
      form.reset();
      setStatus({ kind: 'ok' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error — please try again.',
      });
    }
  }

  if (status.kind === 'ok') {
    return (
      <div className="border-border bg-subtle/40 rounded-lg border p-8">
        <h3 className="text-lg font-medium">Thanks — we&apos;ll be in touch shortly.</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          A member of the Carbon team will reply within one business day. If it&apos;s urgent,
          email <span className="text-foreground">sales@carbon.dev</span>.
        </p>
      </div>
    );
  }

  const disabled = status.kind === 'submitting';

  return (
    <form onSubmit={onSubmit} className="border-border bg-background rounded-lg border p-6 sm:p-8">
      <div className="grid gap-4">
        <Field label="Your name" name="name" required autoComplete="name" />
        <Field label="Work email" name="email" type="email" required autoComplete="email" />
        <Field label="Company" name="company" required autoComplete="organization" />
        <Field
          label="Seats you expect"
          name="seats"
          type="number"
          min={1}
          max={100000}
          required
        />
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">What are you trying to build?</span>
          <textarea
            name="useCase"
            required
            rows={5}
            maxLength={2000}
            className="border-border bg-background focus:ring-foreground/40 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            placeholder="A couple sentences on your use case — team size, target APIs, compliance needs."
          />
        </label>
        {status.kind === 'error' ? (
          <p className="text-sm text-red-500" role="alert">
            {status.message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={disabled}
          className="bg-foreground text-background mt-2 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
        >
          {disabled ? 'Sending…' : 'Send to sales'}
        </button>
        <p className="text-muted-foreground text-xs">
          By submitting you agree to be contacted about Carbon Enterprise. We do not share your
          details.
        </p>
      </div>
    </form>
  );
}

interface FieldProps
  extends Pick<
    React.InputHTMLAttributes<HTMLInputElement>,
    'name' | 'type' | 'required' | 'min' | 'max' | 'autoComplete'
  > {
  label: string;
}

function Field({ label, name, type = 'text', ...rest }: FieldProps) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        {...rest}
        className="border-border bg-background focus:ring-foreground/40 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2"
      />
    </label>
  );
}
