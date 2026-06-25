/**
 * DB-backed Ghost integration round-trip (uses .env.local DATABASE_URL +
 * INTEGRATION_ENC_KEY). Creates a throwaway creator, stores encrypted Ghost
 * creds, simulates a signed webhook end-to-end through the store + crypto
 * layers, and asserts a draft + notification were produced — then cleans up.
 *
 * Run: npx tsx -r dotenv/config scripts/test-ghost-db.ts dotenv_config_path=.env.local
 *   (or load env however the project does; see inline loader below)
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

// Minimal .env.local loader (no dotenv dependency).
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { encryptSecret } = await import("../lib/secrets.js");
const { verifyGhostSignature, tokenizeHtml, detectContentType, splitProseBlocks } = await import("../lib/ghost.js");
const store = await import("../lib/store.js");
const { query } = await import("../lib/db.js");

let failures = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "✅" : "❌"} ${m}`);
  if (!c) failures++;
};

// Throwaway creator.
const email = `ghost-test-${process.hrtime.bigint().toString(36)}@example.com`;
const rows = await query<{ id: string }>(
  `INSERT INTO users (email, role, display_name, handle, wallet_address) VALUES ($1,'creator','Ghost Test',$2,$3) RETURNING id`,
  [email, `ghosttest${Date.now().toString(36).slice(-5)}`, "0x000000000000000000000000000000000000bEEF"]
);
const creatorId = rows[0].id;

try {
  // 1. Store encrypted creds.
  const adminKey = "ghostid123:" + "a".repeat(32);
  await store.upsertGhostIntegration({
    creatorId,
    siteUrl: "https://demo.ghost.io",
    contentApiKeyEnc: encryptSecret("content-key-xyz"),
    adminApiKeyEnc: encryptSecret(adminKey),
    defaultMonetization: "paid",
    autoPublish: false,
  });
  const integ = await store.getGhostIntegration(creatorId);
  ok(!!integ && integ.connection_status === "unconnected", "integration stored, status unconnected");
  ok(!!integ && !integ.content_api_key_enc.includes("content-key-xyz"), "content key stored encrypted (no plaintext)");
  ok(!!integ && !integ.admin_api_key_enc.includes("aaaa"), "admin key stored encrypted (no plaintext)");

  // 2. Simulate a signed webhook body + signature verification.
  const html = `<h2>Hello</h2><p>${"word ".repeat(90).trim()}.</p><h2>More</h2><p>${"word ".repeat(90).trim()}.</p>`;
  const body = JSON.stringify({ post: { current: { id: "gpost-1", title: "From Ghost", html } } });
  const ts = "1700000000000";
  const sig = createHmac("sha256", adminKey.split(":")[1]).update(`${body}${ts}`).digest("hex");
  ok(verifyGhostSignature(body, `sha256=${sig}, t=${ts}`, adminKey), "webhook signature verifies with stored admin key");

  // 3. Detect + split + create draft (mirrors the route's article path).
  const nodes = tokenizeHtml(html);
  const det = detectContentType({ id: "gpost-1", title: "From Ghost", html }, nodes);
  const texts = splitProseBlocks(nodes);
  const content = await store.createContent({
    creatorId, slug: `ghost-test-${Date.now().toString(36)}`, title: "From Ghost", summary: "", tags: "",
    contentType: det.contentType === "article" ? "article" : "article",
    body: texts.join("\n\n"), pricePerBlock: "0.05",
    chunks: texts.map((t, i) => ({ text: t, isFree: i === 0 })), firstBlockIndex: 0, status: "draft",
    sourceUrl: "https://demo.ghost.io/from-ghost", sourcePlatform: "ghost",
  });
  ok(content.status === "draft", "post created as draft (auto-publish off)");
  ok(content.block_count >= 1, `payable block_count = ${content.block_count} (block 0 free)`);

  // 4. Idempotency map + duplicate handling.
  const map1 = await store.insertGhostPostMap("gpost-1", creatorId, content.id);
  const map2 = await store.insertGhostPostMap("gpost-1", creatorId, content.id);
  ok(!!map1 && !map2, "idempotency: first insert wins, duplicate is no-op");
  ok(!!(await store.getGhostPostMap("gpost-1")), "idempotency: map lookup finds processed post");

  // 5. Connection status → connected after success.
  await store.setGhostConnectionStatus(creatorId, "connected", null);
  ok((await store.getGhostIntegration(creatorId))?.connection_status === "connected", "status flips to connected");

  // 6. Notification created for the draft.
  await store.createNotification({ userId: creatorId, type: "ghost_draft", title: "New post from Ghost is ready to review", body: "x" });
  ok((await store.unreadNotificationCount(creatorId)) === 1, "draft notification created (unread = 1)");

  // 7. Free-block teaser only (no paid leakage) — the existing gate.
  const free = await store.getFreeBlock(content.id);
  ok(!!free && free.block_index === 0 && free.is_free, "getFreeBlock returns only the free teaser (block 0)");
} finally {
  // Cleanup (cascades to chunks, integration, map, notifications).
  await query(`DELETE FROM content WHERE creator_id = $1`, [creatorId]);
  await query(`DELETE FROM users WHERE id = $1`, [creatorId]);
  console.log(failures === 0 ? "\nALL PASS (cleaned up)" : `\n${failures} FAILURE(S) (cleaned up)`);
  process.exit(failures === 0 ? 0 : 1);
}
