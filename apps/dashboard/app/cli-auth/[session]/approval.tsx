'use client';

import { useEffect, useState } from 'react';

interface OrgOption {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface ApprovalProps {
  sessionId: string;
  apiUrl: string;
}

/**
 * Client half of the CLI auth approval flow.
 *
 * Attempts an approve POST without an orgId. If the server responds with
 * `CARBON_ORG_REQUIRED` and a list of memberships, we render a dropdown and
 * ask the user to pick one before re-posting. Both approve and deny requests
 * are same-origin fetches so the Better Auth session cookie is forwarded.
 */
export default function CliAuthApproval({ sessionId, apiUrl }: ApprovalProps) {
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'approved' | 'denied' | 'error'>(
    'idle',
  );
  const [orgs, setOrgs] = useState<OrgOption[] | null>(null);
  const [chosen, setChosen] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const base = apiUrl.replace(/\/+$/, '');

  useEffect(() => {
    if (orgs && orgs.length > 0 && !chosen) setChosen(orgs[0]!.id);
  }, [orgs, chosen]);

  async function approve(orgId?: string) {
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch(`${base}/v1/cli-auth/${encodeURIComponent(sessionId)}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(orgId ? { orgId } : {}),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            status?: 'approved';
            orgId?: string;
            error?: {
              code?: string;
              message?: string;
              availableOrgs?: OrgOption[];
            };
          }
        | null;

      if (res.ok && body?.status === 'approved') {
        setPhase('approved');
        return;
      }
      if (res.status === 400 && body?.error?.code === 'CARBON_ORG_REQUIRED') {
        setOrgs(body.error.availableOrgs ?? []);
        setPhase('idle');
        return;
      }
      setPhase('error');
      setError(body?.error?.message ?? `Approval failed (HTTP ${res.status})`);
    } catch (err) {
      setPhase('error');
      setError((err as Error).message);
    }
  }

  async function deny() {
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch(`${base}/v1/cli-auth/${encodeURIComponent(sessionId)}/deny`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setPhase('denied');
      } else {
        setPhase('error');
        setError(`Deny failed (HTTP ${res.status})`);
      }
    } catch (err) {
      setPhase('error');
      setError((err as Error).message);
    }
  }

  if (phase === 'approved') {
    return (
      <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 text-sm">
        Approved. Return to your terminal — the CLI will finish signing in shortly.
      </div>
    );
  }
  if (phase === 'denied') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
        Denied. You can close this tab.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orgs && orgs.length > 0 ? (
        <label className="block text-sm">
          <span className="text-muted-foreground">Approve for organization</span>
          <select
            className="mt-1 w-full rounded-md border bg-transparent p-2"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug}) — {o.role}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={phase === 'submitting'}
          onClick={() => approve(orgs && orgs.length > 0 ? chosen : undefined)}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {phase === 'submitting' ? 'Working…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={phase === 'submitting'}
          onClick={deny}
          className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
