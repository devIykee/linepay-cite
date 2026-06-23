#!/usr/bin/env node
/**
 * Autonomous research-agent CLI. Give it a query; it discovers the catalog,
 * decides what's worth buying within a budget, pays per block over x402, and
 * prints a cited answer + the full reasoning/payment trace.
 *
 *   npm run research -- "how do nanopayments change online writing?" --simulate
 *   npm run research -- "writing emotional scenes" --url https://skimflow.vercel.app --budget 0.25
 *   (live needs BUYER_PRIVATE_KEY for a funded Arc wallet; default is simulate)
 */
import { runResearch } from "./research.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  // The query is the first non-flag argument (flags + their values are skipped).
  const argv = process.argv.slice(2);
  const flagsWithValues = new Set(["url", "budget", "sources", "blocks"]);
  let query: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (flagsWithValues.has(a.slice(2))) i++; // skip its value
      continue;
    }
    query = a;
    break;
  }

  const baseUrl = flag("url") ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const simulate = has("simulate") || (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";

  if (!query) {
    console.error('Usage: npm run research -- "<query>" [--url <baseUrl>] [--budget 0.5] [--sources 3] [--blocks 8] [--simulate]');
    process.exit(1);
  }

  console.log(`\n🤖 Skimflow research agent`);
  console.log(`   query:  ${query}`);
  console.log(`   server: ${baseUrl}`);
  console.log(`   mode:   ${simulate ? "simulate" : "live"}\n`);

  const result = await runResearch({
    baseUrl,
    query,
    simulate,
    budgetUsdc: flag("budget") ? Number(flag("budget")) : undefined,
    maxSources: flag("sources") ? Number(flag("sources")) : undefined,
    perSourceMaxBlocks: flag("blocks") ? Number(flag("blocks")) : undefined,
  });

  console.log(`\n🧠 brain: ${result.modelLabel}`);
  console.log(`\n📚 Answer\n${"─".repeat(60)}\n${result.answer}\n${"─".repeat(60)}`);
  if (result.citations.length) {
    console.log(`\nSources paid for:`);
    for (const c of result.citations) console.log(`  [${c.n}] ${c.name} — ${c.creator ?? "unknown"} (/read/${c.slug})`);
  }
  console.log(`\n💰 spent $${result.spent} of $${result.budget} across ${result.purchased.length} source(s).\n`);
}

main().catch((e) => {
  console.error("research agent error:", e?.message ?? e);
  process.exit(1);
});
