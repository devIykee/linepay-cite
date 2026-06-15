import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { listCreators, upsertCreator } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ creators: listCreators() });
}

/** Register / update a creator (wallet, display name, verified flag). */
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.handle || !b.wallet) {
    return NextResponse.json({ error: "handle and wallet required" }, { status: 400 });
  }
  const creator = upsertCreator({
    id: b.id ?? `cr_${randomUUID().slice(0, 8)}`,
    handle: String(b.handle).replace(/^@/, ""),
    display_name: b.display_name ?? b.handle,
    wallet: b.wallet,
    verified: b.verified ? 1 : 0,
  });
  return NextResponse.json({ creator });
}
