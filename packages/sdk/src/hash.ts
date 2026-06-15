import { createHash } from "node:crypto";

/**
 * Split markdown into 1-indexed lines and return a stable line array.
 * Blank lines count — pricing and citations must match exactly what a reader
 * (or agent) is charged for. We normalize CRLF to LF first.
 */
export function toLines(markdown: string): string[] {
  return markdown.replace(/\r\n/g, "\n").split("\n");
}

export function countLines(markdown: string): number {
  return toLines(markdown).length;
}

/**
 * Extract an inclusive, 1-indexed line range. Clamps to bounds.
 * Returns the extracted text plus the actual range served.
 */
export function sliceLines(
  markdown: string,
  lineStart: number,
  lineEnd: number
): { text: string; actualStart: number; actualEnd: number; lineCount: number } {
  const lines = toLines(markdown);
  const total = lines.length;
  const start = Math.max(1, Math.min(lineStart, total));
  const end = Math.max(start, Math.min(lineEnd, total));
  const text = lines.slice(start - 1, end).join("\n");
  return { text, actualStart: start, actualEnd: end, lineCount: end - start + 1 };
}

/** Deterministic content hash for post-payment validation. */
export function hashContent(text: string): `0x${string}` {
  return ("0x" + createHash("sha256").update(text, "utf8").digest("hex")) as `0x${string}`;
}
