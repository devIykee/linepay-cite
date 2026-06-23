# Skimflow: Nanopayments for People and Agents
### A pay-per-block content market settled in USDC on Arc

**Version 0.1 (testnet)**

> This white paper sets out the *why* and the *how* behind Skimflow: the economic problem it addresses, the architecture that makes a sub-cent payment practical, and the two-sided market — human readers and autonomous AI agents — that one paywall now serves. It is distinct from the in-app creator guide (`/docs`) and the [partner/developer guide](./PARTNERS.md).

---

## Abstract

For as long as the cheapest payment cost roughly thirty cents to clear, no one could sell a five-cent article or a one-cent image. The only viable move was to **bundle** — a month of content for a flat fee — and hope enough readers converted. Every subscription is a quiet admission that the real unit of value was too small to sell on its own.

Skimflow removes that floor. By settling **USDC on Arc through Circle Gateway** — gas paid in USDC, batched, with sub-second finality — the marginal cost of a payment collapses toward zero, and value as small as **$0.000001** becomes movable. The smallest unit of content (a "block": a few paragraphs, one image, one page) becomes individually sellable. Crucially, the buyer is no longer only a person: **AI agents** can now pay per request via the **x402** protocol, turning "what should this cost?" into a decision a machine makes thousands of times an hour. Skimflow is a content market built for both, from a single per-block paywall.

---

## 1. The problem: the payment floor

Digital content has been trapped between two bad business models:

- **Advertising**, which pays fractions of a cent per impression, demands scale most creators never reach, and misaligns the creator's incentives with the reader's attention.
- **Subscriptions**, which force a reader who wants *one* article into a *monthly* commitment, and force a creator who publishes occasionally to justify a recurring charge. Most readers never convert; most creators never sustain it.

Both exist because the underlying rails could not clear a small payment economically. A card transaction's fixed cost (~$0.30 + percentage) makes anything under a dollar a loss. So the industry bundled, gated, and surveilled — not because that served readers or writers, but because the floor left no alternative.

The cost of the floor is **the long tail**: the niche essay, the single photograph, the one chapter, the specific answer. Work too small or too specific to bundle simply went unmonetized — or unpaid, scraped as free substrate.

## 2. The thesis: the smallest coin reborn

Every historical economy minted a *smallest coin* — struck so ordinary people could buy everyday things like bread, water, and a day's wage. Software has no minting cost, so the smallest unit can shrink indefinitely. The nanopayment is that smallest coin reborn for machines.

Skimflow's claim is narrow and testable: **when the smallest unit of value can move cheaply and instantly, the smallest unit of content becomes sellable — and the market reorganizes around it.** Pricing moves from "a month of everything" to "exactly this block," and the buyer pool expands from humans to agents.

## 3. Why now: Arc + Circle Gateway

Three properties make sub-cent commerce practical for the first time:

1. **USDC-native gas (Arc).** Fees are paid in the same stable asset as the payment, so neither side holds a volatile gas token to read a paragraph.
2. **Gas-free, batched settlement (Circle Gateway).** Micro-charges are authorized off-chain (EIP-3009) and batched on-chain, so per-read gas does not destroy the economics.
3. **Sub-second finality.** Settlement in **< 500 ms** means a payment can sit inside a page turn or an agent's tool call without breaking the experience.

On top of these, **x402** revives HTTP's dormant `402 Payment Required` status into a machine-readable payment handshake — the missing protocol layer that lets an agent reason about cost *before* committing funds.

## 4. The unit: a block

Skimflow's atomic sellable is the **block**:

- **Article** → a chunk (~6 lines / 400 words).
- **Agent skill** → a skill block (a `.md` resource agents read).
- **Skimflow (photo essay)** → one image.
- **Book** → one page (chapters group pages).

**Block 0 of anything is a free preview** — non-negotiable, because both humans and agents need to judge relevance before paying. Blocks 1…N are paid. The only price ever surfaced to a human is an optional **"unlock the whole piece"** bulk discount; individual unlocks simply read "Read on."

Modeling everything as `content (block_count) → chunks (block_index, is_free)` means one ledger, one revenue-split path, one moderation surface, and one set of agent endpoints serve every content type — including books, whose pages are just chunks linked to chapters.

