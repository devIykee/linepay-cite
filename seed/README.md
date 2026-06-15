# Seed content

The canonical seed lives in [`../scripts/seed.mjs`](../scripts/seed.mjs) and is loaded
by POSTing to the running server (`npm run seed`), so it always matches the
server's database.

It creates:

- **4 creators** — `@ada_writes`, `@satoshi_serializes`, `@indie_mira`, `@novelist_kai`
- **8 articles** on nanopayments, x402, Arc/USDC settlement, revenue splits, Guardian policy, pricing, and citations
- **2 light-novel chapters** — *The Clockwork Archive*, Ch. 1 & 2 (series `the-clockwork-archive`)

Prices range from `$0.00003` to `$0.0001` per line, with the first 3 lines free.

To add your own content, use the Creator portal at `/creators` or `POST /api/content`.
