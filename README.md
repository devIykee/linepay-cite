# LinePay Cite 🪙📖

### *Get paid every time someone reads a line of your story. Your readers pay per line — agents welcome.*

A dual-sided nanopayment platform for the **Lepton Hackathon**, built on **x402 + Circle Gateway + USDC on Arc**.

- **Creators** put an x402 paywall on articles and light-novel chapters and earn **per line read** ($0.00001–$0.0005), with automatic revenue splits.
- **An autonomous buyer agent** takes a query (or *"continue reading X"*), discovers paywalled sources, judges relevance, clears a **Guardian** spend policy, pays the micro-amount via x402, extracts the text, and returns a **cited** answer or continued reading experience.

Everything runs out of the box in **simulate mode** (no keys), and flips to **real Arc testnet USDC** by setting a few env vars.

---

## Why this matters

Writers earn almost nothing from readers — and *nothing* from the AI agents now consuming their work in tiny chunks. Subscriptions are too coarse to price a single essay, let alone a single paragraph. **Nanopayments on Arc** make the unit of sale as small as the unit of attention. LinePay Cite shows both sides of that future working in real time: a human or an AI agent paying a writer, per line, gas-free.

**Heavy Circle/Arc usage:** Arc testnet (USDC settlement), Circle Gateway (gas-free batched nanopayments, $0.000001 floor), x402 (pay-per-request), Circle Agent Stack (buyer-agent wallet), and an on-chain Circle Contracts revenue split.

---

## Quick start (one command)

> Requires Node ≥ 20.6.

```bash
cd lepton-linepay-cite
bash scripts/setup.sh
```

This installs deps, copies `.env`, starts the dev server, seeds **4 creators / 8 articles / 2 novel chapters**, and prints the URLs. Then open **http://localhost:3000/demo** and click **Run agent**.

Run the agent from the CLI (watch its full chain-of-thought):

```bash
npm run agent -- "How do nanopayments change online writing?"
npm run agent -- "continue reading The Clockwork Archive"
```

Manual setup if you prefer:

```bash
cp .env.example .env && cp .env apps/web/.env.local
npm install
npm run dev          # terminal 1
npm run seed         # terminal 2 (server must be running)
```

---

## How a payment flows (x402 + Gateway)

```
Agent ──GET /api/content/c1?lineStart=4&lineEnd=44──▶ Server
Agent ◀──────── 402 Payment Required + x402 quote ──── Server   (asset, amount, payTo, nonce)
  │  Guardian.checkPolicy(quote, spentSoFar)  → APPROVED/BLOCKED  (budget, max $/line, verified)
  │  GatewayClient.createPayment(...)         → signed authorization (gas-free, EIP-712)
Agent ──GET … + X-PAYMENT: <base64 auth>──────────▶ Server
                                  GatewayClient.settle() → USDC on Arc, batched
                                  splitRevenue() 85/10/5  → recorded
Agent ◀── 200 + text + X-PAYMENT-RESPONSE (tx receipt) ── Server
```

The **first 3 lines are free** so the agent (or a human) can judge relevance before paying — without a preview, paywalls get skipped, not paid.

---

## The buyer agent (LangChain.js)

`apps/agent` is an autonomous reading agent. Pipeline (every step is logged and shown in the UI):

1. **Discover** — searches `/api/catalog`.
2. **Preview** — reads the free lines of each candidate.
3. **Evaluate** — decides relevance + worth-paying. Uses **Claude (`claude-opus-4-8`) via `ChatAnthropic`** when `ANTHROPIC_API_KEY` is set; otherwise a deterministic keyword heuristic, so the demo always runs.
4. **Guardian** — hard-enforces budget / max-price-per-line / verified preference **in code** (the LLM can suggest, but the Guardian moves the money).
5. **Pay** — x402 handshake + Circle Gateway settlement on Arc.
6. **Extract & cite** — pulls the text, records the tx hash as provenance.
7. **Synthesize** — a cited answer, or stitched continued-reading prose.

> The agent wallet is a Circle Agent Stack wallet (`AGENT_WALLET_ADDRESS` / `AGENT_WALLET_PRIVATE_KEY`). In simulate mode no signature is needed.

---

## Guardian Lite (policy)

JSON policy enforced before every payment (`GET/PUT /api/policy`):

```json
{
  "budgetBaseUnits": "5000",     // $0.005 per run
  "maxPricePerLine": "200",      // $0.0002 / line
  "maxPerPurchase": "2000",      // $0.002 / purchase
  "requireVerified": false,
  "allowedCreators": [],
  "blockedCreators": []
}
```

