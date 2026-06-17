import { assertNotImpersonating, errorResponse, resolveActingUser } from "@/lib/session";
import { createPayout, creatorEarnings, recordAdminEvent } from "@/lib/store";
import { notifyPayoutInitiated } from "@/lib/email";

export const runtime = "nodejs";

/**
 * POST — request a payout of the creator's unpaid balance to their linked
 * wallet. Creates an 'initiated' payout row and emails the creator. In live
 * mode the Circle transfer is triggered out-of-band; transfer.confirmed
 * (webhook) flips it to 'confirmed'.
 */
export async function POST() {
  try {
    const ctx = await resolveActingUser();
    assertNotImpersonating(ctx);
    const user = ctx.user;

    if (!user.wallet_address) {
      return Response.json({ error: "no_wallet", message: "Link a payout wallet first." }, { status: 400 });
    }
    const { pendingPayout } = await creatorEarnings(user.id);
    if (Number(pendingPayout) <= 0) {
      return Response.json({ error: "nothing_to_pay", message: "No unpaid balance." }, { status: 400 });
    }

    const payout = await createPayout(user.id, pendingPayout, user.wallet_address);
    await recordAdminEvent({
      eventType: "PAYOUT",
      actorId: user.id,
      amountGross: pendingPayout,
      metadata: { wallet: user.wallet_address, status: "initiated", payoutId: payout.id },
    });
    if (user.email) {
      notifyPayoutInitiated({ to: user.email, amount: pendingPayout, wallet: user.wallet_address });
    }
    return Response.json({ ok: true, payout });
  } catch (e) {
    return errorResponse(e);
  }
}
