import { requireUser, errorResponse, HttpError } from "@/lib/session";
import {
  ensureCircleUser,
  issueUserToken,
  createWalletChallenge,
  embeddedWalletsEnabled,
} from "@/lib/circle-wallets";

export const runtime = "nodejs";

/**
 * GET /api/wallet/embedded — the signed-in user's embedded wallet status.
 * Admins never get an embedded wallet (they sign with an external one).
 */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({
      enabled: embeddedWalletsEnabled(),
      isAdmin: user.role === "admin",
      hasWallet: !!user.embedded_wallet_address,
      address: user.embedded_wallet_address,
      walletId: user.embedded_wallet_id,
      walletSource: user.wallet_source,
      payoutAddress: user.wallet_address,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/wallet/embedded — begin provisioning. Returns the Web SDK session
 * token + PIN/create-wallet challenge for the browser to execute. Idempotent:
 * if the user already has a wallet we just report it.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (user.role === "admin")
      throw new HttpError(403, "admin_uses_external", "Admins sign with an external wallet.");
    if (!embeddedWalletsEnabled())
      throw new HttpError(503, "embedded_disabled", "Embedded wallets aren't configured.");

    if (user.embedded_wallet_address) {
      return Response.json({ alreadyProvisioned: true, address: user.embedded_wallet_address });
    }

    await ensureCircleUser(user.id);
    const { userToken, encryptionKey } = await issueUserToken(user.id);
    const challengeId = await createWalletChallenge(userToken);

    return Response.json({
      userToken,
      encryptionKey,
      challengeId,
      appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
