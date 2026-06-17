/**
 * USDC money helpers. USDC has 6 decimals on Arc/Circle.
 *
 * Two representations are used in this codebase:
 *  - **decimal USDC** strings like "0.050000" — what the DB (NUMERIC(18,6)),
 *    API payloads, webhooks, and emails use.
 *  - **base units** (bigint) — integer 6-decimal units, used for exact split
 *    math and for the on-chain / Circle Gateway / x402 layer.
 *
 * Never use JS floating point for money arithmetic. Convert to base units
 * (bigint) for any add/subtract/multiply, then format back to decimal.
 */
export const USDC_DECIMALS = 6;
const SCALE = 1_000_000n; // 10 ** 6

/** Parse a decimal USDC value ("0.05", 0.05, "50") into base units (bigint). */
export function toBaseUnits(usdc: string | number | bigint): bigint {
  if (typeof usdc === "bigint") return usdc;
  const s = (typeof usdc === "number" ? usdc.toFixed(USDC_DECIMALS) : usdc).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`invalid USDC amount: ${JSON.stringify(usdc)}`);
  }
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const fracPadded = (frac + "000000").slice(0, USDC_DECIMALS);
  const value = BigInt(whole) * SCALE + BigInt(fracPadded || "0");
  return neg ? -value : value;
}

/** Format base units (bigint/string) as a fixed 6-decimal USDC string. */
export function toDecimal(base: bigint | string): string {
  const v = typeof base === "bigint" ? base : BigInt(base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Human display: "$0.050000". */
export function formatUsd(base: bigint | string): string {
  return `$${toDecimal(base)}`;
}

/** Sum a list of decimal USDC strings, returning a decimal string. */
export function sumDecimal(values: ReadonlyArray<string | number | bigint>): string {
  let total = 0n;
  for (const v of values) total += toBaseUnits(v);
  return toDecimal(total);
}

/** Truncate/round a numeric USDC string to 6 decimals (DB-safe). */
export function normalizeUsdc(usdc: string | number): string {
  return toDecimal(toBaseUnits(usdc));
}
