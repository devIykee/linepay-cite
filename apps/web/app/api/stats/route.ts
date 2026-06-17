import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public traction stats for the landing hero (no auth). */
export async function GET() {
  const r = await queryOne<{
    payments: number;
    human: number;
    agent: number;
    volume: string;
    to_creators: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status='completed')::int AS payments,
       COUNT(*) FILTER (WHERE status='completed' AND payer_kind='human')::int AS human,
       COUNT(*) FILTER (WHERE status='completed' AND payer_kind='agent')::int AS agent,
       COALESCE(SUM(gross_amount) FILTER (WHERE status='completed'),0)::text AS volume,
       COALESCE(SUM(creator_amount) FILTER (WHERE status='completed'),0)::text AS to_creators
     FROM payment_ledger`
  );
  const c = await queryOne<{ creators: number }>(`SELECT COUNT(*)::int AS creators FROM users`);
  return Response.json({
    volumeDisplay: `$${Number(r?.volume ?? 0).toFixed(4)}`,
    toCreatorsDisplay: `$${Number(r?.to_creators ?? 0).toFixed(4)}`,
    payments: r?.payments ?? 0,
    humanPayments: r?.human ?? 0,
    agentPayments: r?.agent ?? 0,
    linesSold: r?.payments ?? 0,
    creators: c?.creators ?? 0,
  });
}
