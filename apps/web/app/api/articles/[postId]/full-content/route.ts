import { NextRequest } from "next/server";
import { getChunks, getContentById, getContentBySlug, getUserById, recordAdminEvent } from "@/lib/store";
import { withGateway } from "@/lib/x402-gateway";
import { validateWallet } from "@/lib/validate-wallet";
import { toBaseUnits, toDecimal } from "@/lib/money";
import { escapeHtml } from "@/lib/creator-posts";
import type { Address } from "viem";
import type { Chunk } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/articles/:postId/full-content — x402-gated, agent/HTTP-client access
 * to a full Skimflow article (all blocks, including the paid ones).
 *
 * This is SEPARATE from the human block-unlock flow (app/api/reader/:slug) and
 * does not touch it. Agents pay ONCE for the whole article via x402 + Circle
 * Gateway — the same payment rail as humans (lib/x402-gateway.withGateway).
 *
 *   • Free article (no paid blocks) → 200 immediately, no payment.
 *   • Paid article, no X-Payment    → 402 with the x402 quote + X-Payment-* hints.
 *   • Paid article, valid X-Payment → 200 with the full content payload.
 *
 * Amount = SUM of every paid block's price (price_per_block × paid-block count;
 * no whole-piece discount). Payment goes to the CREATOR's Circle wallet only —
 * never a platform fallback (503 if the creator has no wallet).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const { postId } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
  const ts = new Date().toISOString();

  // Resolve by id first, then slug (agents may hold either).
  const content = (await getContentById(postId)) ?? (await getContentBySlug(postId));
  if (!content || content.status !== "published") {
    logHit({ ts, postId, ip, status: "unpaid", amount: "0", note: "not_found_or_unpublished" });
    return Response.json({ error: "article_not_found" }, { status: 404 });
  }
  if (content.content_type !== "article") {
    return Response.json({ error: "not_an_article", contentType: content.content_type }, { status: 400 });
  }

  const creator = await getUserById(content.creator_id);
  const chunks = await getChunks(content.id);
  const paidCount = chunks.filter((c) => !c.is_free).length;

  // ── Free article: skip x402 entirely ───────────────────────────────────────
  if (paidCount === 0) {
    logHit({ ts, postId, ip, status: "paid", amount: "0", note: "free_article" });
    return Response.json(buildPayload(content, creator, chunks, { settledAt: ts, walletAddress: null }), { status: 200 });
  }

  // ── Creator wallet resolution (no platform fallback) ────────────────────────
  const wallet = validateWallet(creator?.wallet_address);
  if (!wallet.valid || !wallet.checksummed) {
    logHit({ ts, postId, ip, status: "invalid", amount: "0", note: "creator_no_wallet" });
    return Response.json(
      { error: "creator_wallet_unavailable", friendly: "This creator hasn't set up a payout wallet, so the article can't be purchased yet." },
      { status: 503 }
    );
  }
  const payTo = wallet.checksummed as Address;

  // Amount = sum of paid block prices = price_per_block × paidCount (exact, in base units).
  const totalBase = toBaseUnits(content.price_per_block) * BigInt(paidCount);
  const totalDecimal = toDecimal(totalBase);

  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
  const resource = `${base}/api/articles/${content.id}/full-content`;

  // X-Payment-* hints the spec mandates on the 402 (and carried on every response).
  const extraHeaders: Record<string, string> = {
    "X-Payment-Required": "true",
    "X-Payment-Amount": totalDecimal,
    "X-Payment-Currency": "USDC",
    "X-Payment-Network": "ARC-TESTNET",
    "X-Payment-Address": payTo,
  };

  const hasPaymentHeader = !!req.headers.get("x-payment");
  if (!hasPaymentHeader) {
    logHit({ ts, postId, ip, status: "unpaid", amount: totalDecimal, note: "402_quote" });
    await recordAdminEvent({
      eventType: "402_HIT",
      contentId: content.id,
      amountGross: totalDecimal,
      metadata: { endpoint: "full-content", ip },
    }).catch(() => undefined);
  }

  // withGateway: 402 (no/invalid X-Payment) or verify+settle then serve onPaid().
  return withGateway(
    req,
    {
      price: totalDecimal,
      payTo,
      resource,
      description: `Full programmatic access to "${content.title}" (${paidCount + 1} blocks) on Skimflow.`,
      extraHeaders,
    },
    (receipt) => {
      const settledAt = new Date().toISOString();
      logHit({ ts, postId, ip, status: "paid", amount: totalDecimal, note: receipt.simulated ? "simulated" : "settled" });
      return Response.json(
        buildPayload(content, creator, chunks, { settledAt, walletAddress: payTo }),
        { status: 200 }
      );
    }
  );
}

