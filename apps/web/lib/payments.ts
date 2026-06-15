import {
  GatewayClient,
  loadArcConfig,
  quoteRequirement,
  splitRevenue,
  DEFAULT_SPLIT_BPS,
  lineRangeCost,
  sliceLines,
  hashContent,
  type Address,
  type PaymentRequirement,
} from "@linepay/sdk";
import type { Content, Creator } from "./store.js";

/** Shared Arc config + Gateway client for the server (verifier/settler role). */
export const arc = loadArcConfig();
export const gateway = new GatewayClient(arc);

function platformAddress(): Address {
  return (process.env.PLATFORM_ADDRESS as Address) ??
    ("0x0000000000000000000000000000000000000001" as Address);
}
function referrerAddress(): Address {
  return (process.env.REFERRER_ADDRESS as Address) ??
    ("0x0000000000000000000000000000000000000002" as Address);
}

/**
 * Build the x402 PaymentRequirement for a line range of a piece of content.
 * payTo is the RevenueSplit contract when configured (so the split happens
 * on-chain), otherwise the creator directly.
 */
export function requirementFor(
  content: Content,
  creator: Creator,
  lineStart: number,
  lineEnd: number,
  baseUrl: string
): PaymentRequirement {
  const { lineCount, total } = lineRangeCost(
    BigInt(content.price_per_line),
    lineStart,
    lineEnd
  );
  const payTo = (arc.revenueSplitAddress ?? (creator.wallet as Address)) as Address;
  return quoteRequirement({
    amount: total.toString(),
    asset: arc.usdcAddress,
    payTo,
    contentId: content.id,
    resource: `${baseUrl}/api/content/${content.id}?lineStart=${lineStart}&lineEnd=${lineEnd}`,
    lineStart,
    lineEnd,
    lineCount,
    pricePerLine: content.price_per_line,
    creatorHandle: creator.handle,
    verifiedCreator: !!creator.verified,
    description: `Read lines ${lineStart}-${lineEnd} of "${content.title}" by @${creator.handle}`,
  });
}

/** Compute the revenue split for a settled amount. */
export function splitFor(total: bigint, creator: Creator) {
  return splitRevenue(
    total,
    creator.wallet as Address,
    platformAddress(),
    referrerAddress(),
    DEFAULT_SPLIT_BPS
  );
}

export { sliceLines, hashContent };
