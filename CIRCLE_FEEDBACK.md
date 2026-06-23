# Circle developer-tooling feedback — Skimflow (Lepton Agents Hackathon)

Submitted for the **Feedback Incentives** pool. Everything below is from actually shipping a per-block paywall that settles **real test USDC on Arc** through **Gateway + x402 + embedded Wallets**. Each item is concrete, has a repo reference, and ends with a suggested fix. We've ordered them by how much time they cost us.

Context: Next.js 15 app, both a human reader (Circle embedded wallets, silent session-key payments) and an autonomous buyer agent (x402). `PAYMENTS_MODE=live` settles via `POST /v1/x402/settle`.

---

## 1. `/v1/x402/settle` rejects valid payments unless `paymentPayload` echoes `resource` + `accepted` (highest-cost issue)

**What happened.** The published shape for settlement is `{ paymentPayload, paymentRequirements }`, and `paymentPayload` is described as the base64 `X-Payment` body (`{ x402Version, payload: { authorization, signature } }`). With exactly that, settlement kept failing. It only succeeded once we **also** put, *inside* `paymentPayload`:
- a `resource` **object** (`{ url, description, mimeType }`), and
- `accepted` — the exact `paymentRequirements` object the client paid against.

```ts
// what actually works (apps/web/lib/x402-gateway.ts:181-188)
const requirements = { ...batchingRequirements(amount, payTo), resource };
const resourceObj  = { url: resource, description, mimeType: "application/json" };
body: {
  paymentPayload: { x402Version: 2, resource: resourceObj, accepted: requirements, payload: { authorization, signature } },
  paymentRequirements: requirements,
}
```

**Cost.** Hours of opaque 4xx with no field-level error pointing at the missing keys.

**Suggested fix.** Document that `paymentPayload` must carry `resource` (object) and `accepted`, show a full request body in the Gateway nanopayments quickstart, and return a validation error naming the missing field rather than a generic rejection.

---

## 2. Burn-intent `maxFee` has an undocumented non-zero floor (~0.0035 USDC on Arc testnet)

**What happened.** Signing the EIP-712 `BurnIntent`/`TransferSpec`, the natural first guess is `maxFee = 0` (we're on testnet, gas is sponsored). Settlement silently fails. The working value is **≈0.0035 USDC**, found only by trial; we now authorize a little headroom (`apps/web/lib/burn-intent.ts:58`).

**Suggested fix.** Publish the current testnet fee floor next to the `maxFee` field in the struct docs, and surface a specific `maxFee_too_low` error from settle instead of a generic failure. A `GET` for the current fee estimate would be ideal so integrators don't hard-code a magic number.

---

## 3. Embedded Wallets (W3S) — the PIN UI can't be themed or cancel-detected out of the box

Three distinct papercuts on `@circle-fin/w3s-pw-web-sdk`, all UX-critical for a consumer product:

- **Stuck in light mode.** The PIN iframe renders light regardless of the host app's dark mode. The fix exists (`setThemeColor`, `setResources`, `setLocalizations`) but isn't discoverable from the wallet quickstart — we found it by reading the SDK types (`apps/web/lib/useEmbeddedWallet.ts:31`). A "theme the PIN UI to match your app" snippet would help.
- **Closing the modal doesn't fire a callback.** The SDK renders a fixed full-screen `#sdkIframe`; tapping its **X** removes the iframe **without** invoking the completion/error callback. The host app has no way to know the user cancelled, so it can't reset its own state. We had to add a `MutationObserver` watching for the iframe's removal as a cancel signal. Please add an explicit `onClose` / `onUserCancel` callback.
- **Full-screen by default.** It takes over the viewport; constraining it to a centered card requires injecting CSS against the internal `#sdkIframe` id (brittle if that id changes). An official "render inline / sized container" option would remove the hack.

---

## 4. `NEXT_PUBLIC_CIRCLE_APP_ID` is required in the browser but fails opaquely when missing

The embedded-wallet SDK needs the App ID in the **client** bundle. If it's absent (easy to miss when deploying to Vercel — server env vars are set but the `NEXT_PUBLIC_` one isn't), provisioning fails at **runtime** with an unclear error rather than at build/init. **Suggested fix:** throw a named, early error like `Missing Circle App ID — set NEXT_PUBLIC_CIRCLE_APP_ID` on SDK init.

---

## 5. Node `fetch` (undici) to Circle endpoints hangs on hosts with a dead IPv6 route

On environments that advertise IPv6 but can't route it (WSL2, some CI), Node's default happy-eyeballs picks the dead AAAA and Circle/auth calls hang or 500. We had to preload an **IPv4-first undici dispatcher** (`apps/web/scripts/force-ipv4.mjs`) for every `npm run` that talks to Circle. **Suggested fix:** a one-line note in the Node SDK/agent-stack docs ("if requests hang on IPv6-broken networks, force IPv4"), or an opt-in IPv4 fallback in the SDK's HTTP client.

---

## 6. Smaller notes

- **Relayer key fallback.** Our settlement relayer falls back to `SELLER_PRIVATE_KEY` when a dedicated relayer key isn't set — fine, but the docs don't make clear which key signs the on-chain mint vs. which authorizes the burn. A diagram of "who signs what" in the batched flow would prevent guesswork.
- **x402 version drift.** We send `x402Version: 2` in `X-Payment` and `extra: { name: "GatewayWalletBatched", version: "1", ... }` in the quote. Two different "versions" in one flow is confusing; a glossary entry distinguishing the x402 protocol version from the EIP-712 domain version would help.

---

## What worked really well (so the signal isn't all friction)

- **Simulate-first design is the right call.** Being able to run the entire 402 → pay → unlock loop with no keys and no funds made development and review dramatically faster. We kept one code path for simulate and live, gated only by `PAYMENTS_MODE`.
- **EIP-3009 + Gateway batching** genuinely delivers gas-free, sub-cent settlement — the core thesis of the hackathon held up end-to-end on Arc.
- **The ARC CLI bundling Arc repos/docs as agent context** is a great idea: a coding agent could build against Arc with the reference material already in-context.
- **Faucet + Arc explorer** were reliable throughout.

*Repo references are to this submission's source; happy to walk through any of these live.*
