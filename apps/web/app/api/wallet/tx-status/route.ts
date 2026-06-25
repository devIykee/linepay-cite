import { NextRequest } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { getTx } from "@/lib/circle-wallets";

export const runtime = "nodejs";

/**
 * GET /api/wallet/tx-status?txId=… — poll a Circle transaction's state. Generic:
 * used for both withdrawals and silent-pay setup steps (approve/deposit/delegate).
 * Maps Circle's transaction states into a small pending/confirmed/failed status.
 */
function mapState(state: string): "pending" | "confirmed" | "failed" {
  const s = state.toUpperCase();
  if (["COMPLETE", "CONFIRMED"].includes(s)) return "confirmed";
  if (["FAILED", "CANCELLED", "DENIED"].includes(s)) return "failed";
  return "pending"; // INITIATED / QUEUED / SENT / WAITING / CLEARED …
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    void user; // requireUser gates access; txIds are Circle-internal, caller-owned.
    const txId = req.nextUrl.searchParams.get("txId");
    if (!txId) throw new HttpError(400, "missing_tx", "Missing txId.");

    const tx = await getTx(txId);
    if (!tx) return Response.json({ status: "pending", state: "unknown" });

    return Response.json({
      status: mapState(tx.state),
      state: tx.state,
      txHash: tx.txHash ?? null,
      amount: tx.amounts?.[0] ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
