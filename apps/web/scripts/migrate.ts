/**
 * Migration runner. Applies every db/migrations/*.sql exactly once.
 *
 *   npm run db:migrate            (from apps/web)
 *
 * Loads DATABASE_URL (and other vars) from .env.local then .env if not already
 * present in the environment, so it works the same as `next dev`.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../lib/db.js";

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

runMigrations()
  .then(({ applied }) => {
    if (applied.length === 0) {
      console.log("✓ Database already up to date — no migrations applied.");
    } else {
      console.log(`✓ Applied ${applied.length} migration(s):`);
      for (const f of applied) console.log(`  - ${f}`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error("✗ Migration failed:", e?.message ?? e);
    process.exit(1);
  });
