import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Carbon's control-plane schema. The runtime's state engine is separate —
 * that is the emulated API's data. This schema holds users, orgs, projects,
 * ingested artifacts, and cloud-synced snapshots.
 */
/**
 * Better Auth's canonical user model. Column names match the adapter's
 * expectations verbatim — do not rename without also updating the adapter
 * config in `apps/dashboard/lib/auth.ts`.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailUnique: uniqueIndex('users_email_unique').on(t.email) }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('sessions_token_unique').on(t.token),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerAccount: uniqueIndex('accounts_provider_account_unique').on(t.providerId, t.accountId),
    userIdx: index('accounts_user_idx').on(t.userId),
  }),
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ identifierIdx: index('verifications_identifier_idx').on(t.identifier) }),
);

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('member'),
  },
  (t) => ({ userOrg: uniqueIndex('memberships_user_org_unique').on(t.userId, t.orgId) }),
);

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => ({ orgSlug: uniqueIndex('projects_org_slug_unique').on(t.orgId, t.slug) }),
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['ir', 'graph', 'snapshot', 'recording'] }).notNull(),
    storageKey: text('storage_key').notNull(),
    /** Denormalized metadata for cheap listing without dereferencing storage. */
    meta: jsonb('meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectKind: index('artifacts_project_kind_idx').on(t.projectId, t.kind) }),
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 hash of the presented random secret. Never store secrets in cleartext. */
    hash: text('hash').notNull(),
    prefix: text('prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Additive permission scopes: `read`, `write`, `admin`. `admin` implies
     * write; write implies read. Default preserves the pre-RBAC behavior — every
     * existing key is `admin` after migration.
     */
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY['admin']::text[]`),
    /**
     * When non-null, restricts this key to the given project ids (within its
     * org). Null means "all projects in org".
     */
    projectIds: text('project_ids').array(),
    /**
     * When non-null, the key is treated as revoked once now() > expiresAt.
     * Used both for short-lived (CI) keys and for the grace window on a
     * rotated predecessor. Null → never-expiring (legacy behavior).
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * When non-null, points at the source key this row was minted from via
     * the rotation flow. Purely informational — auth never dereferences it.
     */
    rotatedFromId: text('rotated_from_id').references((): AnyPgColumn => apiKeys.id),
  },
  (t) => ({
    prefixIdx: uniqueIndex('api_keys_prefix_unique').on(t.prefix),
    orgIdx: index('api_keys_org_idx').on(t.orgId),
  }),
);
