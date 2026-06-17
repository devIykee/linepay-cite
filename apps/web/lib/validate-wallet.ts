import { getAddress, isAddress } from "viem";
import type { Address } from "viem";

/**
 * Server-side wallet validation. Payouts to a bad address are unrecoverable,
 * so we NEVER store an address that fails EIP-55 checksum validation.
 *
 * viem's `getAddress` throws unless the input is a valid 20-byte hex address
 * with a correct EIP-55 mixed-case checksum (or all-lower/all-upper, which it
 * normalizes). We treat an all-lowercase address as acceptable and return the
 * checksummed form to store, but reject a *mixed-case* address whose checksum
 * is wrong (a likely typo/corruption).
 */
export interface WalletValidation {
  valid: boolean;
  /** EIP-55 checksummed address, present only when valid. */
  checksummed?: Address;
  /** Human-readable reason when invalid. */
  error?: string;
}

const HEX_20 = /^0x[0-9a-fA-F]{40}$/;

export function validateWallet(input: string | null | undefined): WalletValidation {
  if (!input || typeof input !== "string") {
    return { valid: false, error: "Wallet address is required." };
  }
  const addr = input.trim();
  if (!HEX_20.test(addr)) {
    return {
      valid: false,
      error: "Not a valid EVM address — expected 0x followed by 40 hex characters.",
    };
  }
  const hasMixedCase = addr !== addr.toLowerCase() && addr !== addr.toUpperCase();
  // `isAddress(strict)` enforces the EIP-55 checksum for mixed-case input.
  if (hasMixedCase && !isAddress(addr, { strict: true })) {
    return {
      valid: false,
      error:
        "EIP-55 checksum failed — the address looks mistyped. Paste it again or use all-lowercase.",
    };
  }
  try {
    return { valid: true, checksummed: getAddress(addr) };
  } catch {
    return { valid: false, error: "Address could not be checksummed." };
  }
}

/** Throwing variant — returns the checksummed address or throws with the reason. */
export function assertWallet(input: string | null | undefined): Address {
  const res = validateWallet(input);
  if (!res.valid || !res.checksummed) {
    throw new Error(res.error ?? "Invalid wallet address.");
  }
  return res.checksummed;
}
