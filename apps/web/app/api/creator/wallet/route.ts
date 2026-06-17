import { NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/session";
import { setUserWallet } from "@/lib/store";
import { validateWallet } from "@/lib/validate-wallet";
import { rateLimit, rateLimitResponse, clientIp, envLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Current linked wallet for the signed-in creator. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ walletAddress: user.wallet_address });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Link/replace the creator's payout wallet. The pasted address is validated
 * with EIP-55 server-side — a malformed/typo'd address is rejected and never
 * stored, since payouts to a bad address are unrecoverable.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit({ key: `wallet:${ip}`, limit: envLimit("RATE_LIMIT_AUTH", 20), windowSec: 60 });
    if (!rl.ok) return rateLimitResponse(rl);

    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { wallet?: string };

    const result = validateWallet(body.wallet);
    if (!result.valid || !result.checksummed) {
      return Response.json({ error: "invalid_wallet", message: result.error }, { status: 400 });
    }

    const updated = await setUserWallet(user.id, result.checksummed);
    return Response.json({ ok: true, walletAddress: updated?.wallet_address });
  } catch (e) {
    return errorResponse(e);
  }
}
