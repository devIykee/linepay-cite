import { errorResponse, resolveActingUser } from "@/lib/session";
import { creatorEarnings, listPayouts } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await resolveActingUser();
    const [earnings, payouts] = await Promise.all([
      creatorEarnings(ctx.user.id),
      listPayouts(ctx.user.id),
    ]);
    return Response.json({
      earnings,
      payouts,
      walletLinked: !!ctx.user.wallet_address,
      impersonating: ctx.impersonating,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
