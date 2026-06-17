#!/usr/bin/env node
/**
 * Generates demo traction against a running server so the admin dashboards,
 * funnel, and home stats are populated: an autonomous agent discovers content
 * and unlocks blocks via the 402 → X-Payment-Token flow (simulate mode).
 *
 *   node scripts/demo-traffic.mjs
 *   APP_BASE_URL=https://… node scripts/demo-traffic.mjs
 */
const BASE = process.env.APP_BASE_URL || "http://localhost:3000";

const tok = (k) => `sim_${Date.now().toString(36)}_${k}_${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  console.log(`Generating demo traffic against ${BASE} …`);

  // Discovery hit (funnel: .well-known).
  await fetch(`${BASE}/.well-known/agent-payment.json`).catch(() => {});

  const res = await fetch(`${BASE}/api/marketplace`).catch(() => null);
  const { items } = res ? await res.json() : { items: [] };
  if (!items?.length) {
    console.error("No content — run `npm run seed` first.");
    process.exit(1);
  }

  let unlocks = 0;
  for (const item of items) {
    // Free block 0 (funnel: block-0 fetch).
    await fetch(`${BASE}/read/${item.slug}/agent-skills.md`).catch(() => {});
    const blocks = Math.min(item.blockCount || 3, 3);
    for (let b = 1; b <= blocks; b++) {
      // First request → 402 (records a 402_HIT + upserts the agent session).
      await fetch(`${BASE}/read/${item.slug}/agent-skills.md?block=${b}`).catch(() => {});
      // Pay with a simulate token → block returned + completed ledger row.
      const r = await fetch(`${BASE}/read/${item.slug}/agent-skills.md?block=${b}`, {
        headers: { "X-Payment-Token": tok(`${item.slug}-${b}`) },
      }).catch(() => null);
      if (r && r.ok) {
        unlocks++;
        console.log(`  🤖 unlocked "${item.title}" block ${b}`);
      }
    }
  }

  const s = await (await fetch(`${BASE}/api/stats`)).json().catch(() => ({}));
  console.log(
    `\n✅ ${unlocks} agent unlock(s). Traction: ${s.volumeDisplay ?? "$0"} · ${s.payments ?? 0} payments (🤖 ${s.agentPayments ?? 0}) · ${s.toCreatorsDisplay ?? "$0"} to creators`
  );
}

main().catch((e) => {
  console.error("demo-traffic failed:", e.message);
  process.exit(1);
});
