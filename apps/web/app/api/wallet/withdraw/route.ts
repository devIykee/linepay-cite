import { NextRequest } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { transferUsdc } from "@/lib/circle-wallets";
import { readBalances } from "@/lib/gateway-relayer";
import { validateWallet } from "@/lib/validate-wallet";
import { normalizeUsdc, toBaseUnits } from "@/lib/money";
import type { Address } from "viem";

export const runtime = "nodejs";

/**
 * POST /api/wallet/withdraw — withdraw USDC from the user's developer-controlled
 * wallet to an external address. Signed server-side with the entity secret (no
 * PIN, no challenge); the transfer settles asynchronously (poll /api/wallet/tx-status
 * by the returned txId).
 *
 * Validation order (fail with a clear, distinct error at each step):
 *   1. user has a wallet (admins don't — they use external)
 *   2. amount is a positive USDC value
 *   3. destination is a syntactically valid (EIP-55) address
 *   4. amount ≤ on-chain USDC balance
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role === "admin")
      throw new HttpError(403, "admin_uses_external", "Admins withdraw from their external wallet.");
    if (!user.embedded_wallet_id || !user.embedded_wallet_address)
      throw new HttpError(409, "no_wallet", "Your wallet isn't ready yet.");

    const body = (await req.json().catch(() => ({}))) as { amount?: string | number; destination?: string };

    // 2. amount
    let amount: string;
    try {
      amount = normalizeUsdc(body.amount ?? "");
    } catch {
      throw new HttpError(400, "bad_amount", "Enter a valid USDC amount.");
    }
    if (toBaseUnits(amount) <= 0n)
      throw new HttpError(400, "bad_amount", "Amount must be greater than 0.");

    // 3. destination address (EIP-55)
    const destCheck = validateWallet(body.destination);
    if (!destCheck.valid || !destCheck.checksummed)
      throw new HttpError(400, "bad_destination", destCheck.error ?? "Enter a valid destination address.");
    const destination = destCheck.checksummed;

    // 4. balance check
    try {
      const bal = await readBalances(user.embedded_wallet_address as Address);
      if (toBaseUnits(bal.usdc) < toBaseUnits(amount))
        throw new HttpError(400, "insufficient_balance", `You only have ${bal.usdc} USDC available.`);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // If the balance read itself fails, don't block — Circle will reject an
      // over-withdraw — but the user just won't get the friendly pre-check.
    }

    const idempotencyKey = crypto.randomUUID();
    const { id: txId } = await transferUsdc({
      walletId: user.embedded_wallet_id,
      destinationAddress: destination,
      amountUsdc: amount,
      idempotencyKey,
    });

    return Response.json({ txId, amount, destination });
  } catch (e) {
    if (!(e instanceof HttpError)) {
      const message = String((e as { message?: string })?.message ?? e);
      console.error("[wallet/withdraw] failed:", message);
      return errorResponse(new HttpError(502, "withdraw_failed", `Withdrawal couldn't be started: ${message}`));
    }
    return errorResponse(e);
  }
}
