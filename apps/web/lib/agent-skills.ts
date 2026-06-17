/**
 * Agent-skills helpers: the auto-generated free block 0 (self-onboarding) and
 * the HTTP 402 payment-required body. Block 0 is NEVER written by the creator —
 * it's regenerated from their pricing + gateway address on every request, so it
 * always reflects the current settings.
 */
import type { Content } from "./types.js";

/** Resolve the Circle Gateway address an agent pays for this content. */
export function gatewayAddressFor(content: Pick<Content, "gateway_address">): string {
  return (
    content.gateway_address ||
    process.env.CIRCLE_GATEWAY_ADDRESS ||
    process.env.GATEWAY_WALLET_ADDRESS ||
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
  );
}

export interface Block0Input {
  title: string;
  slug: string;
  summary: string;
  creatorHandle: string | null;
  pricePerBlock: string; // decimal USDC
  gatewayAddress: string;
  payableBlocks: number; // blocks 1..N
  baseUrl: string;
}

/** Build the free, machine-readable onboarding block (markdown). */
export function buildBlock0(i: Block0Input): string {
  const url = `${i.baseUrl}/read/${i.slug}/agent-skills.md`;
  return `# ${i.title}

> Free onboarding block (block 0). No payment required.

${i.summary ? i.summary + "\n" : ""}
**Author:** @${i.creatorHandle ?? "unknown"}

## What's in this file
This file exposes **${i.payableBlocks} payable block(s)** (block 1 through ${i.payableBlocks}).
Each block is a self-contained skill/section you can purchase and read independently.

## Pricing
- **Cost per block:** \`${i.pricePerBlock} USDC\`
- **Currency:** USDC (Arc testnet, 6 decimals)
- **Payment protocol:** Circle Gateway (EIP-3009 batched settlement)
- **Pay to (Gateway address):** \`${i.gatewayAddress}\`

## How to pay (the 402 flow)
1. Request a block:
   \`\`\`
   GET ${url}?block=1
   \`\`\`
   With no payment you get \`HTTP 402 Payment Required\` plus machine-readable
   instructions (gateway address, cost, currency).
2. Pay \`${i.pricePerBlock} USDC\` to the Gateway address above via Circle Gateway.
   You receive a payment token.
3. Retry the same URL with the token header:
   \`\`\`
   GET ${url}?block=1
   X-Payment-Token: <your-token>
   \`\`\`
   The block content is returned immediately (optimistically). Earnings are
   finalized once Circle confirms the payment via webhook.

## Worked example
Request (unpaid):
\`\`\`
$ curl -i "${url}?block=1"
HTTP/1.1 402 Payment Required
{
  "error": "Payment required",
  "block_index": 1,
  "payment_gateway": "${i.gatewayAddress}",
  "cost_per_block": "${i.pricePerBlock}",
  "currency": "USDC",
  "instructions": "Send payment via Circle Gateway, then retry with header: X-Payment-Token: <token>"
}
\`\`\`
Request (paid):
\`\`\`
$ curl -i -H "X-Payment-Token: <token>" "${url}?block=1"
HTTP/1.1 200 OK
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
... block 1 content ...
\`\`\`

Repeat for block 2, 3, … up to ${i.payableBlocks} to consume the whole file.
`;
}

/** The HTTP 402 payment-required JSON body (spec shape). */
export function paymentRequiredBody(args: {
  blockIndex: number;
  gatewayAddress: string;
  costPerBlock: string;
}): Record<string, unknown> {
  return {
    error: "Payment required",
    block_index: args.blockIndex,
    payment_gateway: args.gatewayAddress,
    cost_per_block: args.costPerBlock,
    currency: "USDC",
    instructions:
      "Send payment via Circle Gateway, then retry with header: X-Payment-Token: <token>",
  };
}
