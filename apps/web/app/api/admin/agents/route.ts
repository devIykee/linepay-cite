import { requireAdmin, errorResponse } from "@/lib/session";
import { listAgentSessions } from "@/lib/store";
import { getAgentFunnel } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const [sessions, funnel] = await Promise.all([listAgentSessions(200), getAgentFunnel()]);
    return Response.json({ sessions, funnel });
  } catch (e) {
    return errorResponse(e);
  }
}
