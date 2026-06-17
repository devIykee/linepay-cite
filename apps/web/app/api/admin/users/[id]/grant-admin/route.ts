import { requireAdmin, errorResponse } from "@/lib/session";
import { setUserRole } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const user = await setUserRole(id, "admin");
    if (!user) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, user });
  } catch (e) {
    return errorResponse(e);
  }
}
