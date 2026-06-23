import { NextRequest } from "next/server";
import { bumpCounter, getUserById, listPublished } from "@/lib/store";
import { gatewayAddressFor } from "@/lib/agent-skills";
import { validateWallet } from "@/lib/validate-wallet";

export const runtime = "nodejs";

const BURN = "0x000000000000000000000000000000000000dEaD";

/**
 * Agent service catalog — the machine-readable index of everything an agent can
 * buy. Exposed at /.well-known/agent-skills.json via a rewrite (see
 * next.config.mjs). Complements /.well-known/agent-payment.json: that manifest
 * says HOW to pay (x402 + Circle Gateway), this catalog says WHAT is for sale,
 * so an agent can discover and pay without scraping the HTML feed.
 *
 * Each entry is a self-describing x402 service: a free preview block (block 0),
 * the resource URL pattern for paid blocks, the price, and the payout address.
 * Hitting a paid block returns an authoritative x402 402 quote.
 */
export async function GET(req: NextRequest) {
  void bumpCounter("agentcatalog_hit");

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 100);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
  const gateway = gatewayAddressFor({ gateway_address: null });
  const usdc = process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";

  const rows = await listPublished({ contentType: "agent-skills", sort: "newest", limit, offset });

  // Platform reserve — where a payment defaults when a creator has no wallet, so
  // the catalog never advertises the dead/burn address (mirrors the .md route).
  const reserve =
    (validateWallet(process.env.PLATFORM_ADDRESS || process.env.PLATFORM_WALLET_ADDRESS).checksummed as string | undefined) ?? BURN;

  // Resolve each creator's payout wallet (the authoritative `pay_to` is also
  // returned in the 402 quote, but advertising it here saves a round-trip).
  const services = await Promise.all(
    rows.map(async (c) => {
      const creator = await getUserById(c.creator_id);
      const payTo =
        validateWallet(creator?.wallet_address).checksummed ??
        validateWallet(creator?.embedded_wallet_address).checksummed ??
        reserve;
      const skillUrl = `${baseUrl}/read/${c.slug}/agent-skills.md`;
      return {
        name: c.title,
        slug: c.slug,
        description: c.summary,
        creator: c.creator_handle ? `@${c.creator_handle}` : null,
        content_type: "agent-skills",
        price_per_block: c.price_per_block,
        currency: "USDC",
        payable_blocks: c.block_count,
        // Free onboarding block — fetch this first to decide relevance, no payment.
        preview_url: skillUrl,
        // Paid blocks: GET with `?block=N` (N≥1). No X-Payment → 402 quote.
        resource_url_pattern: `${skillUrl}?block={n}`,
        pay_to: payTo,
        payment_header: "X-Payment",
        x402_version: 2,
      };
    })
  );

  const body = {
    version: "1.0",
    // Mirrors /.well-known/agent-payment.json so an agent can settle right away.
    payment_protocol: "x402",
    settlement: "circle-gateway-eip3009",
    network: "eip155:5042002",
    currency: "USDC",
    asset: usdc,
    gateway_address: gateway,
    discovery: "/.well-known/agent-payment.json",
    count: services.length,
    services,
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
