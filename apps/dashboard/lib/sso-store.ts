import { createDatabase, schema } from '@carbon/database';

/**
 * SSO provider store — shim for the Better Auth SSO plugin.
 *
 * The plugin (`@better-auth/plugin-sso`) is not yet on npm for the 1.6.x
 * line this workspace ships. Until it lands, the dashboard reads SSO
 * providers straight out of `organizations.settings.ssoProviders` — the
 * same jsonb slot the admin CRUD API writes to (see apps/api/src/routes
 * /sso.ts). No new schema, no new dep. When the plugin is available we
 * swap the shim callback handler for the plugin's own.
 */

export interface StoredSsoProvider {
  readonly id: string;
  readonly type: 'saml' | 'oidc';
  readonly name: string;
  readonly emailDomain?: string;
  readonly orgId: string;
  readonly config: Record<string, unknown>;
  readonly createdAt: string;
}

interface OrgRow {
  id: string;
  settings: unknown;
}

let dbHandle: { db: ReturnType<typeof createDatabase>['db'] } | null = null;

function getDb(): { db: ReturnType<typeof createDatabase>['db'] } | null {
  if (!process.env.DATABASE_URL) return null;
  if (!dbHandle) {
    const { db } = createDatabase({
      url: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? true : undefined,
    });
    dbHandle = { db };
  }
  return dbHandle;
}

async function loadAll(): Promise<StoredSsoProvider[]> {
  const handle = getDb();
  if (!handle) return [];
  const rows = (await handle.db
    .select({ id: schema.organizations.id, settings: schema.organizations.settings })
    .from(schema.organizations)) as OrgRow[];
  const out: StoredSsoProvider[] = [];
  for (const row of rows) {
    const settings = (row.settings ?? {}) as { ssoProviders?: StoredSsoProvider[] };
    for (const p of settings.ssoProviders ?? []) {
      out.push({ ...p, orgId: row.id });
    }
  }
  return out;
}

export async function findProviderById(id: string): Promise<StoredSsoProvider | null> {
  const all = await loadAll();
  return all.find((p) => p.id === id) ?? null;
}

export async function findProviderByEmail(email: string): Promise<StoredSsoProvider | null> {
  const at = email.indexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain) return null;
  const all = await loadAll();
  return all.find((p) => (p.emailDomain ?? '').toLowerCase() === domain) ?? null;
}
