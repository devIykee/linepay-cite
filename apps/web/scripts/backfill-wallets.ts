/**
 * Backfill: provision a developer-controlled wallet for every existing non-admin
 * user who doesn't have one yet (e.g. accounts created before the dev-controlled
 * migration). Idempotent — re-running only touches users still missing a wallet.
 *
 *   npm run db:backfill-wallets        (from apps/web)
 *
 * Prerequisites: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET + CIRCLE_WALLET_SET_ID set.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { query } from "../lib/db.js";
import { setEmbeddedWallet } from "../lib/store.js";
import { provisionWallet, walletsEnabled } from "../lib/circle-wallets.js";

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env"));

async function main() {
  if (!walletsEnabled()) {
    console.error("✗ Circle wallets not configured (need CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID).");
    process.exit(1);
  }
  const users = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role <> 'admin' AND embedded_wallet_id IS NULL`
  );
  if (users.length === 0) {
    console.log("✓ All non-admin users already have a wallet — nothing to backfill.");
    process.exit(0);
  }
  console.log(`Provisioning wallets for ${users.length} user(s)…`);
  let ok = 0;
  for (const u of users) {
    try {
      const w = await provisionWallet();
      await setEmbeddedWallet(u.id, w.id, w.address);
      ok++;
      console.log(`  ✓ ${u.email} → ${w.address}`);
    } catch (e) {
      console.error(`  ✗ ${u.email}:`, (e as Error)?.message ?? e);
    }
  }
  console.log(`Done. ${ok}/${users.length} provisioned.`);
  process.exit(ok === users.length ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ Backfill failed:", e?.message ?? e);
  process.exit(1);
});
