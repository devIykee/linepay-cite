import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_POLICY, type GuardianPolicy } from "@linepay/sdk";

const OWNER = "default-agent";

function readPolicy(): GuardianPolicy {
  const row = db().prepare(`SELECT json FROM policies WHERE owner = ?`).get(OWNER) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as GuardianPolicy) : DEFAULT_POLICY;
}

export async function GET() {
  return NextResponse.json({ policy: readPolicy() });
}

/** Update the Guardian policy the buyer agent enforces. */
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<GuardianPolicy>;
  const merged = { ...readPolicy(), ...body };
  db()
    .prepare(
      `INSERT INTO policies (id, owner, json, updated_at) VALUES (@id,@owner,@json,@updated_at)
       ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`
    )
    .run({ id: `pol_${OWNER}`, owner: OWNER, json: JSON.stringify(merged), updated_at: Date.now() });
  return NextResponse.json({ policy: merged });
}
