import { requireAdmin, errorResponse } from "@/lib/session";
import { getUserById, recordAdminEvent } from "@/lib/store";
import { IMPERSONATION_COOKIE, signImpersonation } from "@/lib/impersonation";

export const runtime = "nodejs";

/** Start impersonating a creator — sets a signed, httpOnly impersonation cookie. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const target = await getUserById(id);
    if (!target) return Response.json({ error: "not_found" }, { status: 404 });

    const token = await signImpersonation({ adminId: admin.id, targetId: target.id });
    await recordAdminEvent({
      eventType: "IMPERSONATE",
      actorId: admin.id,
      metadata: { action: "start", targetId: target.id, targetEmail: target.email },
    });

    const res = Response.json({ ok: true, impersonating: { id: target.id, name: target.display_name } });
    res.headers.append(
      "Set-Cookie",
      `${IMPERSONATION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`
    );
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
