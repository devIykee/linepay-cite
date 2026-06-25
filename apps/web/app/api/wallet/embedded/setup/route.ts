import { NextRequest } from "next/server";
import { parseUnits } from "viem";
import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { execContract } from "@/lib/circle-wallets";
import { validateWallet } from "@/lib/validate-wallet";
import { normalizeUsdc } from "@/lib/money";
import { GATEWAY_WALLET_ADDRESS, ARC_USDC_ADDRESS } from "@/lib/burn-intent";

export const runtime = "nodejs";

/**
 * POST /api/wallet/embedded/setup — run ONE silent-payment setup step on the
 * user's developer-controlled (SCA) wallet, signed server-side with the entity
 * secret (no PIN, no challenge). Steps mirror the external wagmi flow:
 *   approve     → USDC.approve(gatewayWallet, cap)
 *   deposit     → GatewayWallet.deposit(usdc, cap)
 *   addDelegate → GatewayWallet.addDelegate(usdc, sessionAddress)
 *
 * Returns the Circle transaction id; the per-block burn intent is still signed
 * by the local EOA session key, so the burn/verify path is unchanged.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role === "admin")
      throw new HttpError(403, "admin_uses_external", "Admins sign with an external wallet.");
    if (!user.embedded_wallet_id)
      throw new HttpError(409, "no_wallet", "Your wallet isn't ready yet.");

    const body = (await req.json().catch(() => ({}))) as {
      step?: "approve" | "deposit" | "addDelegate";
      cap?: string | number;
      sessionAddress?: string;
    };
    const walletId = user.embedded_wallet_id;
    const idempotencyKey = crypto.randomUUID();

    let txId: string;
    if (body.step === "approve" || body.step === "deposit") {
      let capWei: bigint;
      try {
        capWei = parseUnits(normalizeUsdc(String(body.cap ?? "")), 6);
      } catch {
        throw new HttpError(400, "bad_cap", "Enter a valid deposit amount.");
      }
      if (capWei <= 0n) throw new HttpError(400, "bad_cap", "Deposit must be greater than 0.");

      const exec =
        body.step === "approve"
          ? await execContract({
              walletId,
              contractAddress: ARC_USDC_ADDRESS,
              abiFunctionSignature: "approve(address,uint256)",
              abiParameters: [GATEWAY_WALLET_ADDRESS, capWei.toString()],
              idempotencyKey,
            })
          : await execContract({
              walletId,
              contractAddress: GATEWAY_WALLET_ADDRESS,
              abiFunctionSignature: "deposit(address,uint256)",
              abiParameters: [ARC_USDC_ADDRESS, capWei.toString()],
              idempotencyKey,
            });
      txId = exec.id;
    } else if (body.step === "addDelegate") {
      const sess = validateWallet(body.sessionAddress);
      if (!sess.valid || !sess.checksummed)
        throw new HttpError(400, "bad_session_address", "Invalid session key.");
      const exec = await execContract({
        walletId,
        contractAddress: GATEWAY_WALLET_ADDRESS,
        abiFunctionSignature: "addDelegate(address,address)",
        abiParameters: [ARC_USDC_ADDRESS, sess.checksummed],
        idempotencyKey,
      });
      txId = exec.id;
    } else {
      throw new HttpError(400, "bad_step", "Unknown setup step.");
    }

    return Response.json({ txId });
  } catch (e) {
    return errorResponse(e);
  }
}
