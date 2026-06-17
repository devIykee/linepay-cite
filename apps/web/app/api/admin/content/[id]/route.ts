import { requireAdmin, errorResponse } from "@/lib/session";
import { deleteContent } from "@/lib/store";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    await deleteContent(id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
