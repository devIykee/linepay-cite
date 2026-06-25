import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { provisionWallet, walletsEnabled } from "@/lib/circle-wallets";
import { setEmbeddedWallet } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/wallet/embedded — the signed-in user's wallet status. Wallets are
 * developer-controlled and auto-provisioned at signup, so a non-admin user
 * normally already has one. Admins never get a wallet (they sign externally).
 */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({
      enabled: walletsEnabled(),
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
 * POST /api/wallet/embedded — provision the user's wallet server-side. This is
 * the fallback/retry path for accounts that signed up before auto-provisioning,
 * or where the signup-time provision failed. Idempotent: returns the existing
 * wallet if there is one. No challenge, no PIN — Circle's entity secret signs.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (user.role === "admin")
      throw new HttpError(403, "admin_uses_external", "Admins sign with an external wallet.");
    if (!walletsEnabled())
      throw new HttpError(503, "wallets_disabled", "Wallets aren't configured.");

    if (user.embedded_wallet_address) {
      return Response.json({ alreadyProvisioned: true, address: user.embedded_wallet_address });
    }

    try {
      const w = await provisionWallet();
      const updated = await setEmbeddedWallet(user.id, w.id, w.address);
      return Response.json({
        address: w.address,
        walletId: w.id,
        payoutAddress: updated?.wallet_address ?? w.address,
        walletSource: updated?.wallet_source ?? "embedded",
      });
    } catch (circleErr) {
      const message = String((circleErr as { message?: string })?.message ?? circleErr);
      console.error("[wallet/embedded] Circle provisioning failed:", message);
      throw new HttpError(502, "wallet_provision_failed", `Wallet provisioning failed: ${message}`);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