## 5. Architecture

### 5.1 Silent payments for humans (session keys)

A human shouldn't sign a wallet prompt for every paragraph. Skimflow uses a **session-key** model:

1. **One-time setup.** The reader deposits USDC into their Circle **Gateway** balance and `addDelegate`s a locally-generated **session key**.
2. **Per block.** The session key signs an EIP-712 **burn intent**; a relayer settles it through Gateway. No wallet popup.
3. **Reading fuel.** The remaining allowance is shown as a friendly battery gauge, not a raw balance; ending a session keeps the deposit, so "Read on" silently resumes later.

Readers get a **Circle embedded wallet** (W3S, PIN-secured, no download) by default, or connect an external wallet (RainbowKit/Wagmi). The silent-pay path is identical for both. The crypto disappears after setup.

### 5.2 x402 for agents

Agents pay per request through three machine-readable surfaces, all reachable from one entry point (`/deploy`):

- **`/.well-known/agent-payment.json`** — *how to pay*: protocol (`x402`), settlement (`circle-gateway-eip3009`), network (`eip155:5042002`), USDC + gateway addresses, the `GatewayWalletBatched` EIP-712 domain.
- **`/.well-known/agent-skills.json`** — *what's for sale*: a catalog of skills with prices, payable blocks, preview URLs, and `pay_to`.
- **`/read/{slug}/agent-skills.md`** — the resource: block 0 free; `?block=n` returns a **402 quote**, then the unlocked block once an `X-Payment` (base64 EIP-3009 authorization) is supplied, with an `X-Payment-Response` receipt.

The flow is the canonical x402 loop — `GET → 402 → sign → retry → 200` — settled via Circle's `POST /v1/x402/settle`.

### 5.3 One ledger, two payers

A human silent payment and an agent x402 payment converge on the same server logic: verify the authorization for the right amount/recipient, settle through Gateway, write **one** idempotent ledger row (keyed by the burn salt or tx hash; `pending` in live mode → finalized by the Circle webhook; `completed` in simulate), and split on-chain. This is what lets Skimflow be genuinely two-sided rather than two parallel products.

## 6. Economic model

### 6.1 The split: 80 / 12 / 5 / 3

Every payment splits on-chain through the `RevenueSplit` contract:

| Party | Share | Notes |
|---|---|---|
| **Creator** | 80% | the remainder — absorbs rounding dust, never under-pays |
| **Platform** | 12% | sustains the rail |
| **Referrer** | 5% | settles automatically to whoever shared the link |
| **Reserve** | 3% | protocol reserve |

With no referrer, the 5% folds into reserve (**80 / 12 / 0 / 8**), matching the contract.

### 6.2 The referrer rail as native distribution

The 5% referrer cut is not a marketing afterthought — it is a **protocol-level affiliate program**. A share link carries `?ref=<userId>`; resulting unlocks pay the referrer automatically, per read, with no reconciliation. Distribution becomes a first-class, on-chain primitive.

### 6.3 Whole-piece discount

Because per-block pricing can nickel-and-dime a committed reader, Skimflow offers a server-authoritative **bulk discount** (e.g. 5%) to unlock an entire piece in one settlement — the only price ever shown to a human. The server recomputes the discounted total, so a client can never underpay.

### 6.4 Pricing the long tail

At a $0.000001 floor, prices that never made sense before become rational: a single citation, a per-listen royalty, a per-second of video. The unit of sale finally matches the unit of attention.

## 7. The agent economy

Agents change the math twice over. As **consumers**, a research agent reading ten relevant sources will happily pay a few cents each — more than any of those creators would earn from ad impressions. As **autonomous actors**, they make purchase decisions under a budget thousands of times an hour.

Skimflow ships a reference **autonomous buyer agent** that demonstrates the loop end-to-end: it *discovers* the catalog, *previews* candidates for free, *scores* relevance (LLM or heuristic), *selects* sources greedily under a **Guardian spend policy** (per-purchase cap + total budget), *pays* per block over x402, and *synthesizes* a cited answer grounded only in what it paid for. The decision of *what to buy and what to skip* is the agent's — not a hard-coded target.

