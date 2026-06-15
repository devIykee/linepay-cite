import { USDC_DECIMALS, type RevenueSplit, type Address } from "./types.js";

/** Default split: 85% creator, 10% platform, 5% referrer. */
export const DEFAULT_SPLIT_BPS = {
  creator: 8500,
  platform: 1000,
  referrer: 500,
} as const;

/** Format USDC base units as a human dollar string, e.g. 50n -> "$0.000050". */
export function formatUsdc(baseUnits: bigint | string): string {
  const v = BigInt(baseUnits);
  const s = v.toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = s.slice(0, -USDC_DECIMALS);
  const frac = s.slice(-USDC_DECIMALS);
  return `$${whole}.${frac}`;
}

/** Parse a dollar string like "0.00005" into USDC base units (bigint). */
export function parseUsdc(dollars: number | string): bigint {
  const n = typeof dollars === "number" ? dollars : Number(dollars);
  // Round to avoid float dust; 6 decimals.
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

/**
 * Cost of reading a line range, given a per-line price in base units.
 * Inclusive of both endpoints.
 */
export function lineRangeCost(
  pricePerLine: bigint,
  lineStart: number,
  lineEnd: number
): { lineCount: number; total: bigint } {
  const lineCount = Math.max(0, lineEnd - lineStart + 1);
  return { lineCount, total: pricePerLine * BigInt(lineCount) };
}

/**
 * Split an amount across creator / platform / referrer. Remainder from integer
 * division is given to the creator so totals always reconcile to the penny.
 */
export function splitRevenue(
  total: bigint,
  creator: Address,
  platform: Address,
  referrer: Address,
  bps = DEFAULT_SPLIT_BPS
): RevenueSplit {
  const platformAmt = (total * BigInt(bps.platform)) / 10000n;
  const referrerAmt = (total * BigInt(bps.referrer)) / 10000n;
  const creatorAmt = total - platformAmt - referrerAmt;
  return {
    creator: { address: creator, bps: bps.creator, amount: creatorAmt.toString() },
    platform: { address: platform, bps: bps.platform, amount: platformAmt.toString() },
    referrer: { address: referrer, bps: bps.referrer, amount: referrerAmt.toString() },
  };
}
