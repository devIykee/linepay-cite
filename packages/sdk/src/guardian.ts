import type { PaymentRequirement } from "./types.js";

/**
 * Guardian Lite — declarative spend policy for the buyer agent.
 *
 * The agent must clear every payment through `checkPolicy` before it pays.
 * Policies are plain JSON so they're easy to edit, store, and show in the UI.
 */
export interface GuardianPolicy {
  /** Total the agent may spend this run, in USDC base units. */
  budgetBaseUnits: string;
  /** Hard ceiling on price-per-line the agent will accept (base units). */
  maxPricePerLine: string;
  /** Max it will spend on any single content purchase (base units). */
  maxPerPurchase: string;
  /** If true, refuse unverified creators outright. */
  requireVerified: boolean;
  /** If non-empty, only these creator handles are allowed. */
  allowedCreators?: string[];
  /** Creator handles that are always blocked. */
  blockedCreators?: string[];
}

export const DEFAULT_POLICY: GuardianPolicy = {
  budgetBaseUnits: "5000", // $0.005 for a demo run
  maxPricePerLine: "200", // $0.0002 / line
  maxPerPurchase: "2000", // $0.002 / purchase
  requireVerified: false,
  blockedCreators: [],
};

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  /** Remaining budget after this purchase would settle (if allowed). */
  remainingAfter: string;
}

/**
 * Evaluate a single payment requirement against the policy and the amount the
 * agent has already spent this run. Pure function — easy to unit test and to
 * render as the agent's visible reasoning.
 */
export function checkPolicy(
  policy: GuardianPolicy,
  req: PaymentRequirement,
  spentSoFar: bigint
): PolicyDecision {
  const budget = BigInt(policy.budgetBaseUnits);
  const amount = BigInt(req.amount);
  const pricePerLine = BigInt(req.extra.pricePerLine);
  const remaining = budget - spentSoFar;

  const handle = req.extra.creatorHandle;
  if (policy.blockedCreators?.includes(handle)) {
    return { allowed: false, reason: `creator @${handle} is blocked by policy`, remainingAfter: remaining.toString() };
  }
  if (policy.allowedCreators && policy.allowedCreators.length > 0 && !policy.allowedCreators.includes(handle)) {
    return { allowed: false, reason: `creator @${handle} not in allow-list`, remainingAfter: remaining.toString() };
  }
  if (policy.requireVerified && !req.extra.verifiedCreator) {
    return { allowed: false, reason: `@${handle} is unverified and policy requires verified creators`, remainingAfter: remaining.toString() };
  }
  if (pricePerLine > BigInt(policy.maxPricePerLine)) {
    return { allowed: false, reason: `price/line ${pricePerLine} exceeds max ${policy.maxPricePerLine}`, remainingAfter: remaining.toString() };
  }
  if (amount > BigInt(policy.maxPerPurchase)) {
    return { allowed: false, reason: `purchase ${amount} exceeds per-purchase cap ${policy.maxPerPurchase}`, remainingAfter: remaining.toString() };
  }
  if (amount > remaining) {
    return { allowed: false, reason: `purchase ${amount} exceeds remaining budget ${remaining}`, remainingAfter: remaining.toString() };
  }
  return { allowed: true, reason: "within budget and price limits", remainingAfter: (remaining - amount).toString() };
}

/** Prefer verified creators: returns a score nudge for ranking (not a hard gate). */
export function verifiedBonus(verified: boolean): number {
  return verified ? 0.1 : 0;
}