// ── Payload builder ───────────────────────────────────────────────────────────

interface ContentRow {
  id: string;
  creator_id: string;
  title: string;
  slug: string;
  published_at: Date | null;
  created_at: Date;
}

function buildPayload(
  content: ContentRow,
  creator: { display_name?: string | null; handle?: string | null; name?: string | null } | undefined,
  chunks: Chunk[],
  opts: { settledAt: string; walletAddress: string | null }
) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");
  const blocks = chunks
    .slice()
    .sort((a, b) => a.block_index - b.block_index)
    .map((c) => {
      const text = mdToText(c.text);
      return {
        index: c.block_index,
        isFree: c.is_free,
        contentHtml: mdToHtml(c.text),
        contentText: text,
        wordCount: wordCount(text),
      };
    });
  return {
    creatorId: content.creator_id,
    creatorName: creator?.display_name || creator?.handle || creator?.name || "Creator",
    postId: content.id,
    title: content.title,
    canonicalUrl: `${base}/read/${content.slug}`,
    publishedAt: (content.published_at ?? content.created_at).toISOString(),
    wordCount: blocks.reduce((n, b) => n + b.wordCount, 0),
    blocks,
    settledAt: opts.settledAt,
    creatorWalletAddress: opts.walletAddress,
  };
}

// ── Markdown helpers (stored chunk.text is Markdown — see components/RichText) ──

function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Markdown → clean plaintext (strip the common markers). */
function mdToText(md: string): string {
  return (md ?? "")
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```/g, "").trim()) // keep code text, drop fences
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images → nothing
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Minimal, escaped Markdown → HTML (paragraphs, headings, code, quotes, images). */
function mdToHtml(md: string): string {
  const src = (md ?? "").trim();
  if (!src) return "";
  const blocks = src.split(/\n{2,}/);
  return blocks
    .map((b) => {
      const t = b.trim();
      const fence = t.match(/^```(?:\w+)?\n?([\s\S]*?)```$/);
      if (fence) return `<pre><code>${escapeHtml(fence[1].replace(/\n$/, ""))}</code></pre>`;
      const heading = t.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const lvl = heading[1].length;
        return `<h${lvl}>${inlineMd(heading[2])}</h${lvl}>`;
      }
      const img = t.match(/^!\[([^\]]*)\]\(([^)]*)\)/);
      if (img) return `<figure><img src="${escapeHtml(img[2])}" alt="${escapeHtml(img[1])}"/></figure>`;
      if (/^>\s?/.test(t)) return `<blockquote>${inlineMd(t.replace(/^>\s?/gm, ""))}</blockquote>`;
      return `<p>${inlineMd(t)}</p>`;
    })
    .join("\n");
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/(\*\*|__)(.*?)\1/g, "<strong>$2</strong>")
    .replace(/(\*|_)(.*?)\1/g, "<em>$2</em>")
    .replace(/`([^`]*)`/g, "<code>$1</code>")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, "<br/>");
}

// ── Traction logging ────────────────────────────────────────────────────────

function logHit(o: { ts: string; postId: string; ip: string; status: "paid" | "unpaid" | "invalid"; amount: string; note: string }) {
  console.log(`[full-content] ${o.ts} post=${o.postId} ip=${o.ip} status=${o.status} amount=${o.amount} USDC (${o.note})`);
}
