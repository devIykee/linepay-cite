import { requireAdmin, errorResponse } from "@/lib/session";
import { countLedgerForExport, ledgerCsvRows } from "@/lib/admin";
import { createExportJob } from "@/lib/store";
import { runExportJob } from "@/lib/export-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASYNC_THRESHOLD = 10_000;

/**
 * GET /api/admin/payments/export?format=csv
 *  - ≤10k rows: stream CSV directly (chunked, bounded memory).
 *  - >10k rows: 202 Accepted + jobId; poll .../export/:jobId/status then download.
 */
export async function GET() {
  try {
    const admin = await requireAdmin();
    const total = await countLedgerForExport();

    if (total > ASYNC_THRESHOLD) {
      const job = await createExportJob(admin.id, { kind: "payments" });
      void runExportJob(job.id);
      return Response.json(
        { jobId: job.id, status: "processing", rowCount: total },
        { status: 202 }
      );
    }

    const encoder = new TextEncoder();
    const iterator = ledgerCsvRows(1000)[Symbol.asyncIterator]();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="payments-export.csv"',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
