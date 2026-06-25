import { NextRequest } from "next/server";
import { errorResponse, resolveActingUser } from "@/lib/session";
import { listNotifications, markNotificationsRead, unreadNotificationCount } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the acting user's recent notifications + unread count. */
export async function GET() {
  try {
    const ctx = await resolveActingUser();
    const [items, unread] = await Promise.all([
      listNotifications(ctx.user.id, 20),
      unreadNotificationCount(ctx.user.id),
    ]);
    return Response.json({
      unread,
      notifications: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.read,
        createdAt: new Date(n.created_at).toISOString(),
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST — mark notifications read ({ ids } to target specific ones, or all). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
    await markNotificationsRead(ctx.user.id, Array.isArray(body.ids) ? body.ids : undefined);
    const unread = await unreadNotificationCount(ctx.user.id);
    return Response.json({ ok: true, unread });
  } catch (e) {
    return errorResponse(e);
  }
}
