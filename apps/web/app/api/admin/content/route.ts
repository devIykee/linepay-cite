import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { adminListContent } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const rows = await adminListContent({
      search: sp.get("search") ?? undefined,
      status: sp.get("status") ?? undefined,
      limit: Number(sp.get("limit")) || 50,
      offset: Number(sp.get("offset")) || 0,
    });
    return Response.json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}
