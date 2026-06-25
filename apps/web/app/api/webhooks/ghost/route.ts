import { NextRequest } from "next/server";
import {
  createBook,
  createContent,
  createNotification,
  getGhostIntegration,
  getGhostPostMap,
  getUserById,
  insertGhostPostMap,
  recordAdminEvent,
  setGhostConnectionStatus,
} from "@/lib/store";
import {
  detectContentType,
  fetchGhostPost,
  splitAgentBlocks,
  splitPictureBlocks,
  splitProseBlocks,
  tokenizeHtml,
  verifyGhostSignature,
  type GhostPost,
} from "@/lib/ghost";
import { decryptSecret, secretsEnabled } from "@/lib/secrets";
import { envLimit, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PRICE = process.env.DEFAULT_PRICE_PER_BLOCK || "0.05";

function slugify(title: string): string {
  const base = (title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "ghost";
  return `${base}-${process.hrtime.bigint().toString(36).slice(-5)}`;
}

function appUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
}

/** The Ghost webhook payload wraps the changed post under `post.current`. */
interface GhostWebhookBody {
  post?: { current?: GhostPost; previous?: GhostPost };
}

/**
 * POST /api/webhooks/ghost — receive a Ghost "Post published" webhook.
 *
 * Flow: identify the creator (via ?creator=<id>) → HMAC-validate with the
 * stored Admin API key → idempotency check (ghost_post_id) → fetch the FULL post
 * via the Content API → detect type (Section C) → split into blocks (Section D)
 * → save as draft (+ notify) or auto-publish per the creator's settings.
 *
 * The creator is identified by a `?creator=<creator_id>` query param the creator
 * pastes into the Ghost webhook Target URL (each creator has a distinct URL).
 * This lets us load the right HMAC secret BEFORE trusting the body.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit({ key: "webhook:ghost", limit: envLimit("RATE_LIMIT_WEBHOOK", 200), windowSec: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  const creatorId = req.nextUrl.searchParams.get("creator");
  if (!creatorId) {
    return Response.json({ error: "missing_creator", message: "Target URL must include ?creator=<id>." }, { status: 400 });
  }

  const integration = await getGhostIntegration(creatorId);
  if (!integration) {
    await recordAdminEvent({ eventType: "WEBHOOK_REJECTED", metadata: { source: "ghost", reason: "no_integration", ip } });
    return Response.json({ error: "not_connected" }, { status: 404 });
  }

  if (!secretsEnabled()) {
    // Misconfiguration, not the creator's fault — don't flip them to error.
    return Response.json({ error: "server_misconfigured" }, { status: 503 });
  }

  // Read the raw body ONCE — it's needed verbatim for HMAC verification.
  const raw = await req.text();

  // ── Signature validation (the Admin API key is the HMAC secret) ─────────────
  let adminKey: string;
  let contentKey: string;
  try {
    adminKey = decryptSecret(integration.admin_api_key_enc);
    contentKey = decryptSecret(integration.content_api_key_enc);
  } catch {
    return Response.json({ error: "credential_error" }, { status: 500 });
  }

  const sigHeader = req.headers.get("x-ghost-signature");
  if (!verifyGhostSignature(raw, sigHeader, adminKey)) {
    // CONNECTION STATUS: signature failure flips the integration to "error" with
    // a clear, non-sensitive reason (never leak the key).
    await setGhostConnectionStatus(
      creatorId,
      "error",
      "Webhook signature didn't match. Check that the Ghost Admin API key saved in Skimflow matches the one in your Ghost integration."
    );
    await recordAdminEvent({ eventType: "WEBHOOK_REJECTED", metadata: { source: "ghost", reason: "bad_signature", creatorId, ip } });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Parse the (now-trusted) body.
  let body: GhostWebhookBody;
  try {
    body = JSON.parse(raw) as GhostWebhookBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const summary = body.post?.current;
  const ghostPostId = summary?.id;
  if (!ghostPostId) {
    return Response.json({ error: "missing_post" }, { status: 400 });
  }

  // ── IDEMPOTENCY: a Ghost post is processed at most once ─────────────────────
  const existing = await getGhostPostMap(ghostPostId);
  if (existing) {
    return Response.json({ ok: true, idempotent: true, contentId: existing.content_id }, { status: 200 });
  }

  // ── Always fetch the FULL post via the Content API (webhook may be truncated)
  const full = (await fetchGhostPost(integration.site_url, contentKey, ghostPostId)) ?? summary;

  // ── Detect + split ──────────────────────────────────────────────────────────
  const nodes = tokenizeHtml(full.html ?? "");
  const detection = detectContentType(full, nodes);
  // Detection reason is logged for every post (debugging misclassifications).
  console.log(`[ghost] post ${ghostPostId} → ${detection.contentType} (conf ${detection.confidence}): ${detection.detectionReason}`);

  const title = (full.title ?? "Untitled").trim();
  const summaryText = (full.custom_excerpt || full.excerpt || "").slice(0, 500);
  const tags = (full.tags ?? []).map((t) => t.name || t.slug || "").filter(Boolean).join(", ");
  const monetization = integration.default_monetization; // "free" | "paid"
  const price = monetization === "free" ? "0" : DEFAULT_PRICE;
  const autoPublish = integration.auto_publish;

  // A creator can only PUBLISH with a payout wallet; otherwise fall back to draft
  // (mirrors the manual content route's wallet gate). Drafts never need a wallet.
  const creator = await getUserById(creatorId);
  const hasWallet = !!creator?.wallet_address || !!creator?.embedded_wallet_address;
  const status: "draft" | "published" = autoPublish && hasWallet ? "published" : "draft";

  const gatewayAddress =
    process.env.CIRCLE_GATEWAY_ADDRESS ||
    process.env.GATEWAY_WALLET_ADDRESS ||
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

  const sourceUrl = full.url || `${integration.site_url.replace(/\/$/, "")}/${full.slug ?? ""}`;

  let contentId: string;
  let storedType: ContentType;

  try {
    if (detection.contentType === "picture") {
      // PICTURE: image-driven blocks. Block 0 (the first image) is the free teaser.
      const picBlocks = splitPictureBlocks(nodes);
      if (picBlocks.length === 0) throw new Error("no_images");
      picBlocks[0].isFree = true; // teaser
      if (monetization === "free") picBlocks.forEach((b) => (b.isFree = true));
      else picBlocks.forEach((b, i) => (b.isFree = i === 0));
      const content = await createContent({
        creatorId, slug: slugify(title), title, summary: summaryText, tags,
        contentType: "picture", body: "", pricePerBlock: price, gatewayAddress,
        chunks: picBlocks, firstBlockIndex: 0, status,
        sourceUrl, sourcePlatform: "ghost",
      });
      contentId = content.id;
      storedType = "picture";
    } else if (detection.contentType === "agent_skills") {
      // AGENT SKILL: intro = block 0 (free, generated separately at block 0). The
      // stored chunks are blocks 1..N; the generated onboarding occupies block 0.
      const texts = splitAgentBlocks(nodes);
      if (texts.length === 0) throw new Error("no_blocks");
      // Block 0 of agent-skills is GENERATED (not stored) — so the intro we split
      // off folds into the first stored block rather than being dropped.
      const chunks = texts.map((text) => ({ text, isFree: false }));
      const content = await createContent({
        creatorId, slug: slugify(title), title, summary: summaryText, tags,
        contentType: "agent-skills", body: texts.join("\n\n"), pricePerBlock: price, gatewayAddress,
        chunks, firstBlockIndex: 1, status,
        sourceUrl, sourcePlatform: "ghost",
      });
      contentId = content.id;
      storedType = "agent-skills";
    } else if (detection.contentType === "book") {
      // BOOK: one Ghost post = one chapter; its prose splits into pages. Page 0
      // is the free preview. Series number stored in tags metadata via summary.
      const pages = splitProseBlocks(nodes);
      if (pages.length < 2) {
        // Too short to be a book in practice — fall back to article.
        const articleBlocks = pages.map((text, i) => ({ text, isFree: monetization === "free" ? true : i === 0 }));
        const content = await createContent({
          creatorId, slug: slugify(title), title, summary: summaryText, tags,
          contentType: "article", body: pages.join("\n\n"), pricePerBlock: price, gatewayAddress,
          chunks: articleBlocks.length ? articleBlocks : [{ text: title, isFree: true }],
          firstBlockIndex: 0, status, sourceUrl, sourcePlatform: "ghost",
        });
        contentId = content.id;
        storedType = "article";
      } else {
        const chapterTitle = detection.seriesNumber != null ? `Chapter ${detection.seriesNumber}` : title;
        const content = await createBook({
          creatorId, slug: slugify(title), title,
          description: summaryText, coverImageUrl: full.feature_image ?? null,
          pricePerBlock: price, gatewayAddress,
          tags: [tags, detection.seriesNumber != null ? `series:${detection.seriesNumber}` : ""].filter(Boolean).join(", "),
          status, chapters: [{ title: chapterTitle, pages }],
        });
        contentId = content.id;
        storedType = "book";
      }
    } else {
      // ARTICLE (default): general-rules split. Block 0 is ALWAYS free (teaser).
      const texts = splitProseBlocks(nodes);
      const chunks =
        texts.length > 0
          ? texts.map((text, i) => ({ text, isFree: monetization === "free" ? true : i === 0 }))
          : [{ text: summaryText || title, isFree: true }];
      const content = await createContent({
        creatorId, slug: slugify(title), title, summary: summaryText, tags,
        contentType: "article", body: texts.join("\n\n"), pricePerBlock: price, gatewayAddress,
        chunks, firstBlockIndex: 0, status, sourceUrl, sourcePlatform: "ghost",
      });
      contentId = content.id;
      storedType = "article";
    }
  } catch (e) {
    const detail = String((e as Error)?.message ?? e);
    console.error("[ghost] failed to build content:", detail);
    return Response.json({ error: "content_build_failed", detail }, { status: 422 });
  }

  // ── Idempotency record (after content exists). A concurrent duplicate that
  //    raced past the earlier check returns undefined here → we leave the row we
  //    just made; the unique constraint guarantees only one mapping wins. ──────
  await insertGhostPostMap(ghostPostId, creatorId, contentId);

  // First successful webhook → CONNECTION STATUS = connected.
  await setGhostConnectionStatus(creatorId, "connected", null);

  await recordAdminEvent({
    eventType: "PUBLISH",
    actorId: creatorId,
    contentId,
    metadata: { source: "ghost", ghostPostId, type: storedType, detection: detection.detectionReason, status },
  });

  // ── Notify (drafts) ─────────────────────────────────────────────────────────
  if (status === "draft") {
    await createNotification({
      userId: creatorId,
      type: "ghost_draft",
      title: "New post from Ghost is ready to review",
      body: `"${title}" arrived from Ghost as a ${storedType} draft. Review and publish it when ready.`,
      link: `/dashboard?tab=content`,
      metadata: { contentId, ghostPostId, detectedType: detection.contentType },
    });
  } else {
    await createNotification({
      userId: creatorId,
      type: "ghost_published",
      title: "Post from Ghost published",
      body: `"${title}" was auto-published from Ghost as a ${storedType}.`,
      link: `${appUrl(req)}/read/${slugify(title)}`,
      metadata: { contentId, ghostPostId },
    });
  }

  return Response.json({ ok: true, contentId, type: storedType, status, detection: detection.contentType }, { status: 200 });
}
