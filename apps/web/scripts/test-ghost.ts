/**
 * Local simulation of the Ghost pipeline (no live Ghost needed):
 *   signature round-trip → tokenize → detect → split, for each content type.
 * Run: npx tsx scripts/test-ghost.ts
 */
import { createHmac } from "node:crypto";
import {
  detectContentType,
  splitAgentBlocks,
  splitPictureBlocks,
  splitProseBlocks,
  tokenizeHtml,
  verifyGhostSignature,
  type GhostPost,
} from "../lib/ghost.js";

let failures = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
}

// ── 1. Signature round-trip ──────────────────────────────────────────────────
{
  const adminKey = "abc123:deadbeefcafe";
  const body = JSON.stringify({ post: { current: { id: "p1" } } });
  const ts = "1700000000000";
  const sig = createHmac("sha256", "deadbeefcafe").update(`${body}${ts}`).digest("hex");
  const header = `sha256=${sig}, t=${ts}`;
  ok(verifyGhostSignature(body, header, adminKey), "signature: valid HMAC verifies (secret half)");
  ok(!verifyGhostSignature(body, `sha256=deadbeef, t=${ts}`, adminKey), "signature: wrong HMAC rejected");
  ok(!verifyGhostSignature(body, null, adminKey), "signature: missing header rejected");
}

// ── 2. Article detection + split ─────────────────────────────────────────────
{
  const para = "<p>" + "word ".repeat(60).trim() + ".</p>";
  const html = `<h2>Intro</h2>${para}${para}<h2>Middle</h2>${para}${para}<h2>End</h2>${para}`;
  const post: GhostPost = { id: "a1", title: "A normal post", tags: [{ name: "essay" }], html };
  const nodes = tokenizeHtml(html);
  const det = detectContentType(post, nodes);
  ok(det.contentType === "article", `article: detected (${det.detectionReason})`);
  const blocks = splitProseBlocks(nodes);
  ok(blocks.length >= 2, `article: produced ${blocks.length} blocks`);
  ok(blocks[0].startsWith("## Intro"), "article: heading leads its block (R1)");
}

// ── 3. Picture detection + split ─────────────────────────────────────────────
{
  const html = `
    <figure><img src="https://x/1.jpg"/><figcaption>First</figcaption></figure>
    <p>Short</p>
    <figure><img src="https://x/2.jpg"/><figcaption>Second</figcaption></figure>
    <figure><img src="https://x/3.jpg"/></figure>
    <figure><img src="https://x/4.jpg"/></figure>`;
  const post: GhostPost = { id: "pic1", title: "Gallery day", tags: [{ name: "photography" }], html };
  const nodes = tokenizeHtml(html);
  const det = detectContentType(post, nodes);
  ok(det.contentType === "picture", `picture: detected (${det.detectionReason})`);
  const blocks = splitPictureBlocks(nodes);
  ok(blocks.length === 4, `picture: ${blocks.length} blocks (4 images)`);
  ok(blocks[0].text === "https://x/1.jpg" && blocks[0].imageUrl === "https://x/1.jpg", "picture: block text is image URL");
  ok(blocks[2].caption === null && blocks[3].caption === null, "picture: caption-less images paired");
}

// ── 4. Book detection ────────────────────────────────────────────────────────
{
  const para = "<p>" + "story ".repeat(80).trim() + ".</p>";
  const html = para.repeat(20); // ~1600 words, over the 1500 book threshold
  const post: GhostPost = { id: "b1", title: "Chapter 3: The Descent", tags: [{ name: "fiction" }], html };
  const nodes = tokenizeHtml(html);
  const det = detectContentType(post, nodes);
  ok(det.contentType === "book", `book: detected (${det.detectionReason})`);
  ok(det.seriesNumber === 3, `book: series number parsed = ${det.seriesNumber}`);
}

// ── 5. Agent skill detection + split ─────────────────────────────────────────
{
  const html = `
    <p>This skill teaches an agent to summarize text. Use it like so.</p>
    <pre><code>function summarize(t){ return t.slice(0,100); }</code></pre>
    <p>Then call it with the input document.</p>
    <pre><code>const out = summarize(doc);</code></pre>
    <p>It returns the first 100 chars.</p>`;
  const post: GhostPost = { id: "s1", title: "skill: summarizer", tags: [{ name: "agent" }], html };
  const nodes = tokenizeHtml(html);
  const det = detectContentType(post, nodes);
  ok(det.contentType === "agent_skills", `agent_skill: detected (${det.detectionReason})`);
  const blocks = splitAgentBlocks(nodes);
  ok(blocks.length >= 2, `agent_skill: ${blocks.length} blocks`);
  ok(blocks[0].includes("This skill teaches"), "agent_skill: intro is block 0");
  ok(blocks.some((b) => b.includes("```")), "agent_skill: code preserved in fenced block (R5)");
}

// ── 6. Code & blockquote stay whole ──────────────────────────────────────────
{
  const html = `<p>${"w ".repeat(70).trim()}.</p><blockquote>${"q ".repeat(50).trim()}.</blockquote><pre><code>line1\nline2\nline3</code></pre>`;
  const nodes = tokenizeHtml(html);
  const code = nodes.find((n) => n.kind === "code");
  ok(!!code && code.markdown.includes("line1") && code.markdown.includes("line3"), "code: whole block kept (R5)");
  const quote = nodes.find((n) => n.kind === "blockquote");
  ok(!!quote && quote.markdown.startsWith("> "), "blockquote: whole + quoted (R6)");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
