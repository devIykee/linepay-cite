import { requireAdmin, errorResponse } from "@/lib/session";
import { recordAdminEvent } from "@/lib/store";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation";

export const runtime = "nodejs";

/** Stop impersonating — clears the impersonation cookie. */
export async function DELETE() {
  try {
    const admin = await requireAdmin();
    await recordAdminEvent({
      eventType: "IMPERSONATE",
      actorId: admin.id,
      metadata: { action: "end" },
    });
    const res = Response.json({ ok: true });
    res.headers.append("Set-Cookie", `${IMPERSONATION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