This opens adjacent designs the rail makes economical for the first time: **citation tolls** (pay the source when an answer is grounded in it), **agent-to-agent** payment for specialized work, and **streaming/per-second** settlement for live compute and media.

## 8. Security & trust

- **Key custody.** Session keys are generated locally and authorized as Gateway delegates; the main wallet's funds never leave the reader's Gateway balance except via signed burn intents. Embedded wallets are PIN-secured via Circle W3S. Secrets (API keys, relayer keys) live only in environment configuration, never in the client or the repo.
- **Authorization integrity.** EIP-3009 / burn-intent signatures are verified server-side for exact amount and recipient before settlement; the server recomputes whole-piece totals so a client cannot underpay.
- **No dead-address leakage.** Payment quotes resolve `payTo` to a real wallet (creator external → embedded → platform reserve) and refuse to ever route to the burn address.
- **Idempotency & finality.** Each payment is keyed by its burn salt or tx hash; live payments are recorded `pending` and finalized only on the confirmed Circle webhook.
- **Moderation.** Content can be suspended (returns 403 for all blocks); substantive edits/removals of already-paid content are gated and audit-logged.

## 9. Comparison

| Model | Smallest viable sale | Buyer | Reader friction | Creator share |
|---|---|---|---|---|
| Advertising | ~$0.002 CPM-equivalent | advertiser | trackers, clutter | low, indirect |
| Subscription | ~$5–10 / month | human | commit a month | platform-dependent |
| Tip jar | ~$1–3 | human | manual, altruistic | high but rare |
| Card paywall | ~$0.30+ | human | card entry per item | minus fees |
| **Skimflow** | **$0.000001** | **human *or* agent** | **none after setup / native for agents** | **80%** |

## 10. Roadmap

- **Streaming / per-second** settlement for live media and compute (continuous authorization).
- **Agent-to-agent** networks: brokers that post a USDC bond and are slashed on under-delivery (on-chain reputation).
- **Retroactive funding & quadratic pools** for content — distributing across a long tail in one sweep, only economical at sub-cent settlement.
- **Distribution sidecars** that attach per-listen / per-view / per-citation payments to existing self-hosted communities from the outside.
- **Mainnet** hardening, audits, and creator payout tooling beyond testnet.

## 11. Conclusion

The floor was never a law of nature; it was a property of the rails. Remove it — with USDC-native gas, gasless batching, sub-second finality, and a payment protocol agents can read — and the smallest unit of content becomes sellable to the smallest, most numerous buyers, human and machine alike. Skimflow is a working demonstration that the smallest coin comes back as the nanopayment.

---

## Appendix A — Protocol & addresses (Arc testnet)

- **Network:** Arc testnet, chain id `5042002` (`eip155:5042002`); native gas in USDC (18 dec); ERC-20 USDC `0x3600000000000000000000000000000000000000` (6 dec).
- **Payment:** x402 v2 over HTTP; `X-Payment` request header (base64 `{ x402Version, payload: { authorization, signature } }`), `X-Payment-Response` receipt.
- **Authorization:** EIP-3009 `TransferWithAuthorization`, signed against the `GatewayWalletBatched` v1 EIP-712 domain (`chainId 5042002`, `verifyingContract` = Gateway).
- **Settlement:** Circle Gateway, `POST /v1/x402/settle`; burn-intent `maxFee` floor ≈ `0.0035` USDC on testnet.
- **Revenue split:** `RevenueSplit` at `0xBe1b9f844341701c36ee86F5248a0f9F1628C1E4`.
- **Gateway (testnet):** Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, Minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`.

## Appendix B — Glossary

- **Block** — the atomic sellable unit (chunk / image / page). Block 0 is always free.
- **Reading fuel** — the consumer-facing view of a reader's remaining silent-spend allowance.
- **Session key** — a locally-generated delegate key authorized to spend from a reader's Gateway balance without per-block prompts.
- **Burn intent** — the EIP-712 message a session key signs to move USDC through Gateway.
- **x402** — HTTP 402-based protocol for machine-payable resources.
- **Guardian policy** — the declarative spend limits (per-purchase + budget) the buyer agent clears every payment through.

---

*Testnet document. All amounts are test USDC with no real-world value. This paper is technical and economic in nature and is not an offer of securities or financial advice.*
