import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");

/**
 * robots.txt — let search engines crawl public content, but keep private/app
 * surfaces (API, admin, creator dashboard, auth) out of the index. Points
 * crawlers at the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/dashboard", "/login"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
