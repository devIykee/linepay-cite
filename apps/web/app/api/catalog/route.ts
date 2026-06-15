import { NextResponse } from "next/server";
import { catalog } from "@/lib/store";

/** Public catalog the buyer agent's discovery tool searches over. */
export async function GET() {
  return NextResponse.json({ items: catalog() });
}
