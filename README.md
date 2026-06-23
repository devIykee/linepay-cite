# Skimflow 🪙📖

### *Pay-per-block reading for people and AI agents. The smallest unit of writing, finally sellable.*

Skimflow makes the smallest unit of content — a single **block** (a few paragraphs, one image, one page of a book) — sellable on its own. Creators publish articles, photo essays, agent skills, and books behind an **x402** paywall; **both human readers and AI agents** pay **per block** (from $0.000001), settled gas-free as **USDC on Arc** through **Circle Gateway**, with an automatic **80/12/5/3** revenue split. The payment floor that forced everything into $10/month subscriptions is gone — so the smallest unit of value is finally worth moving.

For humans the crypto disappears: one tap sets up a session, and every block after unlocks **with no wallet popup**, drawn from a "reading fuel" gauge. For agents, three machine-readable endpoints turn the whole catalog into a pay-per-request API.

Runs **end-to-end out of the box in simulate mode** (no keys, no funds), and flips to **real Arc testnet USDC** with a few env vars.

🔗 **Live:** [skimflow.vercel.app](https://skimflow.vercel.app)

📚 **Docs:** [Creator guide](https://skimflow.vercel.app/docs) · [Partners & Developers](https://skimflow.vercel.app/partners) ([md](docs/PARTNERS.md)) · [White paper](https://skimflow.vercel.app/whitepaper) ([md](docs/WHITEPAPER.md)) · [Circle tooling feedback](CIRCLE_FEEDBACK.md)

> ⚠️ **Testnet only.** Everything targets **Circle's Arc testnet** (chain id `5042002`). All USDC is **test USDC** with no real-world value. Contracts deploy to testnet only; every deploy script runs an `assertTestnet` guard that refuses known mainnet chain ids.

---

## Quick start (one command)

> Requires Node ≥ 20.6 and Docker (for the local Postgres — auto-started if you have no `DATABASE_URL`).

```bash
cd skimflow
npm install
npm run up            # ensures a DB, migrates, seeds demo content, starts the server
```

`npm run up` is zero-config: if `DATABASE_URL` isn't set, it boots a local Postgres in Docker; if it is (e.g. Supabase), it uses that and skips Docker. Then open:

- **http://localhost:3000/for-you** — the feed: articles, agent skills, Skimflow photo essays, and books.
- **http://localhost:3000/read/&lt;slug&gt;** — read a piece, hit the paywall, unlock block-by-block (you are the reader).
- **http://localhost:3000/dashboard** — publish content, watch earnings, manage your wallet.
- **http://localhost:3000/docs** — the creator + agent-integration guide.

Useful variants:

```bash
npm run up:fresh                 # reset the local Docker DB + .next, then start
bash scripts/dev.sh --traffic    # also generate simulate-mode demo unlocks (off by default)
npm run db:seed:chioma           # add the @chiomawrites sample set (articles, skills, 2 books, photo essays)
npm run db:purge-demo            # DRY RUN: show all demo/seed data; add `-- --yes` to delete it
```

Drive the **buyer agent** against your running server (full reasoning + payment trace):

```bash
npm run agent -- --url http://localhost:3000 --slug <agent-skill-slug> --simulate
npm run test:x402 -- --url http://localhost:3000 --slug <agent-skill-slug> --simulate   # spec-compliance harness
```

---

## What you can publish

| Type | Unit sold | Reader experience |
|---|---|---|
| **Article** | a chunk (~6 lines / 400 words) | vertical reader; block 0 free, the rest blur until unlocked |
| **Agent Skills** | a skill block | a `.md` endpoint agents pay per block to read |
| **Skimflow** | one image | a photo essay; first image free, each next image is a paid unlock |
| **Book** | one page | full-screen Moon+-style reader (chapters → pages), swipe/keys to turn |

The first block of anything is a **free preview**. The only price ever shown to a human is the optional **"unlock the whole piece"** upsell (a 5% bulk discount); per-block unlocks just say **"Read on."**

---

## How payments work

**Silent per-block payments (humans).** A reader does a **one-time setup**: deposit USDC into their Circle **Gateway** balance and `addDelegate` a locally-generated **session key**. After that, each block unlocks by having the session key sign an EIP-712 **burn intent** that a relayer settles through Gateway — **no wallet popup per block**. The UI shows a **"reading fuel"** battery gauge (a friendly face over the raw USDC balance), warns when it runs low, and offers a one-tap top-up. End the session anytime; the Gateway balance stays put and "Read on" silently resumes against it.

**Wallets.** Signed-in readers get a **Circle embedded wallet** (W3S, PIN-secured, no download) by default; power users can connect an **external wallet** (RainbowKit/Wagmi). The silent-pay path is identical for both.

**Revenue split — 80/12/5/3.** Every payment splits **creator 80% · platform 12% · referrer 5% · reserve 3%**, routed on-chain through the `RevenueSplit` contract. With no referrer it's **80/12/0/8** (the referrer's share rolls into reserve). Creators (and admins) read their own work free.

**Simulate vs live.** The same code path runs in both modes; only `PAYMENTS_MODE` + the Circle/Arc env vars differ. Simulate needs no keys or funds (great for review); live settles **real test USDC** on Arc.

---

## For AI agents (x402)

Agents discover and pay for content without scraping the HTML, via three endpoints:

| Endpoint | What it is |
|---|---|
| `/deploy` | **single entry point** — hit this one URL and you have everything: protocol, catalog, manifest, and a worked example. JSON by default, HTML in a browser. |
| `/.well-known/agent-payment.json` | **how to pay** — protocol (`x402`), settlement (`circle-gateway-eip3009`), network (`eip155:5042002`), USDC + gateway addresses, the `GatewayWalletBatched` EIP-712 domain |
| `/.well-known/agent-skills.json` | **what's for sale** — a machine-readable catalog of agent skills: slug, price, payable blocks, `preview_url`, `resource_url_pattern`, `pay_to` |
| `/read/{slug}/agent-skills.md` | the resource itself — **block 0 free**; `?block=n` (n ≥ 1) returns a **402 quote**, then the unlocked block once an `X-Payment` header is supplied |

The flow is the canonical x402 loop: **GET → 402 quote → sign EIP-3009 / build burn intent → retry with `X-Payment` → 200 + content**, with an `X-Payment-Response` receipt. Every Agent Skill card in the feed and on the detail page has a **"Share with Agent"** button that copies this exact payload for pasting into an agent's context.

**The buyer agent** (`apps/agent`, LangChain) runs the loop autonomously under a **Guardian spend policy** (`packages/sdk/src/guardian.ts`) — it clears every payment through `checkPolicy` (per-purchase + total budget) before it pays. `npm run test:x402` asserts spec-compliance at each step and exits non-zero on failure (CI-friendly).

---

## Routes

`/` · `/for-you` (feed) · `/read/[slug]` (reader — articles, agent-skills, Skimflow, books) · `/dashboard` (publish / earnings / wallet) · `/dashboard/create-book` (chapter builder) · `/dashboard/settings` · `/docs` · `/marketplace` · `/login` · `/terms` · `/admin/*` (moderation, payments, users, wallets, agents)

## API reference (selected)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/reader/:slug` | per-block unlock: quote → settle (silent session-key, direct tx, or whole-piece) |
| `GET` | `/read/:slug/agent-skills.md?block=n` | x402-protected agent read (402 → pay → 200) |
| `GET` | `/.well-known/agent-payment.json` · `/.well-known/agent-skills.json` | agent discovery: how to pay · what's for sale |
| `POST` | `/api/pay-session/init` · `/resume` · `/revoke` · `GET /balance` | reading-fuel session lifecycle |
| `GET` | `/api/wallet/overview` · `/api/wallet/balance` | wallet balances + history; deposit-notification poll |
| `POST` | `/api/wallet/embedded` · `/embedded/setup` · `/embedded/confirm` | Circle embedded-wallet provisioning |
| `POST` | `/api/creator/content` · `PATCH/GET/DELETE /api/creator/content/:id` | publish / edit / load / remove content |
| `POST` | `/api/import-url` | import a Medium article or GitHub `.md` skill |
| `GET` | `/api/marketplace` · `/api/marketplace/search` | feed listing + search |
| `POST` | `/api/webhooks/circle` | Circle settlement webhook (finalizes pending live payments) |

## Going live on Arc

1. Point at the Arc testnet RPC (`https://rpc.testnet.arc.network`) and get test USDC from `faucet.circle.com`. Set `ARC_RPC_URL` / `ARC_CHAIN_ID` (`5042002`) and a funded `DEPLOYER_PRIVATE_KEY` in `.env`.
2. Deploy the revenue split and set `REVENUE_SPLIT_ADDRESS`:
   ```bash
   npm run contracts:compile && npm run contracts:deploy
   ```
   (A `RevenueSplit` is already live on Arc testnet at `0xBe1b9f844341701c36ee86F5248a0f9F1628C1E4`.)
3. Configure Circle Gateway: `CIRCLE_API_KEY`, the relayer / seller keys, and the Gateway base `https://gateway-api-testnet.circle.com`. Settlement uses `POST /v1/x402/settle` with EIP-3009 authorizations against the `GatewayWalletBatched` v1 domain (`packages/sdk/src/gateway.ts`).
4. Flip the switch: `PAYMENTS_MODE=live` and `NEXT_PUBLIC_PAYMENTS_MODE=live`. Restart. Payments now settle real **test** USDC on Arc, gas-free via Gateway.

> 🔐 **Never commit or paste API keys / private keys.** Secrets live only in the gitignored repo-root `.env` (`apps/web/.env.local` is a symlink to it). Rotate any exposed key in the Circle console.

## Architecture

```
apps/web        Next.js 15 (App Router, React 19) · Postgres · NextAuth · Tailwind design tokens
                ├─ silent per-block pay sessions (Gateway burn intents)
                ├─ Circle embedded wallets (W3S) + external (RainbowKit/Wagmi)
                ├─ x402 well-known endpoints + agent-skills.md resource
                └─ creator dashboard, Books builder, admin/moderation suite
apps/agent      LangChain buyer agent · x402 client · Guardian spend policy · test:x402 harness
packages/sdk    arc · gateway (x402 /v1/x402/settle, EIP-3009) · guardian · x402 · pricing
contracts       RevenueSplit.sol (live 80/12/5/3 router) · AgentMarketplace.sol · MockUSDC.sol (Hardhat)
db/migrations   0001…0011 (users, pay-sessions, embedded wallets, settlement retry, reports, images, books)
```

## Tech stack

Next.js 15 · React 19 · TypeScript · PostgreSQL (`pg`) · NextAuth · Tailwind (editorial design system) · LangChain.js (Groq / Claude) · RainbowKit + Wagmi / Viem · Solidity (Hardhat, OpenZeppelin) · **Circle Gateway (`/v1/x402/settle`, EIP-3009) · x402 · Circle embedded Wallets (W3S) · USDC on Arc**.


