import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { setAgentBlocked, setAgentTrusted } from "@/lib/store";

export const runtime = "nodejs";

/**
 * POST /api/admin/agents/block
 *   { sessionKey, blocked?, trusted? }
 * Block/unblock an agent session and/or mark it trusted (trusted agents get 5×
 * rate limits — see the agent read route).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      sessionKey?: string;
      blocked?: boolean;
      trusted?: boolean;
    };
    if (!body.sessionKey) return Response.json({ error: "missing_sessionKey" }, { status: 400 });

    let session;
    if (typeof body.blocked === "boolean") session = await setAgentBlocked(body.sessionKey, body.blocked);
    if (typeof body.trusted === "boolean") session = await setAgentTrusted(body.sessionKey, body.trusted);
    if (!session) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, session });
  } catch (e) {
    return errorResponse(e);
  }
}
