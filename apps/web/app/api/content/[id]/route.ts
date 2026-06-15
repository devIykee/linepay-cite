import { NextRequest, NextResponse } from "next/server";
import { getContent, getCreator, recordPayment } from "@/lib/store";
import {
  arc,
  gateway,
  requirementFor,
  splitFor,
  sliceLines,
  hashContent,
} from "@/lib/payments";
import { buildPaymentRequired, decodePayment } from "@linepay/sdk";

/**
 * x402-protected per-line content endpoint.
 *
 *   GET /api/content/:id?lineStart=1&lineEnd=50
 *
 * Behaviour:
 *  - The first `free_lines` lines are always free (so readers/agents can judge
 *    relevance before paying — this is what makes the agent's decision possible).
 *  - Any paid range with no `X-PAYMENT` header returns HTTP 402 + the x402
 *    requirement body.
 *  - With a valid `X-PAYMENT` header we settle via Circle Gateway, record the
 *    revenue split, and return the text plus an `X-PAYMENT-RESPONSE` receipt.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const lineStart = Math.max(1, parseInt(url.searchParams.get("lineStart") ?? "1", 10));
  const lineEnd = Math.max(lineStart, parseInt(url.searchParams.get("lineEnd") ?? "50", 10));

  const content = getContent(id);
  if (!content) return NextResponse.json({ error: "content_not_found" }, { status: 404 });
  const creator = getCreator(content.creator_id);
  if (!creator) return NextResponse.json({ error: "creator_not_found" }, { status: 404 });

  const baseUrl = process.env.APP_BASE_URL ?? url.origin;

  // ── Free preview ──────────────────────────────────────────────────────────
  if (lineEnd <= content.free_lines) {
    const { text, actualStart, actualEnd, lineCount } = sliceLines(content.body, lineStart, lineEnd);
    return NextResponse.json({
      contentId: content.id,
      title: content.title,
      creator: creator.handle,
      paid: false,
      free: true,
      lineStart: actualStart,
      lineEnd: actualEnd,
      lineCount,
      contentHash: hashContent(text),
      text,
    });
  }

  // ── Build the x402 requirement for this range ──────────────────────────────
  const requirement = requirementFor(content, creator, lineStart, lineEnd, baseUrl);

  const payment = decodePayment(req.headers.get("x-payment"));
  if (!payment) {
    // 402 Payment Required — the agent/wallet reads this and decides whether to pay.
    return NextResponse.json(buildPaymentRequired(requirement), {
      status: 402,
      headers: { "x-payment-required": "true" },
    });
  }

  // The client echoes back the nonce from the quote it is paying.
  requirement.nonce = payment.payload.nonce;

  // ── Verify + settle on Arc via Gateway ─────────────────────────────────────
  let receipt;
  try {
    receipt = await gateway.settle(requirement, payment);
  } catch (e: any) {
    return NextResponse.json({ error: "settlement_failed", detail: String(e?.message ?? e) }, { status: 402 });
  }

  // ── Deliver content + record split ─────────────────────────────────────────
  const { text, actualStart, actualEnd, lineCount } = sliceLines(content.body, lineStart, lineEnd);
  const contentHash = hashContent(text);
  const split = splitFor(BigInt(requirement.amount), creator);
  const payerKind = (req.headers.get("x-payer-kind") as "agent" | "human") ?? "agent";

  recordPayment({
    content,
    payer: payment.payload.from,
    payerKind,
    lineStart: actualStart,
    lineEnd: actualEnd,
    lineCount,
    split,
    receipt,
    contentHash,
  });

  return NextResponse.json(
    {
      contentId: content.id,
      title: content.title,
      creator: creator.handle,
      paid: true,
      simulated: receipt.simulated,
      lineStart: actualStart,
      lineEnd: actualEnd,
      lineCount,
      amount: requirement.amount,
      split,
      txHash: receipt.txHash,
      batchId: receipt.batchId,
      contentHash,
      text,
    },
    {
      headers: {
        "x-payment-response": Buffer.from(JSON.stringify(receipt)).toString("base64"),
      },
    }
  );
}
