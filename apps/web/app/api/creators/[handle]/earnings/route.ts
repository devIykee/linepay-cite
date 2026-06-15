import { NextRequest, NextResponse } from "next/server";
import { getCreatorByHandle, creatorEarnings } from "@/lib/store";
import { formatUsdc } from "@linepay/sdk";

/** Real-time earnings dashboard data for one creator. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ handle: string }> }) {
  const { handle } = await ctx.params;
  const creator = getCreatorByHandle(handle.replace(/^@/, ""));
  if (!creator) return NextResponse.json({ error: "creator_not_found" }, { status: 404 });
  const e = creatorEarnings(creator.id);
  return NextResponse.json({
    creator,
    earnedBaseUnits: e.earned,
    earnedDisplay: formatUsdc(e.earned),
    payments: e.payments,
    linesSold: e.lines_sold,
    history: e.history.map((h: any) => ({ ...h, amountDisplay: formatUsdc(h.creator_amount) })),
  });
}
