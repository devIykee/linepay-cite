import { requireAdmin, errorResponse } from "@/lib/session";
import { getMetrics } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getMetrics());
  } catch (e) {
    return errorResponse(e);
  }
}
