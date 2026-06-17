import { requireAdmin, errorResponse } from "@/lib/session";
import { creatorEarnings, getUserById, listContentByCreator, listPayouts } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const user = await getUserById(id);
    if (!user) return Response.json({ error: "not_found" }, { status: 404 });
    const [content, earnings, payouts] = await Promise.all([
      listContentByCreator(id),
      creatorEarnings(id),
      listPayouts(id),
    ]);
    return Response.json({ user, content, earnings, payouts });
  } catch (e) {
    return errorResponse(e);
  }
}
