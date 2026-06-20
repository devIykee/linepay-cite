import { NextRequest } from "next/server";
import { listPendingLedger, recordAdminEvent, finalizeLedgerByToken } from "@/lib/store";
import { settlePendingByToken } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Abandoned-payment sweep (§3a). A reader can optimistically unlock a block and
// close the app before the next unlock ever re-attempts settlement — leaving the
// row pending forever. This periodic job settles silent-payment rows that have
// sat pending past the idle timeout, on their own, without waiting for a
// next-block unlock. Rows it can't settle stay pending (surfaced to the reader
// on return, and to admins in Pending settlement).
const SWEEP_IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * GET /api/cron/sweep-pending — settles abandoned optimistic/pending rows.
 *
 * Scheduling: vercel.json runs this once daily (Vercel Hobby caps crons at
 * once/day). For tighter intervals, point an EXTERNAL scheduler (GitHub Actions
 * cron, cron-job.org, Upstash QStash, etc.) at this endpoint on whatever
 * interval you want — no Vercel plan limit applies. Either way it's guarded by
 * CRON_SECRET: Vercel sends it as `Authorization: Bearer <CRON_SECRET>`; an
 * external caller can pass it as a Bearer header or ?key=<CRON_SECRET>.
 *
 * The daily cadence only affects how fast a TRULY abandoned session is cleaned
 * up — the per-tap N+1 combined check and the final-chunk-always-confirmed rule
 * still prevent unpaid reads in the meantime.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = req.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const simulate = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";
  const pending = await listPendingLedger(200);
  const cutoff = Date.now() - SWEEP_IDLE_MS;
  const stale = pending.filter((r) => r.payment_token && new Date(r.created_at).getTime() < cutoff);

  let settled = 0;
  const results: Array<{ token: string; ok: boolean; reason?: string }> = [];
  for (const row of stale) {
    const token = row.payment_token!;
    try {
      // Abandoned optimistic rows with no committed burn (simulate only) carry
      // their per-chunk split already — just finalize. Live rows always have an
      // attestation and go through the mint→split retry below.
      if (row.optimistic && !row.attestation) {
        if (simulate) {
          await finalizeLedgerByToken(token);
          settled++;
          results.push({ token, ok: true });
        } else {
          results.push({ token, ok: false, reason: "no_attestation" });
        }
        continue;
      }
      const r = await settlePendingByToken(token);
      if (r.ok) settled++;
      results.push({ token, ok: r.ok, reason: r.reason });
    } catch (e) {
      // Leave the row pending — don't write it off silently.
      results.push({ token, ok: false, reason: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }

  if (stale.length) {
    void recordAdminEvent({
      eventType: "PAYOUT",
      metadata: { kind: "sweep_pending", swept: stale.length, settled },
    });
  }
  return Response.json({ ok: true, swept: stale.length, settled, results });
}
