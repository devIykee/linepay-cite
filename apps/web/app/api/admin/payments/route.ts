import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { listLedger } from "@/lib/store";
import { paymentTotals } from "@/lib/admin";
import type { LedgerStatus, PayerKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const [rows, totals] = await Promise.all([
      listLedger({
        contentId: sp.get("contentId") ?? undefined,
        creatorId: sp.get("creatorId") ?? undefined,
        payerKind: (sp.get("payerKind") as PayerKind | null) ?? undefined,
        status: (sp.get("status") as LedgerStatus | null) ?? undefined,
        search: sp.get("search") ?? undefined,
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
        limit: Number(sp.get("limit")) || 50,
        offset: Number(sp.get("offset")) || 0,
      }),
      paymentTotals(),
    ]);
    return Response.json({ rows, totals });
  } catch (e) {
    return errorResponse(e);
  }
}
