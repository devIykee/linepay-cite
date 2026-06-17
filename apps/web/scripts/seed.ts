/**
 * Seed sample creators + content directly into Postgres (chunk system).
 *
 *   npm run db:seed            (from apps/web)
 *
 * Idempotent: skips content seeding if any published content already exists.
 * Inserts creator users directly (no OAuth needed for the demo dataset).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pool, query, queryOne } from "../lib/db.js";
import { createContent } from "../lib/store.js";
import { chunkContent } from "../lib/chunk-content.js";

function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const GATEWAY =
  process.env.CIRCLE_GATEWAY_ADDRESS ||
  process.env.GATEWAY_WALLET_ADDRESS ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

const CREATORS = [
  { email: "ada@example.com", handle: "ada_writes", name: "Ada Quill", wallet: "0xada0000000000000000000000000000000000001", verified: true },
  { email: "satoshi@example.com", handle: "satoshi_serializes", name: "S. Nakareader", wallet: "0x5a70000000000000000000000000000000000002", verified: true },
];

const ARTICLES = [
  {
    creator: "ada@example.com",
    slug: "why-nanopayments-beat-subscriptions",
    title: "Why Nanopayments Beat Subscriptions for Writers",
    summary: "The economics of charging per paragraph instead of per month.",
    tags: "nanopayments,economics,writing,arc",
    price: "0.05",
    body: [
      "Subscriptions are a blunt instrument. A reader who wants one article must commit to a month; a writer who publishes weekly must justify a recurring charge. Most readers never convert.",
      "Nanopayments invert this. Instead of asking for $5/month, you ask for a few cents per block. A long essay costs pennies to read in full, and the reader pays only for what they actually consume.",
      "On Arc, Circle Gateway batches these micro-charges so neither side pays gas per read. The settlement floor is a single USDC base unit, small enough to price a single paragraph.",
      "The result: long-tail writing becomes economically viable. Niche essays that would never sustain a subscription can still earn, because the unit of sale shrinks to match the unit of attention.",
      "Agents change the math again. An AI research agent reading ten sources will happily pay a few cents each if every source is relevant, far more than any of those writers would earn from ad impressions.",
    ].join("\n\n"),
  },
  {
    creator: "ada@example.com",
    slug: "designing-an-x402-paywall",
    title: "Designing an x402 Paywall That Agents Respect",
    summary: "Practical patterns for HTTP 402 + Circle Gateway.",
    tags: "x402,paywall,http,agents,gateway",
    price: "0.04",
    body: [
      "The x402 protocol revives HTTP's long-dormant 402 status code. A client requests a resource; the server replies 402 with a machine-readable quote describing exactly what payment unlocks it.",
      "For agents, the quote is everything. It must state the asset, amount, recipient, and gateway, enough for the agent to reason about cost before committing funds.",
      "Keep the first block free. Agents need a preview to judge relevance; a paywall with no teaser gets skipped, not paid.",
      "Settle through Circle Gateway so the payment is gas-free and batched, then reconcile from the confirmed webhook. Done well, the paywall is invisible to humans and legible to machines.",
    ].join("\n\n"),
  },
];

const AGENT_SKILLS = [
  {
    creator: "satoshi@example.com",
    slug: "solidity-security-skills",
    title: "Solidity Security Skills",
    summary: "A pay-per-block skill file teaching agents to audit Solidity.",
    tags: "solidity,security,audit,agent-skills",
    price: "0.05",
    body: [
      "## Skill: Reentrancy detection\nScan for external calls that precede state updates. Flag any function that transfers value before zeroing balances. Recommend the checks-effects-interactions pattern and a reentrancy guard.",
      "## Skill: Integer overflow review\nFor pre-0.8 Solidity, require SafeMath on all arithmetic. For 0.8+, flag unchecked blocks and verify the math inside them cannot wrap.",
      "## Skill: Access control audit\nEnumerate every state-changing function and confirm an explicit modifier (onlyOwner / role check) guards it. Flag any privileged function with no guard.",
      "## Skill: Oracle manipulation\nIdentify price reads from a single AMM spot price. Recommend a TWAP or a multi-source oracle and flag flash-loan-exploitable assumptions.",
    ].join("\n\n"),
  },
];

async function upsertCreator(c: (typeof CREATORS)[number]): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (email, name, display_name, handle, wallet_address, role, verified)
       VALUES ($1,$2,$2,$3,$4,'creator',$5)
     ON CONFLICT (email) DO UPDATE SET wallet_address = EXCLUDED.wallet_address, verified = EXCLUDED.verified
     RETURNING id`,
    [c.email, c.name, c.handle, c.wallet, c.verified]
  );
  return row!.id;
}

async function main() {
  const existing = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM content WHERE status='published'`);
  if (Number(existing?.count ?? 0) > 0) {
    console.log(`✓ ${existing?.count} published item(s) already exist — skipping seed.`);
    process.exit(0);
  }

  const ids: Record<string, string> = {};
  for (const c of CREATORS) {
    ids[c.email] = await upsertCreator(c);
    console.log(`  creator @${c.handle}`);
  }

  for (const a of ARTICLES) {
    const chunks = chunkContent({ content: a.body, format: "article" });
    await createContent({
      creatorId: ids[a.creator],
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      tags: a.tags,
      contentType: "article",
      body: a.body,
      pricePerBlock: a.price,
      gatewayAddress: GATEWAY,
      chunks: chunks.map((c, i) => ({ text: c.text, isFree: i === 0 })),
      firstBlockIndex: 0,
      status: "published",
    });
    console.log(`  article "${a.title}" (${chunks.length - 1} payable blocks @ ${a.price})`);
  }

  for (const s of AGENT_SKILLS) {
    const chunks = chunkContent({ content: s.body, format: "markdown" });
    await createContent({
      creatorId: ids[s.creator],
      slug: s.slug,
      title: s.title,
      summary: s.summary,
      tags: s.tags,
      contentType: "agent-skills",
      body: s.body,
      pricePerBlock: s.price,
      gatewayAddress: GATEWAY,
      chunks: chunks.map((c) => ({ text: c.text, isFree: false })),
      firstBlockIndex: 1,
      status: "published",
    });
    console.log(`  agent-skills "${s.title}" (${chunks.length} blocks @ ${s.price}) → /read/${s.slug}/agent-skills.md`);
  }

  console.log(`\n✓ Seeded ${CREATORS.length} creators, ${ARTICLES.length} articles, ${AGENT_SKILLS.length} agent-skills file(s).`);
  await pool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e?.message ?? e);
  process.exit(1);
});
