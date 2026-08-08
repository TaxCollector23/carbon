import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
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
  /**
   * Enterprise-tier org-level retention window. Null → keep forever
   * (default). The retention purge worker in apps/workers deletes snapshots
   * and events older than this many days.
   */
  retentionDays: integer('retention_days'),
  /** Enterprise-only feature flag toggled on by billing/admin flow. */
  isEnterprise: boolean('is_enterprise').notNull().default(false),
  /** Free-form org preferences (branding, SIEM webhook URL, etc.). */
  settings: jsonb('settings').notNull().default({}),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    /** Free-form tags for organizing snapshots/recordings (e.g. "ci-baseline"). */
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
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
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY['admin']::text[]`),
    projectIds: text('project_ids').array(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    rotatedFromId: text('rotated_from_id').references((): AnyPgColumn => apiKeys.id),
  },
  (t) => ({
    prefixIdx: uniqueIndex('api_keys_prefix_unique').on(t.prefix),
    orgIdx: index('api_keys_org_idx').on(t.orgId),
  }),
);

/**
 * Append-only activity/audit log. Every mutating route in apps/api records
 * an event via services/events.ts#recordEvent — this is also the backing
 * table for the Enterprise audit log export.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    actorType: text('actor_type', { enum: ['user', 'api_key', 'system'] }).notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('events_org_created_idx').on(t.orgId, t.createdAt),
    orgActionIdx: index('events_org_action_idx').on(t.orgId, t.action),
    projectIdx: index('events_project_idx').on(t.projectId),
  }),
);

/**
 * Pending org invitations. A row is created when an owner/admin invites an
 * email; consumed (deleted or marked accepted) when the recipient signs up
 * and accepts.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull().default('member'),
    token: text('token').notNull(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => ({
    tokenUnique: uniqueIndex('invitations_token_unique').on(t.token),
    orgEmailIdx: index('invitations_org_email_idx').on(t.orgId, t.email),
  }),
);

/**
 * Stripe subscription mirror. Updated by the billing webhook — never
 * treat the API-side row as authoritative without checking Stripe's status.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' })
      .unique(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    plan: text('plan', { enum: ['developer', 'team', 'enterprise'] }).notNull().default('developer'),
    status: text('status').notNull().default('inactive'),
    seats: integer('seats').notNull().default(1),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/** Per-project ACL. Absence of any rows = org-wide access (backwards compat). */
export const projectMembers = pgTable(
  'project_members',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['viewer', 'editor', 'admin'] }).notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectUser: uniqueIndex('project_members_project_user_unique').on(t.projectId, t.userId),
  }),
);

/** Threaded comments on artifacts (mostly snapshots + recordings). */
export const artifactComments = pgTable(
  'artifact_comments',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ artifactIdx: index('artifact_comments_artifact_idx').on(t.artifactId) }),
);

/** Per-user preferences (theme, keybindings, misc). */
export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    theme: text('theme', { enum: ['light', 'dark', 'system'] }).notNull().default('system'),
    prefs: jsonb('prefs').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * Reusable chaos presets ("flaky network", "3rd-party outage"). Rules are a
 * JSON list interpreted by packages/runtime plugins.
 */
export const chaosPresets = pgTable(
  'chaos_presets',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    rules: jsonb('rules').notNull().default([]),
    builtIn: boolean('built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgNameIdx: uniqueIndex('chaos_presets_org_name_unique').on(t.orgId, t.name) }),
);

/** Per-endpoint assertion rules ("must return in <200ms", "field never null"). */
export const assertionRules = pgTable(
  'assertion_rules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    endpoint: text('endpoint'),
    kind: text('kind', { enum: ['latency', 'field', 'status'] }).notNull(),
    config: jsonb('config').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectIdx: index('assertion_rules_project_idx').on(t.projectId) }),
);

/**
 * Scheduled drift checks: replay recorded traffic against the real upstream
 * and record whether responses still match the behavior graph.
 */
export const driftChecks = pgTable(
  'drift_checks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'running', 'ok', 'drift', 'error'] })
      .notNull()
      .default('pending'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    result: jsonb('result').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ projectCreatedIdx: index('drift_checks_project_created_idx').on(t.projectId, t.createdAt) }),
);

/** Short-lived, read-only shareable replica links. */
export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({ tokenUnique: uniqueIndex('share_links_token_unique').on(t.token) }),
);
