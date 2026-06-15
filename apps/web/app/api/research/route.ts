import { NextRequest, NextResponse } from "next/server";
import { runResearch } from "@linepay/agent";
import { DEFAULT_POLICY, type GuardianPolicy } from "@linepay/sdk";
import { db } from "@/lib/db";

export const maxDuration = 120;

function loadPolicy(): GuardianPolicy {
  const row = db().prepare(`SELECT json FROM policies WHERE owner = ?`).get("default-agent") as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as GuardianPolicy) : DEFAULT_POLICY;
}

/**
 * Public endpoint that triggers the autonomous buyer agent.
 *
 *   POST /api/research  { "query": "...", "policy"?: {...} }
 *
 * Anyone (a human, or another agent) can hit this to make the buyer agent
 * discover, evaluate, pay for, and cite paywalled content.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const policy: GuardianPolicy = body.policy ? { ...loadPolicy(), ...body.policy } : loadPolicy();
  const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;

  try {
    const result = await runResearch(query, { baseUrl, policy });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: "agent_failed", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
