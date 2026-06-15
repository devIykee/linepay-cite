import { NextRequest, NextResponse } from "next/server";
import { recentPayments } from "@/lib/store";

/** Live transaction feed of nanopayments to creators. */
export async function GET(req: NextRequest) {
  const limit = Math.min(200, parseInt(new URL(req.url).searchParams.get("limit") ?? "50", 10));
  return NextResponse.json({ payments: recentPayments(limit) });
}
