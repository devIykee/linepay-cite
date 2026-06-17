import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
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
    if (job.status !== "complete" || !job.file_path) {
      return Response.json({ error: "not_ready", status: job.status }, { status: 409 });
    }
    if (!existsSync(job.file_path)) {
      return Response.json({ error: "file_expired", message: "Export file no longer available — regenerate it." }, { status: 410 });
    }
    const nodeStream = createReadStream(job.file_path);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payments-${jobId}.csv"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
