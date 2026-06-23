/**
 * Remove all demo / seed data.
 *
 *   npm run db:purge-demo                 # DRY RUN — shows what would be deleted
 *   npm run db:purge-demo -- --yes        # actually delete
 *   npm run db:purge-demo -- --yes --all-agents --reset-counters
 *
 * "Demo data" = the seeded creators (by email, default `%@example.com`) and
 * everything attributable to them: their content, chunks, chapters, payouts,
 * and every payment_ledger / admin_event / report / pay_session row tied to that
 * content or those creators. Content/chunks/chapters also cascade on user delete;
 * we delete the SET-NULL rows explicitly first so nothing is left orphaned.
 *
 * Flags:
 *   --yes              execute (otherwise it's a dry run)
 *   --force            allow running even when PAYMENTS_MODE=live (default: refuse)
 *   --emails a@x,b@y   override which creator emails count as demo
 *   --all-agents       also clear ALL agent_sessions (agent discovery funnel)
 *   --reset-counters   also reset the funnel counters to empty
 *
 * Idempotent: re-running after a purge deletes nothing.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pool, tx } from "../lib/db.js";

function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const val = (f: string): string | undefined => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const EXECUTE = has("yes");
const FORCE = has("force");
const ALL_AGENTS = has("all-agents");
const RESET_COUNTERS = has("reset-counters");
const emailsArg = val("emails");

async function main() {
  const live = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() === "live";
  if (live && !FORCE) {
    console.error("⛔ PAYMENTS_MODE=live — refusing to purge real-mode data. Re-run with --force if you really mean it.");
    process.exit(1);
  }

  // Which creators are "demo": an explicit comma-separated list, or the
  // default @example.com domain used by every seed script.
  const emails = emailsArg ? emailsArg.split(",").map((e) => e.trim()).filter(Boolean) : null;

  await tx(async (c) => {
    // Resolve the demo creators and their content up front.
    const usersRes = emails
      ? await c.query<{ id: string; email: string; wallet_address: string | null }>(
          `SELECT id, email, wallet_address FROM users WHERE email = ANY($1)`,
          [emails]
        )
      : await c.query<{ id: string; email: string; wallet_address: string | null }>(
          `SELECT id, email, wallet_address FROM users WHERE email LIKE '%@example.com'`
        );
    const userIds = usersRes.rows.map((u) => u.id);
    const wallets = usersRes.rows.map((u) => u.wallet_address).filter((w): w is string => !!w);

    if (userIds.length === 0) {
      console.log("✓ No demo creators found — nothing to purge.");
      return;
    }

    const contentRes = await c.query<{ id: string }>(`SELECT id FROM content WHERE creator_id = ANY($1)`, [userIds]);
    const contentIds = contentRes.rows.map((r) => r.id);

    // Count helper (so the dry run reports real numbers).
    const count = async (sql: string, params: unknown[]): Promise<number> => {
      const r = await c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM (${sql}) s`, params);
      return Number(r.rows[0]?.n ?? 0);
    };

    const idArr = userIds;
    const cArr = contentIds.length ? contentIds : ["00000000-0000-0000-0000-000000000000"];
    const wArr = wallets.length ? wallets : ["__none__"];

    const plan = {
      creators: usersRes.rows.length,
      content: contentIds.length,
      chunks: await count(`SELECT 1 FROM chunks WHERE content_id = ANY($1)`, [cArr]),
      chapters: await count(`SELECT 1 FROM chapters WHERE content_id = ANY($1)`, [cArr]),
      ledger: await count(`SELECT 1 FROM payment_ledger WHERE content_id = ANY($1) OR creator_id = ANY($2)`, [cArr, idArr]),
      admin_events: await count(`SELECT 1 FROM admin_events WHERE content_id = ANY($1)`, [cArr]),
      reports: await count(
        `SELECT 1 FROM reports WHERE content_id = ANY($1) OR creator_id = ANY($2) OR reporter_id = ANY($2)`,
        [cArr, idArr]
      ),
      payouts: await count(`SELECT 1 FROM payouts WHERE creator_id = ANY($1)`, [idArr]),
      pay_sessions: await count(`SELECT 1 FROM pay_sessions WHERE main_wallet = ANY($1)`, [wArr]),
      agent_sessions: ALL_AGENTS ? await count(`SELECT 1 FROM agent_sessions`, []) : 0,
      counters: RESET_COUNTERS ? await count(`SELECT 1 FROM counters`, []) : 0,
    };

    console.log(`\nDemo creators: ${usersRes.rows.map((u) => u.email).join(", ")}`);
    console.log("Would delete:");
    for (const [k, v] of Object.entries(plan)) console.log(`  ${String(v).padStart(6)}  ${k}`);
    if (!ALL_AGENTS) console.log("  (agent_sessions kept — pass --all-agents to clear the agent funnel)");
    if (!RESET_COUNTERS) console.log("  (counters kept — pass --reset-counters to reset the funnel metrics)");

    if (!EXECUTE) {
      console.log("\nDRY RUN — nothing deleted. Re-run with --yes to execute.\n");
      throw new RollbackDryRun();
    }

    // Order: SET-NULL / unlinked rows first (so they don't orphan), then content
    // (cascades chunks + chapters), then the users themselves.
    await c.query(`DELETE FROM payment_ledger WHERE content_id = ANY($1) OR creator_id = ANY($2)`, [cArr, idArr]);
    await c.query(`DELETE FROM admin_events WHERE content_id = ANY($1)`, [cArr]);
    await c.query(`DELETE FROM reports WHERE content_id = ANY($1) OR creator_id = ANY($2) OR reporter_id = ANY($2)`, [cArr, idArr]);
    await c.query(`DELETE FROM pay_sessions WHERE main_wallet = ANY($1)`, [wArr]);
    await c.query(`DELETE FROM payouts WHERE creator_id = ANY($1)`, [idArr]);
    await c.query(`DELETE FROM content WHERE creator_id = ANY($1)`, [idArr]); // cascades chunks + chapters
    await c.query(`DELETE FROM users WHERE id = ANY($1)`, [idArr]);
    if (ALL_AGENTS) await c.query(`DELETE FROM agent_sessions`);
    if (RESET_COUNTERS) await c.query(`DELETE FROM counters`);

    console.log("\n✓ Demo data purged.\n");
  }).catch((e) => {
    if (e instanceof RollbackDryRun) return; // expected — dry run rolls back
    throw e;
  });

  await pool().end();
  process.exit(0);
}

/** Sentinel thrown to roll back the transaction on a dry run. */
class RollbackDryRun extends Error {}

main().catch((e) => {
  console.error("purge-demo failed:", (e as Error)?.message ?? e);
  process.exit(1);
});
