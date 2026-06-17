import { requireAdmin, errorResponse } from "@/lib/session";
import { getExportJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin();
    const { jobId } = await ctx.params;
    const job = await getExportJob(jobId);
    if (!job) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({
      id: job.id,
      status: job.status,
      rowCount: job.row_count,
      ready: job.status === "complete",
      downloadUrl: job.status === "complete" ? `/api/admin/payments/export/${job.id}/download` : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
