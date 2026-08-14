import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/urls';

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${base}/sitemap.xml`,
  };
}
