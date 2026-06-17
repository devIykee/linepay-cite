import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { suspendContent } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    const content = await suspendContent(id, body.reason ?? "Suspended by admin");
    if (!content) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, content });
  } catch (e) {
    return errorResponse(e);
  }
}
