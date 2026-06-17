import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { listUsers } from "@/lib/store";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const wallet = sp.get("wallet");
    const { rows, total } = await listUsers({
      search: sp.get("search") ?? undefined,
      role: (sp.get("role") as UserRole | null) ?? undefined,
      walletLinked: wallet === "yes" ? true : wallet === "no" ? false : undefined,
      sort: (sp.get("sort") as "joined" | "earned" | "content" | null) ?? undefined,
      limit: Number(sp.get("limit")) || 25,
      offset: Number(sp.get("offset")) || 0,
    });
    return Response.json({ rows, total });
  } catch (e) {
    return errorResponse(e);
  }
}
