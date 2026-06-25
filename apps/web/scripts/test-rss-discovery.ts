/**
 * Part 3 verification: feed.xml validity + no paid leakage, and that both the
 * creator profile page AND individual post pages emit a server-rendered RSS
 * <link> (via generateMetadata) for Folo / RSSHub Radar discovery.
 *
 * Run: npx tsx scripts/test-rss-discovery.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.test";

import { NextRequest } from "next/server";
const feedRoute = await import("../app/api/creators/[creatorId]/feed.xml/route.js");
const profileMeta = (await import("../app/creator/[creatorId]/page.js")).generateMetadata;
const readerMeta = (await import("../app/read/[slug]/page.js")).generateMetadata;
const store = await import("../lib/store.js");
const { query } = await import("../lib/db.js");

let failures = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "✅" : "❌"} ${m}`);
  if (!c) failures++;
};

const SECRET = "SECRET-PAID-TEXT-do-not-leak";
let creatorId = "";
let slug = "";
try {
  creatorId = (
    await query<{ id: string }>(
      `INSERT INTO users (email, role, display_name, handle, wallet_address)
       VALUES ($1,'creator','Rss Tester',$2,$3) RETURNING id`,
      [`rss-${process.hrtime.bigint().toString(36)}@example.com`, `rss${Date.now().toString(36).slice(-6)}`, "0x1111111111111111111111111111111111111111"]
    )
  )[0].id;

  const article = await store.createContent({
    creatorId, slug: `rss-paid-${Date.now().toString(36)}`, title: "Paid Post", summary: "A teaser line.", tags: "",
    contentType: "article", body: "x", pricePerBlock: "0.05",
    chunks: [{ text: "Free teaser intro.", isFree: true }, { text: SECRET, isFree: false }],
    firstBlockIndex: 0, status: "published",
  });
  slug = article.slug;

  // ── feed.xml validity + no paid leakage ────────────────────────────────────
  const req = new NextRequest(`https://skimflow.test/api/creators/${creatorId}/feed.xml`);
  const res = await feedRoute.GET(req, { params: Promise.resolve({ creatorId }) });
  const xml = await res.text();
  ok(res.headers.get("Content-Type")?.includes("application/rss+xml") ?? false, "feed: Content-Type application/rss+xml");
  ok(/<rss[^>]*version="2\.0"/.test(xml), "feed: RSS 2.0 declared");
  ok(xml.includes("<channel>") && xml.includes("</channel>"), "feed: has <channel>");
  ok(/<title>[\s\S]*<\/title>/.test(xml) && xml.includes("<link>") && xml.includes("<item>"), "feed: title + link + item present");
  ok(xml.includes("Paid Post"), "feed: paid post title present (as teaser item)");
  ok(!xml.includes(SECRET), "feed: NO paid block text leaked (teaser only)");

  // ?limit passthrough doesn't error.
  const resLim = await feedRoute.GET(new NextRequest(`https://skimflow.test/api/creators/${creatorId}/feed.xml?limit=5`), { params: Promise.resolve({ creatorId }) });
  ok(resLim.status === 200, "feed: ?limit passthrough returns 200");

  // ── Step 1: creator profile page emits server-rendered RSS <link> ──────────
  const pMeta = await profileMeta({ params: Promise.resolve({ creatorId }) });
  const pRss = pMeta?.alternates?.types?.["application/rss+xml"];
  const pHref = Array.isArray(pRss) ? pRss[0]?.url : undefined;
  ok(!!pHref && String(pHref).includes(`/api/creators/${creatorId}/feed.xml`), "profile: RSS alternate link in metadata (Step 1)");

  // ── Step 2: individual post page emits server-rendered RSS <link> ──────────
  const rMeta = await readerMeta({ params: Promise.resolve({ slug }) });
  const rRss = rMeta?.alternates?.types?.["application/rss+xml"];
  const rEntry = Array.isArray(rRss) ? rRss[0] : undefined;
  ok(!!rEntry?.url && String(rEntry.url).includes(`/api/creators/${creatorId}/feed.xml`), "post page: RSS alternate link → creator feed (Step 2)");
  ok(typeof rEntry?.title === "string" && rEntry!.title!.includes("on Skimflow"), `post page: RSS link title formatted ("${rEntry?.title}")`);
} finally {
  if (creatorId) {
    await query(`DELETE FROM content WHERE creator_id = $1`, [creatorId]);
    await query(`DELETE FROM users WHERE id = $1`, [creatorId]);
  }
  console.log(failures === 0 ? "\nALL PASS (cleaned up)" : `\n${failures} FAILURE(S) (cleaned up)`);
  process.exit(failures === 0 ? 0 : 1);
}
