import { NextRequest } from "next/server";
import { bumpCounter, listPublished } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /deploy — the single entry point for an AI agent.
 *
 * Hit this one URL and you have everything needed to discover, evaluate, and pay
 * for skills autonomously: the protocol, the catalog, the manifest, and a worked
 * example. Public, no auth. Content-negotiated: JSON by default (and for
 * `Accept: application/json` or `?format=json`), a readable HTML page in a
 * browser (`Accept: text/html` or `?format=html`).
 */
export async function GET(req: NextRequest) {
  void bumpCounter("deploy_hit");

  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");

  // Use a real, live agent-skill slug for the worked example, and derive a
  // price hint so an agent knows the cost order of magnitude before it even
  // hits the catalog. Falls back gracefully if the DB is unavailable.
  let exampleSlug = "revising-a-time-loop-narrative";
  const defaultPrice = process.env.DEFAULT_PRICE_PER_BLOCK || "0.05";
  let pricing: {
    currency: string;
    model: string;
    free_preview: string;
    min_per_block: string;
    max_per_block: string;
    note: string;
  } = {
    currency: "USDC",
    model: "per_block",
    free_preview: "block 0 of every skill is free",
    min_per_block: defaultPrice,
    max_per_block: defaultPrice,
    note: "Exact price is in each skill's catalog entry and its 402 quote.",
  };
  try {
    const rows = await listPublished({ contentType: "agent-skills", sort: "newest", limit: 50 });
    if (rows[0]?.slug) exampleSlug = rows[0].slug;
    const prices = rows.map((r) => Number(r.price_per_block)).filter((n) => Number.isFinite(n) && n >= 0);
    if (prices.length) {
      pricing = {
        ...pricing,
        min_per_block: Math.min(...prices).toFixed(6).replace(/\.?0+$/, ""),
        max_per_block: Math.max(...prices).toFixed(6).replace(/\.?0+$/, ""),
      };
    }
  } catch {
    /* fall back to the seeded example slug + default price */
  }

  const manifest = `${base}/.well-known/agent-payment.json`;
  const catalog = `${base}/.well-known/agent-skills.json`;
  const previewExample = `${base}/read/${exampleSlug}/agent-skills.md`;
  const paidExample = `${previewExample}?block=1`;

  const body = {
    platform: "Skimflow",
    description:
      "A pay-per-block content platform. AI agents can discover and purchase knowledge skills using x402 (HTTP 402 + X-Payment header) settled as USDC on Circle Gateway.",
    protocol: "x402",
    x402_version: 2,
    network: "eip155:5042002 (Arc Testnet)",
    asset: "USDC",
    base_url: base,
    pricing,
    how_it_works: [
      "1. GET /deploy (you are here) — read this to understand the platform",
      "2. GET /.well-known/agent-skills.json — browse the full skills catalog",
      "3. GET the preview_url of any skill — free, no payment needed (block 0)",
      "4. GET paid_url with ?block=n (n>=1) — server returns HTTP 402 with x402 quote",
      "5. Sign EIP-3009 USDC authorization for the quoted amount and payTo",
      "6. Retry GET with X-Payment: <base64 payload> header",
      "7. 200 returns the block content. Repeat until 'no more blocks'.",
    ],
    manifest,
    catalog,
    preview_example: previewExample,
    paid_example: paidExample,
    readme:
      "You are an AI agent. Hit the catalog to browse skills. Hit any preview_url free. Pay per block using x402 (HTTP 402 -> sign EIP-3009 USDC authorization -> retry with the X-Payment header). That's it.",
  };

  const headers: Record<string, string> = {
    Link: `<${manifest}>; rel="payment-manifest"`,
    "Cache-Control": "public, max-age=300",
  };

  const fmt = req.nextUrl.searchParams.get("format");
  const accept = req.headers.get("accept") || "";
  const wantsHtml = fmt === "html" || (fmt !== "json" && accept.includes("text/html"));

  if (!wantsHtml) {
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  return new Response(renderHtml(body), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

/** Minimal, dependency-free HTML view of the same payload for human eyes. */
function renderHtml(b: ReturnType<typeof Object> & Record<string, any>): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const steps = (b.how_it_works as string[]).map((s) => `<li>${esc(s)}</li>`).join("");
  const link = (url: string, label: string) => `<a href="${esc(url)}">${esc(label)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Skimflow · Agent Entry Point (/deploy)</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 760px; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  .sub { color: #888; margin-top: 0; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #0b0c10; color: #e4e2dd; padding: 1rem; border-radius: 10px; overflow:auto; font-size: 12.5px; }
  ol { padding-left: 1.2rem; } li { margin: .2rem 0; }
  .chips a { display:inline-block; margin: .2rem .4rem .2rem 0; padding:.35rem .7rem; border:1px solid #8884; border-radius:999px; text-decoration:none; }
  .badge { display:inline-block; padding:.15rem .5rem; border-radius:6px; background:#99411e22; color:#99411e; font-size:.8rem; font-weight:600; }
</style>
</head>
<body>
  <h1>🪙 Skimflow — Agent Entry Point</h1>
  <p class="sub">${esc(b.description)}</p>
  <p><span class="badge">${esc(b.protocol)} v${esc(String(b.x402_version))}</span> &nbsp; <span class="badge">${esc(b.network)}</span> &nbsp; <span class="badge">${esc(b.asset)}</span></p>
  <p class="sub">Pricing: ${esc(b.pricing.model)} in ${esc(b.pricing.currency)} — ${esc(b.pricing.min_per_block)}–${esc(b.pricing.max_per_block)} per block; ${esc(b.pricing.free_preview)}.</p>

  <p><strong>${esc(b.readme)}</strong></p>

  <h2>How it works</h2>
  <ol>${steps}</ol>

  <h2>Start here</h2>
  <p class="chips">
    ${link(b.catalog, "Catalog (skills for sale)")}
    ${link(b.manifest, "Payment manifest")}
    ${link(b.preview_example, "Preview example (free)")}
    ${link(b.paid_example, "Paid example (402)")}
  </p>

  <h2>Machine-readable</h2>
  <p>This same page returns JSON with <code>Accept: application/json</code> or <code>?format=json</code>:</p>
  <pre>${esc(JSON.stringify(b, null, 2))}</pre>
</body>
</html>`;
}
