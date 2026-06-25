/**
 * Part 2 end-to-end: drives the real GET /api/articles/:postId/full-content
 * handler against the DB through every path: 402 quote, free-article 200,
 * simulated-payment 200 (with paid blocks), and 503 (creator without wallet).
 *
 * Run: npx tsx scripts/test-fullcontent-db.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.PAYMENTS_MODE = "simulate";

import { NextRequest } from "next/server";
const { GET } = await import("../app/api/articles/[postId]/full-content/route.js");
const store = await import("../lib/store.js");
const { query } = await import("../lib/db.js");
const { toBaseUnits, toDecimal } = await import("../lib/money.js");

let failures = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "✅" : "❌"} ${m}`);
  if (!c) failures++;
};

const WALLET = "0x1111111111111111111111111111111111111111";
const PRICE = "0.05";

async function mkCreator(wallet: string | null) {
  const r = await query<{ id: string }>(
    `INSERT INTO users (email, role, display_name, handle, wallet_address)
     VALUES ($1,'creator','Cite Test',$2,$3) RETURNING id`,
    [`cite-${process.hrtime.bigint().toString(36)}@example.com`, `cite${Date.now().toString(36).slice(-5)}${Math.floor(Math.random()*99)}`, wallet]
  );
  return r[0].id;
}
async function mkArticle(creatorId: string, opts: { paid: boolean }) {
  const chunks = opts.paid
    ? [
        { text: "Free teaser block.", isFree: true },
        { text: "Paid block one — secret sauce.", isFree: false },
        { text: "Paid block two — more secrets.", isFree: false },
      ]
    : [{ text: "All free intro.", isFree: true }];
  const c = await store.createContent({
    creatorId, slug: `cite-${Date.now().toString(36)}-${Math.floor(Math.random()*9999)}`, title: "Cite Me", summary: "", tags: "",
    contentType: "article", body: "x", pricePerBlock: opts.paid ? PRICE : "0",
    chunks, firstBlockIndex: 0, status: "published",
  });
  return c.id;
}

function reqFor(postId: string, headers?: Record<string, string>) {
  return new NextRequest(`https://skimflow.test/api/articles/${postId}/full-content`, { headers });
}
const params = (postId: string) => ({ params: Promise.resolve({ postId }) });

const created: string[] = [];
try {
  // ── 1. Paid article, no payment → 402 with X-Payment-* headers ─────────────
  {
    const creatorId = await mkCreator(WALLET);
    created.push(creatorId);
    const postId = await mkArticle(creatorId, { paid: true });
    const res = await GET(reqFor(postId), params(postId));
    ok(res.status === 402, `unpaid paid-article → 402 (got ${res.status})`);
    ok(res.headers.get("X-Payment-Required") === "true", "402: X-Payment-Required: true");
    ok(res.headers.get("X-Payment-Amount") === toDecimal(toBaseUnits(PRICE) * 2n), `402: X-Payment-Amount = ${res.headers.get("X-Payment-Amount")} (2×${PRICE})`);
    ok(res.headers.get("X-Payment-Currency") === "USDC", "402: X-Payment-Currency: USDC");
    ok(res.headers.get("X-Payment-Network") === "ARC-TESTNET", "402: X-Payment-Network: ARC-TESTNET");
    ok((res.headers.get("X-Payment-Address") ?? "").toLowerCase() === WALLET, "402: X-Payment-Address = creator wallet");
    const body = await res.json();
    ok(Array.isArray(body.accepts) && body.x402Version === 2, "402: x402 v2 body with accepts[]");
    // No paid text in the 402 body.
    ok(!JSON.stringify(body).includes("secret sauce"), "402: no paid block text leaked");
  }

  // ── 2. Free article → 200 directly, no payment ─────────────────────────────
  {
    const creatorId = await mkCreator(WALLET);
    created.push(creatorId);
    const postId = await mkArticle(creatorId, { paid: false });
    const res = await GET(reqFor(postId), params(postId));
    ok(res.status === 200, `free article → 200 (got ${res.status})`);
    const body = await res.json();
    ok(body.blocks.length === 1 && body.blocks[0].isFree, "free: single free block returned");
  }

  // ── 3. Paid article, simulated valid X-Payment → 200 with paid blocks ──────
  {
    const creatorId = await mkCreator(WALLET);
    created.push(creatorId);
    const postId = await mkArticle(creatorId, { paid: true });
    const amount = (toBaseUnits(PRICE) * 2n).toString();
    const authorization = {
      from: "0x2222222222222222222222222222222222222222",
      to: WALLET,
      value: amount,
      validAfter: "0",
      validBefore: "0",
      nonce: "0x" + "00".repeat(32),
    };
    const xPayment = Buffer.from(JSON.stringify({ payload: { authorization, signature: "0x" } }), "utf8").toString("base64");
    const res = await GET(reqFor(postId, { "x-payment": xPayment }), params(postId));
    ok(res.status === 200, `paid w/ valid X-Payment → 200 (got ${res.status})`);
    const body = await res.json();
    ok(body.blocks.length === 3, `paid: all 3 blocks returned (got ${body.blocks?.length})`);
    ok(body.blocks.filter((b: { isFree: boolean }) => !b.isFree).length === 2, "paid: 2 paid blocks present");
    ok(JSON.stringify(body).includes("secret sauce"), "paid: paid block text now delivered");
    ok((body.creatorWalletAddress ?? "").toLowerCase() === WALLET, "paid: creatorWalletAddress = creator wallet");
    ok(typeof body.settledAt === "string" && typeof body.wordCount === "number", "paid: settledAt + wordCount present");
    ok(!!res.headers.get("X-Payment-Response"), "paid: X-Payment-Response receipt attached");
  }

  // ── 4. Paid article, wrong amount → 402 (amount_mismatch) ──────────────────
  {
    const creatorId = await mkCreator(WALLET);
    created.push(creatorId);
    const postId = await mkArticle(creatorId, { paid: true });
    const authorization = { from: "0x2222222222222222222222222222222222222222", to: WALLET, value: "1", validAfter: "0", validBefore: "0", nonce: "0x" + "00".repeat(32) };
    const xPayment = Buffer.from(JSON.stringify({ payload: { authorization, signature: "0x" } }), "utf8").toString("base64");
    const res = await GET(reqFor(postId, { "x-payment": xPayment }), params(postId));
    ok(res.status === 402, `underpay → 402 (got ${res.status})`);
    const body = await res.json();
    ok(body.error === "amount_mismatch", "underpay: amount_mismatch error");
  }

  // ── 5. Creator with NO wallet → 503 (no platform fallback) ─────────────────
  {
    const creatorId = await mkCreator(null);
    created.push(creatorId);
    const postId = await mkArticle(creatorId, { paid: true });
    const res = await GET(reqFor(postId), params(postId));
    ok(res.status === 503, `no creator wallet → 503 (got ${res.status})`);
    const body = await res.json();
    ok(body.error === "creator_wallet_unavailable", "503: creator_wallet_unavailable");
  }
} finally {
  for (const id of created) {
    await query(`DELETE FROM content WHERE creator_id = $1`, [id]);
    await query(`DELETE FROM users WHERE id = $1`, [id]);
  }
  console.log(failures === 0 ? "\nALL PASS (cleaned up)" : `\n${failures} FAILURE(S) (cleaned up)`);
  process.exit(failures === 0 ? 0 : 1);
}
