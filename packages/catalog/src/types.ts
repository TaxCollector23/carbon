/**
 * Public shape of one emulator catalog entry.
 *
 * The catalog powers three things: the /emulators landing pages on the
 * marketing site, the `carbon emulate --catalog <slug>` shortcut in the CLI,
 * and future dashboard "one-click launch" flows. Keep this schema stable —
 * any breaking rename touches all three surfaces.
 */
export type CatalogCategory =
  | 'payments'
  | 'auth'
  | 'communication'
  | 'ai'
  | 'dev-platform'
  | 'storage'
  | 'other';

export type CatalogSpecFormat = 'openapi' | 'graphql' | 'asyncapi';

export interface CatalogEntry {
  /** URL-safe identifier used in routes and the CLI shortcut. */
  readonly slug: string;
  /** Human-readable brand name — capitalised as the vendor writes it. */
  readonly name: string;
  /** Two- to five-word product summary (shown under the name). */
  readonly tagline: string;
  readonly category: CatalogCategory;
  /**
   * A single emoji or short mono-glyph. Rendered inline on cards — we avoid
   * external images so the marketing pages stay fully static and CDN-cacheable
   * with no third-party requests.
   */
  readonly logo: string;
  /**
   * Publicly reachable spec URL. Fetched on demand by the CLI shortcut; the
   * marketing site never fetches this at build or request time.
   */
  readonly specUrl: string;
  readonly specFormat: CatalogSpecFormat;
  readonly homepage: string;
  /** Copy-pasteable one-liner shown on every page. */
  readonly quickstart: string;
  /** Two to four example resource names for the landing page. */
  readonly seedResources?: readonly string[];
  /** Two to three sentence description for SEO + landing hero. */
  readonly description: string;
}
