/**
 * Ghost CMS integration — the bridge that turns a published Ghost post into
 * Skimflow blocks. Pure, dependency-free, server-side.
 *
 * Pipeline (driven by the webhook receiver):
 *   1. verifyGhostSignature  — HMAC-validate the webhook before trusting it
 *   2. fetchGhostPost        — pull the FULL post via the Content API (the
 *                              webhook payload may be truncated)
 *   3. tokenizeHtml          — Ghost's HTML → an ordered list of block nodes,
 *                              each carrying a Markdown rendering of itself
 *   4. detectContentType     — map the post to article | book | picture |
 *                              agent_skills (Section C)
 *   5. splitIntoBlocks       — group nodes into payable blocks per the Section D
 *                              rules, in the exact { text, isFree, imageUrl?,
 *                              caption? } shape createContent() expects
 *
 * Skimflow's reader renders chunk `text` as Markdown (components/RichText), so
 * every node renders itself to Markdown — never raw HTML. We hand-roll a small
 * block-level tokenizer rather than add an HTML-parser dependency.
 *
 * SECURITY: the Admin API key is the webhook-signing secret. It is read here for
 * HMAC verification only and is never logged, returned, or embedded in errors.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ContentType } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Skimflow's content-type mapping target. Note: stored type is "agent-skills". */
export type DetectedType = "article" | "book" | "picture" | "agent_skills";

export interface DetectionResult {
  contentType: DetectedType;
  confidence: number; // 0..1
  detectionReason: string;
  /** Series number parsed from a book title ("Chapter 3" → 3), else null. */
  seriesNumber: number | null;
}

/** A block-level node parsed from Ghost HTML, with its Markdown rendering. */
export interface BlockNode {
  kind: "heading" | "paragraph" | "image" | "code" | "blockquote" | "list" | "other";
  /** Markdown rendering of this node (what gets stored in chunk.text). */
  markdown: string;
  /** Word count of the node's visible text (0 for images/code, by the rules). */
  words: number;
  /** Image nodes only. */
  imageUrl?: string;
  caption?: string;
  /** Heading nodes only: 1..3 (only H1–H3 are hard splits). */
  headingLevel?: number;
}

/** A finished block in the shape createContent() / createBook() consume. */
export interface SplitBlock {
  text: string;
  isFree: boolean;
  imageUrl?: string | null;
  caption?: string | null;
}