---

## Going live on Arc testnet

1. **Provision Arc** with the ARC CLI:
   ```bash
   arc network use testnet
   arc account create            # deployer + platform/referrer wallets
   ```
   Put the RPC URL, chain id, and USDC address into `.env` (`ARC_RPC_URL`, `ARC_CHAIN_ID`, `USDC_ADDRESS`).
2. **Circle Gateway / Agent Stack:** set `CIRCLE_API_KEY`, fund `AGENT_WALLET_ADDRESS` with testnet USDC, set `AGENT_WALLET_PRIVATE_KEY`.
3. **Deploy the revenue split:**
   ```bash
   npm run contracts:compile
   npm run contracts:deploy          # prints REVENUE_SPLIT_ADDRESS
   ```
   Add `REVENUE_SPLIT_ADDRESS` to `.env` — the x402 endpoint will now route payments through the on-chain 85/10/5 split.
4. **Flip the switch:** set `PAYMENTS_MODE=live`. Restart. Payments now settle real USDC on Arc, gas-free via Gateway.

The same code path runs in both modes — only `PAYMENTS_MODE` and the presence of `ARC_RPC_URL` differ (`packages/sdk/src/arc.ts`).

---

## Marketing angles (target writers + light-novel authors)

**For X / Twitter article writers:**
> "Stop giving your essays to AI scrapers for free. Put one line behind LinePay and every agent that reads it pays you — automatically, per line, in USDC. 🧵"

**For light-novel authors (Royal Road, Scribble Hub, self-hosted):**
> "Readers binge your chapters one line at a time. Now they *pay* one line at a time. Free preview, then $0.00003 a line. Agents welcome — they tip best."

**Taglines:** *"Get paid every time someone reads a line of your story."* · *"Your readers pay per line — agents welcome."* · *"Subscriptions are too coarse. Price your prose by the line."*

Distribution: reply-guy on AI-scraping outrage threads with a one-click "protect this post" link; partner with serial-fiction communities; a "verified creator" badge that agents are configured to prefer.

---

## 3-minute demo video script

1. **0:00 — Hook (20s).** "Writers earn nothing when AI reads their work. Watch us fix that — live, on Arc." Show the landing page tagline.
2. **0:20 — Creator side (40s).** Open `/creators`. Register `@ada_writes`, paste a short essay, set `$0.00005/line`, publish. Point out the line count and free-preview setting.
3. **1:00 — Agent side (70s).** Open `/demo`. Type *"How do nanopayments change online writing?"*, hit **Run agent**. Narrate the chain-of-thought as it reveals: discover → preview → **evaluate (Claude)** → **Guardian APPROVED** → **pay $0.00X via Circle Gateway on Arc** → extract → cite. Show the tx hash.
4. **2:10 — Money lands (30s).** Switch to `/creators`, show `@ada_writes` earnings ticking up and the transaction history with the agent's tx. Show the live payment feed on the demo page.
5. **2:40 — Continue-reading (15s).** Run *"continue reading The Clockwork Archive"* — the agent buys the next chapter's lines and stitches the prose.
6. **2:55 — Close (5s).** "x402 + Circle Gateway + Arc. Per-line pay for writers. Agents welcome." Repo link.

---

## API reference (selected)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/content/:id?lineStart&lineEnd` | x402-protected per-line read (402 → pay → 200) |
| `POST` | `/api/content` | publish content (Markdown, priced per line) |
| `POST` | `/api/creators` | register/update a creator |
| `GET` | `/api/creators/:handle/earnings` | earnings dashboard data |
| `GET` | `/api/catalog` | discovery surface (no bodies) |
| `GET` | `/api/feed` | live nanopayment feed |
| `GET/PUT` | `/api/policy` | Guardian policy |
| `POST` | `/api/research` | ⭐ run the autonomous buyer agent |

---

## Tech stack

Next.js 15 · TypeScript · LangChain.js (`@langchain/anthropic`, Claude `claude-opus-4-8`) · viem · better-sqlite3 · Solidity (Hardhat) · Tailwind · Circle Gateway · x402 · USDC on Arc.

## Repo layout note

`packages/sdk` ships as raw TypeScript and is consumed by both apps via npm workspaces (`transpilePackages`). The same `GatewayClient` is the **client** (signs authorizations) in the agent and the **server** (verifies + settles) in the web API.

---

Built for the Lepton Hackathon. Simulate mode is for the judges' convenience; the on-chain path is real Arc testnet USDC via Circle Gateway.
