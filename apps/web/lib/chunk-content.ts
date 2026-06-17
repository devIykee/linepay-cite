/**
 * Content chunker. Splits a creator's source text into payable blocks.
 *
 *  - 'article'  → split on blank-line paragraph boundaries (\n\n), drop empties.
 *  - 'markdown' → split on H2/H3 headings or `## Skill:` block boundaries, so
 *                 each skill/section becomes one payable block.
 *
 * The agent-skills content type uses 'markdown'. Block 0 (the free onboarding
 * block) is generated separately at publish time — this utility only splits the
 * creator's own body.
 */
export type ChunkFormat = "article" | "markdown";

export interface Chunk {
  id: string;
  text: string;
  index: number;
}

export interface ChunkInput {
  content: string;
  format: ChunkFormat;
}

/** Heading or skill-block boundary: H2/H3 (## / ###) at line start. */
const MD_BOUNDARY = /^#{2,3}\s+/;

function chunkArticle(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function chunkMarkdown(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join("\n").trim();
    if (text.length > 0) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    if (MD_BOUNDARY.test(line) && current.some((l) => l.trim().length > 0)) {
      // Start a new block at each H2/H3 boundary (keeps the heading with its body).
      flush();
    }
    current.push(line);
  }
  flush();

  // Fallback: if there were no headings at all, behave like article chunking so
  // a heading-less markdown file still produces sensible blocks.
  return blocks.length > 0 ? blocks : chunkArticle(content);
}

export function chunkContent({ content, format }: ChunkInput): Chunk[] {
  const raw = (content ?? "").trim();
  if (!raw) return [];
  const texts = format === "markdown" ? chunkMarkdown(raw) : chunkArticle(raw);
  return texts.map((text, index) => ({ id: `blk_${index}`, text, index }));
}
