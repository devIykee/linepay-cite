# Skimflow — Partners, Developers & Marketers

> This is the **integration and go-to-market** guide. It is intentionally separate from the in-app **creator guide** (`/docs`, "get paid for your writing") and from the [white paper](./WHITEPAPER.md) (the economic + technical thesis). If you want to *build on* Skimflow, *resell/distribute* it, or *co-market* with us, start here.

**One line:** Skimflow turns a single block of content — a few paragraphs, one image, one page of a book — into something a human *or* an AI agent can buy for a fraction of a cent, settled instantly as USDC on Arc through Circle Gateway.

- **Live:** https://skimflow.vercel.app
- **Agent entry point:** https://skimflow.vercel.app/deploy
- **Network:** Arc testnet (`eip155:5042002`), USDC, x402 v2

---

## Who this is for

| You are… | What you get from Skimflow | Jump to |
|---|---|---|
| An **agent / app developer** | A pay-per-request content API your agent can discover and pay for autonomously (x402 + Gateway). | [Build an agent](#1-build-an-agent-buyer-side) |
| A **publisher / platform** | A drop-in monetization layer: per-block paywalls, USDC payouts, automatic splits — no subscriptions, no Stripe, no chargebacks. | [Sell content](#2-sell-content-creatorpublisher-side) |
| An **OSS / self-hosted community** | A way to pay the people who make the work, attached from the outside via the webhooks/APIs you already expose. | [Distribution sidecars](#3-distribution-sidecars-attach-payments-from-the-outside) |
| A **marketer / BD / partner** | A built-in on-chain referral rail (earn the referrer cut), clear segments, and a concrete pitch. | [For marketers & partners](#for-marketers--partners) |

---

# For developers

## 0. The 60-second mental model

- The unit of sale is a **block**. Block 0 of anything is a **free preview**. Blocks 1…N are paid.
- Humans pay **silently**: one-time setup (deposit + delegate a session key), then every block unlocks with no popup, drawn from a "reading fuel" balance.
- Agents pay over **x402**: `GET` a paid block → `402` quote → sign an **EIP-3009** USDC authorization → retry with an `X-Payment` header → `200` + content.
- Both settle through **Circle Gateway** (gas-free, batched) and split on-chain **80/12/5/3** (creator / platform / referrer / reserve).

Everything an agent needs is reachable from **one URL: `/deploy`**.

## 1. Build an agent (buyer side)

### Discover
```bash
curl https://skimflow.vercel.app/deploy                       # entry point (JSON or HTML)
curl https://skimflow.vercel.app/.well-known/agent-payment.json   # how to pay
curl https://skimflow.vercel.app/.well-known/agent-skills.json    # what's for sale (catalog)
```

`/.well-known/agent-skills.json` returns a list of services, each self-describing:

```json
{
  "name": "Skill: Revising a Time-Loop Narrative",
  "slug": "revising-a-time-loop-narrative",
  "price_per_block": "0.05",
  "currency": "USDC",
  "payable_blocks": 4,
  "preview_url": "https://skimflow.vercel.app/read/revising-a-time-loop-narrative/agent-skills.md",
  "resource_url_pattern": "https://skimflow.vercel.app/read/revising-a-time-loop-narrative/agent-skills.md?block={n}",
  "pay_to": "0x…",
  "payment_header": "X-Payment",
  "x402_version": 2
}
```

### Preview (free)
```bash
curl "https://skimflow.vercel.app/read/<slug>/agent-skills.md"   # block 0, no payment
```

### Pay (the x402 loop)
1. `GET …/agent-skills.md?block=1` with no `X-Payment` → **HTTP 402** with an `accepts[]` quote (asset, `amount` in USDC base units, `payTo`, `extra.verifyingContract`). The 402 also carries `X-Agent-Entrypoint: …/deploy` so an agent that lands on a skill page can self-discover everything.
2. Sign an **EIP-3009 `TransferWithAuthorization`** against the `GatewayWalletBatched` v1 EIP-712 domain (`chainId 5042002`, `verifyingContract` = the gateway from the quote), `to = payTo`, `value = amount`.
3. Base64-encode `{ x402Version: 2, payload: { authorization, signature } }` and retry:
   ```
   GET …/agent-skills.md?block=1
   X-Payment: <base64>
   ```
4. `200` returns the block + an `X-Payment-Response` receipt. Repeat until a block returns "no more blocks."

### Don't want to hand-roll it?
Use the reference buyer agent in this repo (`apps/agent`, LangChain):
```bash
npm run agent    -- --url https://skimflow.vercel.app --slug <slug> --simulate   # single skill
npm run research -- "how do nanopayments change writing?" --url https://skimflow.vercel.app --simulate   # multi-source, budget-bounded
npm run test:x402 -- --url https://skimflow.vercel.app --slug <slug> --simulate  # spec-compliance harness
```
The agent clears every payment through a **Guardian spend policy** (`packages/sdk/src/guardian.ts`): per-purchase cap + total budget, evaluated before it pays. Reuse `packages/sdk` (`arc`, `gateway`, `x402`, `guardian`, `pricing`) in your own client.

### Compliance notes
- **USDC has 6 decimals**; Arc's **native gas** has 18. Never mix them.
- `maxFee` on a Gateway burn intent has a non-zero floor (~`0.0035` USDC on Arc testnet) — authorize a little headroom.
- The `/v1/x402/settle` body must include `resource` (object) **and** `accepted` inside `paymentPayload` (see `packages/sdk/src/gateway.ts`).

## 2. Sell content (creator/publisher side)

Two integration depths:

**(a) Use the app.** Sign in, publish via the dashboard (articles, agent skills, photo essays, books), or **import** existing work:
```bash
POST /api/import-url   { "url": "https://medium.com/@you/your-post" }   # Medium article → article
POST /api/import-url   { "url": "https://github.com/you/repo/blob/main/SKILL.md" }  # .md → agent skill
```

**(b) Programmatic publish.** `POST /api/creator/content` with `{ title, contentType, body, pricePerBlock, summary, tags, status }` (cookie-authenticated). Edit with `PATCH /api/creator/content/:id`; load with `GET`. The server chunks the body, sets block 0 free, and exposes the agent endpoints automatically.

**Payouts.** Every unlock splits on-chain through `RevenueSplit` (`0xBe1b9f844341701c36ee86F5248a0f9F1628C1E4` on Arc testnet): **creator 80% · platform 12% · referrer 5% · reserve 3%** (no referrer → 80/12/0/8). Creators get a Circle **embedded wallet** (PIN, no download) by default or can connect an external one. No invoices, no chargebacks.

## 3. Distribution sidecars (attach payments from the outside)

The hackathon's thesis: the audiences already exist in open-source, self-hosted communities — they just have no way to move money. You don't fork the project; you attach a **payment sidecar** through the webhooks/plugins/APIs it already exposes, and use Skimflow's per-block settlement underneath. Patterns we're actively interested in partnering on:

- **Per-listen royalties** for a Navidrome/Subsonic server (split by what was actually played).
- **Per-second VOD** for Jellyfin / Owncast / PeerTube (settle elapsed time to rights holders).
- **Citation tolls** for RSSHub / an LLM crawler boundary (pay the source when an answer is grounded in it).
- **Royalties that follow a work** using existing credit metadata (beets / Picard / immich) as the payout rule.

If you maintain or build on one of these, talk to us — this is the fastest path to real traction.

## 4. Running it yourself

```bash
git clone <repo> && cd lepton-linepay-cite
npm install && npm run up          # auto Postgres (Docker), migrate, seed, start — simulate mode, no keys
```
Flip `PAYMENTS_MODE=live` (+ Circle/Arc env) to settle real test USDC. Architecture, env, and contract details are in the [README](../README.md); tooling friction we've reported to Circle is in [`CIRCLE_FEEDBACK.md`](../CIRCLE_FEEDBACK.md).

---

# For marketers & partners

## The pitch (steal this)

> **"Subscriptions exist because payments couldn't be small. Skimflow makes the smallest unit sellable — per article, per image, per page, per call — to humans and to AI agents, settled instantly in USDC. Creators keep 80%. Agents pay autonomously. No floor, no lock-in."**

## Why it's differentiated

- **Two-sided demand from one paywall.** The same per-block endpoint serves humans (silent, no popup) and AI agents (x402). The fastest-growing readers of content are agents — Skimflow is built for both from day one.
- **The crypto disappears for humans.** Embedded wallets + a "reading fuel" gauge mean readers never see gas, signatures, or addresses after a one-time setup.
- **Payouts are instant and global.** USDC on Arc, no Stripe onboarding, no chargebacks, no 30-day holds.

## A built-in affiliate rail (this is the marketer's lever)

Skimflow's revenue split includes a **5% referrer cut that settles on-chain, automatically.** Any share link carries `?ref=<your-id>`; when someone reads through it, you earn 5% of every block they unlock — per read, forever, with no payout reconciliation. For affiliates, newsletters, and communities this is a **self-serve, programmatic affiliate program** with no dashboard to build.

## Segments worth targeting first

1. **AI agent / tool builders** — they need paid data and skills; we're the supply. (RFB 1/2/3.)
2. **Independent writers & newsletters** priced out by the subscription floor. (RFB 6.)
3. **Self-hosted / OSS media communities** with audiences and no payment layer. (Distribution sidecars.)
4. **Photographers & visual creators** — per-image Skimflow essays.

## Co-marketing we're open to

- Joint demos showing an **agent autonomously paying a creator** (great for content, and exactly what hackathon-style audiences want to see).
- Affiliate / revenue-share campaigns using the referral rail above.
- Integration spotlights for any distribution sidecar (we'll feature your project; you bring the audience).
- Case studies on **creators getting paid** and **agents consuming** in test USDC.

## Assets & facts you can quote

- Smallest payment: **$0.000001** (Gateway floor); settlement **< 500 ms** on Arc.
- Split: **80 / 12 / 5 / 3** (creator / platform / referrer / reserve).
- Content types: **articles, agent skills, photo essays (Skimflow), books.**
- Built on **Circle Gateway + x402 + USDC on Arc**; testnet today.

## Talk to us

Open an issue/PR on the repo, or reach the team in the **Canteen Discord** (mention *Skimflow*). For partnership or affiliate inquiries, include: who your audience is, what you'd integrate or promote, and the rough volume you can point to.

> ⚠️ **Testnet only.** All amounts are **test USDC** with no real-world value. Nothing here is financial advice or an offer of securities.