/** Minimal shape of a Ghost post (Content API `posts` resource). */
export interface GhostPost {
  id: string;
  uuid?: string;
  title?: string;
  slug?: string;
  html?: string;
  excerpt?: string;
  custom_excerpt?: string;
  feature_image?: string | null;
  published_at?: string;
  url?: string;
  tags?: Array<{ name?: string; slug?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a Ghost webhook signature. Ghost signs with the integration's secret
 * and sends `x-ghost-signature: sha256=<hex>, t=<ms>`. The signed message is
 * `<raw-body><timestamp>`. We HMAC-SHA256 the body+timestamp with the stored
 * Admin API key and compare in constant time.
 *
 * Ghost's Admin API key is "{id}:{hex-secret}"; the HMAC secret is the part
 * after the colon (the hex secret). We try both the full key and the secret
 * half so a creator who pastes either form still verifies.
 */
export function verifyGhostSignature(rawBody: string, signatureHeader: string | null, adminApiKey: string): boolean {
  if (!signatureHeader || !adminApiKey) return false;

  // Header form: "sha256=<hex>, t=<unix-ms>"
  const shaMatch = signatureHeader.match(/sha256=([a-f0-9]+)/i);
  const tMatch = signatureHeader.match(/t=(\d+)/);
  if (!shaMatch) return false;
  const provided = shaMatch[1];
  const ts = tMatch ? tMatch[1] : "";
  const message = `${rawBody}${ts}`;

  const secretHalf = adminApiKey.includes(":") ? adminApiKey.split(":")[1] : adminApiKey;
  const candidates = adminApiKey === secretHalf ? [adminApiKey] : [secretHalf, adminApiKey];

  for (const secret of candidates) {
    const expected = createHmac("sha256", secret).update(message).digest("hex");
    try {
      const a = Buffer.from(provided, "hex");
      const b = Buffer.from(expected, "hex");
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      /* try next candidate */
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content API fetch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the full post from the Ghost Content API by id. The webhook payload can
 * be truncated, so we always re-fetch with `formats=html` to get the complete
 * body. Returns null on any failure (network, 404, bad key).
 */
export async function fetchGhostPost(siteUrl: string, contentApiKey: string, postId: string): Promise<GhostPost | null> {
  const base = siteUrl.replace(/\/$/, "");
  const url =
    `${base}/ghost/api/content/posts/${encodeURIComponent(postId)}/` +
    `?key=${encodeURIComponent(contentApiKey)}&formats=html&include=tags`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { posts?: GhostPost[] };
    return data.posts?.[0] ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML → block nodes (small, block-level tokenizer)
// ─────────────────────────────────────────────────────────────────────────────

const WS = /\s+/g;
const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Strip all tags → visible text, collapsing whitespace. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(WS, " ").trim();
}

function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Inline HTML → Markdown (links, emphasis, inline code, <br>). */
function inlineToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${stripInline(inner)}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${stripInline(inner)}*`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${stripTags(inner)}\``);
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => `[${stripInline(inner)}](${href})`);
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

/** Like inlineToMarkdown but for already-extracted inner text (no link/emphasis re-pass needed at depth). */
function stripInline(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(WS, " ").trim();
}

/** First <img src> + alt within an HTML fragment, if any. */
function extractImage(html: string): { src: string; alt: string } | null {
  const m = html.match(/<img\b[^>]*>/i);
  if (!m) return null;
  const tag = m[0];
  const src = tag.match(/\bsrc="([^"]*)"/i)?.[1] ?? tag.match(/\bsrc='([^']*)'/i)?.[1] ?? "";
  const alt = tag.match(/\balt="([^"]*)"/i)?.[1] ?? "";
  if (!src) return null;
  return { src, alt: decodeEntities(alt) };
}

/**
 * Tokenize Ghost HTML into ordered block-level nodes. Recognizes the elements
 * Ghost actually emits: h1–h6, p, figure/img, figcaption, pre/code, blockquote,
 * ul/ol. Unknown wrappers fall through to their text as a paragraph.
 */
export function tokenizeHtml(html: string): BlockNode[] {
  const nodes: BlockNode[] = [];
  if (!html) return nodes;
  // Normalize and drop comments/scripts/styles.
  let src = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Block-level matcher: walk the string finding the next recognized block.
  const blockRe =
    /<figure\b[^>]*>([\s\S]*?)<\/figure>|<(h[1-6])\b[^>]*>([\s\S]*?)<\/\2>|<pre\b[^>]*>([\s\S]*?)<\/pre>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\6>|<p\b[^>]*>([\s\S]*?)<\/p>|<img\b[^>]*>/gi;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src)) !== null) {
    const whole = m[0];

    // <figure> — usually an image with optional <figcaption>.
    if (m[1] !== undefined || /^<figure/i.test(whole)) {
      const inner = m[1] ?? "";
      const img = extractImage(inner) ?? extractImage(whole);
      const capMatch = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
      const caption = capMatch ? stripInline(capMatch[1]) : img?.alt ?? "";
      if (img) {
        nodes.push({ kind: "image", markdown: imageMarkdown(img.src, caption), words: 0, imageUrl: img.src, caption });
      } else {
        const text = stripTags(inner);
        if (text) nodes.push({ kind: "paragraph", markdown: inlineToMarkdown(inner), words: wordCount(text) });
      }
      continue;
    }

    // Headings h1–h6 (only 1–3 are hard split boundaries; 4–6 render but don't split).
    if (m[2]) {
      const level = Number(m[2].slice(1));
      const text = stripInline(m[3] ?? "");
      if (text) nodes.push({ kind: "heading", markdown: `${"#".repeat(level)} ${text}`, words: wordCount(text), headingLevel: level });
      continue;
    }

    // <pre> (code block) — keep whole, fenced. Never split (Rule 5).
    if (m[4] !== undefined) {
      const codeInner = m[4].match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)?.[1] ?? m[4];
      const code = decodeEntities(codeInner.replace(/<[^>]+>/g, "")).replace(/\n+$/, "");
      nodes.push({ kind: "code", markdown: "```\n" + code + "\n```", words: 0 });
      continue;
    }

    // <blockquote> — keep whole (Rule 6).
    if (m[5] !== undefined) {
      const text = inlineToMarkdown(m[5]);
      const quoted = text.split("\n").map((l) => `> ${l}`).join("\n");
      if (text) nodes.push({ kind: "blockquote", markdown: quoted, words: wordCount(stripTags(m[5])) });
      continue;
    }

    // Lists ul/ol → markdown bullets/numbers.
    if (m[6]) {
      const ordered = m[6].toLowerCase() === "ol";
      const items = [...(m[7] ?? "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li) => inlineToMarkdown(li[1]));
      const md = items.map((it, i) => `${ordered ? `${i + 1}.` : "-"} ${it}`).join("\n");
      if (md) nodes.push({ kind: "list", markdown: md, words: wordCount(stripTags(m[7] ?? "")) });
      continue;
    }

    // <p> — may itself wrap an image (Ghost sometimes does this).
    if (m[8] !== undefined) {
      const inner = m[8];
      const img = extractImage(inner);
      if (img && stripTags(inner.replace(/<img\b[^>]*>/i, "")).length === 0) {
        nodes.push({ kind: "image", markdown: imageMarkdown(img.src, img.alt), words: 0, imageUrl: img.src, caption: img.alt });
      } else {
        const text = stripTags(inner);
        if (text) nodes.push({ kind: "paragraph", markdown: inlineToMarkdown(inner), words: wordCount(text) });
      }
      continue;
    }

    // Bare <img>.
    if (/^<img/i.test(whole)) {
      const img = extractImage(whole);
      if (img) nodes.push({ kind: "image", markdown: imageMarkdown(img.src, img.alt), words: 0, imageUrl: img.src, caption: img.alt });
      continue;
    }
  }

  return nodes;
}

