import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { getRevenueByContent, getRevenueOverTime } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const type = req.nextUrl.searchParams.get("type") ?? "revenue-over-time";
    if (type === "revenue-by-content") {
      return Response.json({ type, data: await getRevenueByContent() });
    }
    const range = req.nextUrl.searchParams.get("range") ?? "7d";
    return Response.json({ type: "revenue-over-time", range, data: await getRevenueOverTime(range) });
  } catch (e) {
    return errorResponse(e);
  }
}
