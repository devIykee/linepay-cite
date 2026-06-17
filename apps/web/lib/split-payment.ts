import { toBaseUnits, toDecimal } from "./money.js";

/**
 * Server-side revenue split. NEVER trust the client for these numbers.
 *
 * Rates come from env (decimals, not percentages):
 *   PLATFORM_FEE_RATE  default 0.10
 *   REFERRER_FEE_RATE  default 0.05  (applied only when a referrer is present)
 *
 * There is deliberately NO CREATOR_FEE_RATE: the creator's cut is ALWAYS the
 * remainder (gross − platform − referrer), so the three shares can never
 * silently fail to sum to the gross. All math is done in integer base units
 * (bigint) so the parts reconcile exactly to the gross with no float dust.
 *
 *   With referrer:   creator 85% / platform 10% / referrer 5%
 *   Without referrer: creator 90% / platform 10%
 */
export interface SplitInput {
  /** Gross payment as decimal USDC ("0.05") or base units (bigint). */
  total: string | number | bigint;
  /** Whether a referrer is credited on this payment. */
  hasReferrer: boolean;
}

export interface PaymentSplit {
  /** Decimal USDC strings (DB / API / email facing). */
  gross: string;
  creatorAmount: string;
  platformAmount: string;
  referrerAmount: string;
  /** Rates actually applied (for display/audit). */
  platformRate: number;
  referrerRate: number;
  /** Exact base-unit values, for the on-chain / Gateway layer. */
  base: { gross: bigint; creator: bigint; platform: bigint; referrer: bigint };
}

function readRate(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n >= 1) {
    throw new Error(`${label} must be a decimal in [0, 1); got ${JSON.stringify(raw)}`);
  }
  return n;
}

/** Convert a fractional rate (0.10) to parts-per-million for integer math. */
function rateToPpm(rate: number): bigint {
  return BigInt(Math.round(rate * 1_000_000));
}

const PPM = 1_000_000n;

/** Compute the split. Pure given env; reads PLATFORM_FEE_RATE / REFERRER_FEE_RATE. */
export function splitPayment(input: SplitInput): PaymentSplit {
  const platformRate = readRate(process.env.PLATFORM_FEE_RATE, 0.1, "PLATFORM_FEE_RATE");
  const referrerRate = input.hasReferrer
    ? readRate(process.env.REFERRER_FEE_RATE, 0.05, "REFERRER_FEE_RATE")
    : 0;

  if (platformRate + referrerRate >= 1) {
    throw new Error(
      `PLATFORM_FEE_RATE (${platformRate}) + REFERRER_FEE_RATE (${referrerRate}) must be < 1`
    );
  }

  const gross = toBaseUnits(input.total);
  const platform = (gross * rateToPpm(platformRate)) / PPM;
  const referrer = input.hasReferrer ? (gross * rateToPpm(referrerRate)) / PPM : 0n;
  const creator = gross - platform - referrer; // remainder — always reconciles

  return {
    gross: toDecimal(gross),
    creatorAmount: toDecimal(creator),
    platformAmount: toDecimal(platform),
    referrerAmount: toDecimal(referrer),
    platformRate,
    referrerRate,
    base: { gross, creator, platform, referrer },
  };
}

/**
 * Preview the split for the creator dashboard "commission split" panel without
 * needing a real payment. Returns decimal strings + integer percentages.
 */
export function previewSplit(pricePerBlock: string | number, hasReferrer: boolean) {
  const split = splitPayment({ total: pricePerBlock, hasReferrer });
  const pct = (part: bigint) =>
    split.base.gross === 0n ? 0 : Number((part * 10000n) / split.base.gross) / 100;
  return {
    readerPays: split.gross,
    creator: { amount: split.creatorAmount, pct: pct(split.base.creator) },
    platform: { amount: split.platformAmount, pct: pct(split.base.platform) },
    referrer: { amount: split.referrerAmount, pct: pct(split.base.referrer) },
    hasReferrer,
  };
}
