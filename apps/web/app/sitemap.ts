import type { MetadataRoute } from "next";
import { listSitemapContent } from "@/lib/store";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");

// Re-generated hourly so newly published content shows up without a redeploy.
export const revalidate = 3600;

/**
 * XML sitemap: the static marketing/help pages plus every published piece at
 * /read/{slug}. DB failures degrade gracefully to just the static routes.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/for-you`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  let rows: { slug: string; updated_at: Date; published_at: Date | null }[] = [];
  try {
    rows = await listSitemapContent();
  } catch {
    rows = []; // sitemap still serves the static routes
  }

  const contentRoutes: MetadataRoute.Sitemap = rows.map((c) => ({
    url: `${SITE}/read/${c.slug}`,
    lastModified: c.updated_at ?? c.published_at ?? now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticRoutes, ...contentRoutes];
}
