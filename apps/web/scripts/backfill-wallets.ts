/**
 * Provision developer-controlled wallets for users.
 *
 *   npm run db:backfill-wallets             — fill ONLY users with no wallet yet
 *   npm run db:backfill-wallets -- --replace — also REPLACE existing wallets
 *                                              (swaps legacy user-controlled
 *                                              wallets for dev-controlled ones)
 *
 * `--replace` re-provisions every non-admin user and overwrites their embedded
 * wallet id/address, re-pointing the payout to the new wallet when it was routing
 * to the old embedded one. Safe on testnet (old wallet funds are disposable).
 * Not idempotent in replace mode — running it twice creates fresh wallets again.
 *
 * Prerequisites: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET + CIRCLE_WALLET_SET_ID set.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { query } from "../lib/db.js";
import { setEmbeddedWallet, replaceEmbeddedWallet } from "../lib/store.js";
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

const REPLACE = process.argv.includes("--replace");

async function main() {
  if (!walletsEnabled()) {
    console.error("✗ Circle wallets not configured (need CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID).");
    process.exit(1);
  }

  // Replace mode: every non-admin user (overwrite legacy wallets too).
  // Default mode: only users still missing a wallet.
  const sql = REPLACE
    ? `SELECT id, email FROM users WHERE role <> 'admin'`
    : `SELECT id, email FROM users WHERE role <> 'admin' AND embedded_wallet_id IS NULL`;
  const users = await query<{ id: string; email: string }>(sql);

  if (users.length === 0) {
    console.log("✓ Nothing to do.");
    process.exit(0);
  }
  console.log(
    `${REPLACE ? "Replacing wallets for" : "Provisioning wallets for"} ${users.length} user(s)…`
  );
  let ok = 0;
  for (const u of users) {
    try {
      const w = await provisionWallet();
      if (REPLACE) await replaceEmbeddedWallet(u.id, w.id, w.address);
      else await setEmbeddedWallet(u.id, w.id, w.address);
      ok++;
      console.log(`  ✓ ${u.email} → ${w.address}`);
    } catch (e) {
      console.error(`  ✗ ${u.email}:`, (e as Error)?.message ?? e);
    }
  }
  console.log(`Done. ${ok}/${users.length} ${REPLACE ? "replaced" : "provisioned"}.`);
  process.exit(ok === users.length ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ Backfill failed:", e?.message ?? e);
  process.exit(1);
});
