/**
 * One-time setup: create the Circle wallet set that owns every developer-
 * controlled user wallet, and print its id.
 *
 *   node scripts/circle-create-walletset.mjs        (from apps/web)
 *
 * Prerequisites: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET set (the entity secret
 * must already be registered with Circle). Paste the printed id into
 * CIRCLE_WALLET_SET_ID in your .env and Vercel.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

function loadEnvFile(file) {
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

// Load apps/web/.env.local, apps/web/.env, then the repo-root .env.
loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env"));

function normalizeApiKey(raw) {
  const key = raw.trim();
  if (/^(TEST|LIVE)_API_KEY:/.test(key)) return key;
  if (key.split(":").length === 2) return `TEST_API_KEY:${key}`;
  return key;
}

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
if (!apiKey || !entitySecret) {
  console.error("✗ CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set (and the entity secret registered).");
  process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey: normalizeApiKey(apiKey),
  entitySecret,
});

client
  .createWalletSet({ name: "Skimflow user wallets" })
  .then((res) => {
    const id = res.data?.walletSet?.id;
    if (!id) throw new Error("no wallet set id returned");
    console.log("✓ Wallet set created.\n");
    console.log(`  CIRCLE_WALLET_SET_ID=${id}\n`);
    console.log("Paste that into your .env (root) and Vercel, then redeploy.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("✗ Wallet set creation failed:", e?.message ?? e);
    process.exit(1);
  });