function imageMarkdown(src: string, caption: string): string {
  const alt = (caption || "").replace(/[[\]]/g, "");
  return caption ? `![${alt}](${src})\n\n*${caption}*` : `![${alt}](${src})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section C — content-type detection
// ─────────────────────────────────────────────────────────────────────────────

const BOOK_TITLE_RE = /\b(chapter|part|episode)\s+(\d+|[ivxlcdm]+)\b/i;

/** Parse "Chapter 3" / "Part II" → series number for ordering (roman or arabic). */
function parseSeriesNumber(title: string): number | null {
  const m = title.match(BOOK_TITLE_RE);
  if (!m) return null;
  const raw = m[2];
  if (/^\d+$/.test(raw)) return Number(raw);
  // Minimal roman → int.
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const r = raw.toLowerCase();
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const cur = map[r[i]] ?? 0;
    const next = map[r[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total || null;
}

/**
 * Map a Ghost post to a Skimflow content type (Section C). Checks in the
 * mandated order: picture → book → agent_skill → article (default). Always
 * returns a reason string for debugging misclassifications.
 */
export function detectContentType(post: GhostPost, nodes: BlockNode[]): DetectionResult {
  const tags = (post.tags ?? []).map((t) => (t.slug || t.name || "").toLowerCase());
  const title = post.title ?? "";
  const html = post.html ?? "";

  const images = nodes.filter((n) => n.kind === "image").length;
  const paragraphs = nodes.filter((n) => n.kind === "paragraph");
  const paraCount = paragraphs.length;
  const totalWords = nodes.reduce((n, x) => n + x.words, 0);
  const avgParaWords = paraCount > 0 ? paragraphs.reduce((n, p) => n + p.words, 0) / paraCount : 0;
  const hasTag = (set: string[]) => tags.some((t) => set.includes(t));

  // ── PICTURE (check first) ───────────────────────────────────────────────────
  const imgToParaRatio = paraCount > 0 ? images / paraCount : images > 0 ? Infinity : 0;
  const pictureByRatio = images > 0 && imgToParaRatio > 0.7 && avgParaWords < 30;
  const pictureByTag = images > 0 && hasTag(["photo", "photography", "gallery", "visual"]);
  if (pictureByRatio || pictureByTag) {
    return {
      contentType: "picture",
      confidence: pictureByRatio && pictureByTag ? 0.95 : 0.8,
      detectionReason: pictureByRatio
        ? `picture: ${images} images / ${paraCount} paragraphs (ratio ${imgToParaRatio.toFixed(2)} > 0.7), avg paragraph ${avgParaWords.toFixed(0)} words < 30`
        : `picture: photo/gallery tag present with ${images} image(s)`,
      seriesNumber: null,
    };
  }

  // ── SERIALIZED BOOK ─────────────────────────────────────────────────────────
  const bookTag = hasTag(["series", "chapter", "part", "episode", "fiction", "serial"]);
  const titleSeries = BOOK_TITLE_RE.test(title);
  if ((bookTag || titleSeries) && totalWords > 1500) {
    return {
      contentType: "book",
      confidence: bookTag && titleSeries ? 0.9 : 0.75,
      detectionReason: `book: ${[bookTag && "series tag", titleSeries && "title series pattern"].filter(Boolean).join(" + ")}, ${totalWords} words > 1500`,
      seriesNumber: parseSeriesNumber(title),
    };
  }

  // ── AGENT SKILL ─────────────────────────────────────────────────────────────
  const codeChars = (html.match(/<(code|pre)\b[\s\S]*?<\/\1>/gi) ?? []).join("").replace(/<[^>]+>/g, "").length;
  const textChars = stripTags(html).length || 1;
  const codeRatio = codeChars / (textChars + codeChars);
  const agentTag = hasTag(["agent", "skill", "tool", "prompt", "ai-tool", "automation"]);
  const agentPrefix = /^(skill|tool|agent):/i.test(title.trim());
  if (codeRatio > 0.4 || agentTag || agentPrefix) {
    // Codeful posts are the strongest signal; tag/prefix alone still qualifies.
    return {
      contentType: "agent_skills",
      confidence: codeRatio > 0.4 ? 0.85 : 0.7,
      detectionReason: `agent_skill: ${[
        codeRatio > 0.4 && `code ratio ${(codeRatio * 100).toFixed(0)}% > 40%`,
        agentTag && "agent/skill tag",
        agentPrefix && "title prefix",
      ]
        .filter(Boolean)
        .join(" + ")}`,
      seriesNumber: null,
    };
  }

  // ── ARTICLE (default) ───────────────────────────────────────────────────────
  return {
    contentType: "article",
    confidence: 0.6,
    detectionReason: `article: fallback (images ${images}, paragraphs ${paraCount}, words ${totalWords}, code ${(codeRatio * 100).toFixed(0)}%)`,
    seriesNumber: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section D — block splitting
// ─────────────────────────────────────────────────────────────────────────────

const MIN_WORDS = 80;
const MAX_WORDS = 400;
const SPLIT_AFTER = 300; // when a section exceeds MAX, split at first paragraph past this

/** Join the markdown of a group of nodes into one block's text. */
function joinNodes(group: BlockNode[]): string {
  return group.map((n) => n.markdown).join("\n\n").trim();
}
function groupWords(group: BlockNode[]): number {
  return group.reduce((n, x) => n + x.words, 0);
}

/**
 * General-rules splitter for article / book / agent (the prose path). Produces
 * an ordered list of block texts honoring:
 *   R1 headings (h1–h3) are hard splits,
 *   R2 min 80 words OR one image (merge forward otherwise),
 *   R3 max 400 words (split at first paragraph boundary past 300),
 *   R4 images stay with adjacent context,
 *   R5 code never split, R6 blockquotes never split.
 */
export function splitProseBlocks(nodes: BlockNode[]): string[] {
  if (nodes.length === 0) return [];

  // Step 1 — cut into sections at h1–h3 boundaries (heading leads its section).
  const sections: BlockNode[][] = [];
  let cur: BlockNode[] = [];
  for (const node of nodes) {
    const isHardHeading = node.kind === "heading" && (node.headingLevel ?? 9) <= 3;
    if (isHardHeading && cur.length > 0) {
      sections.push(cur);
      cur = [];
    }
    cur.push(node);
  }
  if (cur.length > 0) sections.push(cur);

  // Step 2 — within each section, enforce the 400-word ceiling. Code & quote
  // nodes are atomic and never start a forced mid-section split through them.
  const sized: BlockNode[][] = [];
  for (const section of sections) {
    let block: BlockNode[] = [];
    let words = 0;
    for (const node of section) {
      block.push(node);
      words += node.words;
      const atBreakable = node.kind === "paragraph" || node.kind === "list" || node.kind === "image";
      if (words > SPLIT_AFTER && words >= MAX_WORDS && atBreakable) {
        sized.push(block);
        block = [];
        words = 0;
      }
    }
    if (block.length > 0) sized.push(block);
  }

  // Step 3 — merge-forward any block under the minimum (80 words OR one image).
  const merged: BlockNode[][] = [];
  for (const block of sized) {
    const meets = groupWords(block) >= MIN_WORDS || block.some((n) => n.kind === "image");
    if (!meets && merged.length === 0 && sized.length > 1) {
      // First block too small → seed it; it will absorb the next (merge forward).
      merged.push(block);
      continue;
    }
    if (!meets && merged.length > 0) {
      // Merge backward into the running block only if THAT block also hasn't met
      // the min yet; otherwise keep merging forward by appending to a pending one.
      const prev = merged[merged.length - 1];
      const prevMeets = groupWords(prev) >= MIN_WORDS || prev.some((n) => n.kind === "image");
      if (!prevMeets) {
        merged[merged.length - 1] = [...prev, ...block];
        continue;
      }
    }
    if (!meets && merged.length > 0) {
      // Small trailing block with a satisfied predecessor → fold it back so we
      // never emit an under-min block.
      merged[merged.length - 1] = [...merged[merged.length - 1], ...block];
      continue;
    }
    merged.push(block);
  }

  // A residual under-min final block (e.g. only one section existed) folds back.
  if (merged.length > 1) {
    const last = merged[merged.length - 1];
    if (groupWords(last) < MIN_WORDS && !last.some((n) => n.kind === "image")) {
      merged[merged.length - 2] = [...merged[merged.length - 2], ...last];
      merged.pop();
    }
  }

  return merged.map(joinNodes).filter((t) => t.length > 0);
}

/**
 * Picture splitting (Section D · PICTURE): image count drives splits, word rules
 * ignored. Each image + its caption = one block; consecutive caption-less images
 * group in pairs. Returns chunk objects in the picture shape (text = image URL).
 */
export function splitPictureBlocks(nodes: BlockNode[]): SplitBlock[] {
  const images = nodes.filter((n) => n.kind === "image" && n.imageUrl);
  const out: SplitBlock[] = [];
  let i = 0;
  while (i < images.length) {
    const img = images[i];
    const hasCaption = !!(img.caption && img.caption.trim());
    if (!hasCaption && i + 1 < images.length && !images[i + 1].caption?.trim()) {
      // Two consecutive caption-less images → one block. Block text is the first
      // image's URL (the gated unlock returns text as the image link); the
      // second pairs via a metadata note in the caption slot.
      out.push({ text: img.imageUrl!, isFree: false, imageUrl: img.imageUrl!, caption: null });
      out.push({ text: images[i + 1].imageUrl!, isFree: false, imageUrl: images[i + 1].imageUrl!, caption: null });
      i += 2;
      continue;
    }
    out.push({ text: img.imageUrl!, isFree: false, imageUrl: img.imageUrl!, caption: img.caption ?? null });
    i += 1;
  }
  return out;
}

/**
 * Agent-skill splitting (Section D · AGENT SKILL): intro text before the first
 * code block is block 0 (free); each code block + its surrounding explanation is
 * one block. Returns ordered block texts (block 0 first).
 */
export function splitAgentBlocks(nodes: BlockNode[]): string[] {
  const firstCode = nodes.findIndex((n) => n.kind === "code");
  if (firstCode === -1) {
    // No code at all — fall back to prose splitting.
    return splitProseBlocks(nodes);
  }

  const blocks: BlockNode[][] = [];
  // Block 0: everything before the first code block (the free intro).
  const intro = nodes.slice(0, firstCode);
  if (intro.length > 0) blocks.push(intro);

  // Walk the rest: each code node anchors a block, pulling the explanation that
  // immediately follows it (until the next code node).
  let cur: BlockNode[] = [];
  for (let i = firstCode; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === "code" && cur.length > 0) {
      blocks.push(cur);
      cur = [];
    }
    cur.push(node);
  }
  if (cur.length > 0) blocks.push(cur);

  // If there was no intro, the first code block becomes block 0.
  return blocks.map(joinNodes).filter((t) => t.length > 0);
}
