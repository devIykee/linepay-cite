import { requireAdmin, errorResponse } from "@/lib/session";
import { reinstateContent } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const content = await reinstateContent(id);
    if (!content) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, content });
  } catch (e) {
    return errorResponse(e);
  }
}
