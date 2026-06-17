import { NextRequest } from "next/server";
import {
  getChunk,
  getContentWithCreator,
  getLedgerByToken,
  getUserById,
  insertLedger,
  recordAdminEvent,
} from "@/lib/store";
import {
  arc,
  batchingRequirements,
  friendlyError,
  settleViaCircle,
  verifyDirectTransfer,
} from "@/lib/reader-pay";
import { splitPayment } from "@/lib/split-payment";
import { validateWallet } from "@/lib/validate-wallet";
import { getReferrerId } from "@/lib/referral";
import { sendEarningNotification } from "@/lib/notify";
import { toBaseUnits, toDecimal } from "@/lib/money";
import type { Address, Hex } from "@linepay/sdk";

export const runtime = "nodejs";

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;

/**
 * POST /api/reader/:slug  — human chunk unlock via Circle Gateway on Arc.
 * Two-phase: quote (no signature) → settle (authorization+signature) OR a
 * direct USDC transfer (directTx). Writes a payment_ledger row (pending in
 * live mode → finalized by the Circle webhook; completed in simulate).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      blockIndex?: number;
      authorization?: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
      signature?: Hex;
      directTx?: { hash: Hex; from?: Address };
    };
    const blockIndex = Math.max(0, Number(body.blockIndex ?? 0));

    const content = await getContentWithCreator(slug);
    if (!content) return Response.json({ error: "content_not_found", friendly: "This content no longer exists." }, { status: 404 });
    if (content.status === "suspended")
      return Response.json({ error: "Content suspended", reason: content.suspended_reason }, { status: 403 });
    if (content.status !== "published") return Response.json({ error: "content_not_available" }, { status: 404 });

    const chunk = await getChunk(content.id, blockIndex);
    if (!chunk) return Response.json({ error: "block_not_found" }, { status: 404 });
    if (chunk.is_free) {
      return Response.json({ free: true, blockIndex, text: chunk.text });
    }

    const creator = await getUserById(content.creator_id);
    const walletCheck = validateWallet(creator?.wallet_address);
    const payTo = walletCheck.checksummed ?? BURN;

    const amount = toBaseUnits(content.price_per_block).toString();
    const requirements = batchingRequirements(amount, payTo);
    const simulate = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";

    // ── Phase 1: quote ─────────────────────────────────────────────────────────
    if (!body.directTx && (!body.authorization || !body.signature)) {
      return Response.json({
        needsPayment: true,
        requirements,
        blockIndex,
        amount,
        amountDisplay: toDecimal(amount),
        chainId: arc.chainId,
      });
    }

    const referrerId = getReferrerId(req);
    const split = splitPayment({ total: content.price_per_block, hasReferrer: !!referrerId });

    const finalize = async (txHash: string, payer: Address) => {
      // Idempotent on tx hash.
      const existing = await getLedgerByToken(txHash);
      if (existing) {
        return Response.json({ paid: true, alreadyUnlocked: true, blockIndex, text: chunk.text, txHash });
      }
      await insertLedger({
        contentId: content.id,
        creatorId: content.creator_id,
        payerId: payer,
        payerKind: "human",
        blockIndex,
        grossAmount: split.gross,
        creatorAmount: split.creatorAmount,
        platformAmount: split.platformAmount,
        referrerAmount: split.referrerAmount,
        referrerId,
        paymentToken: txHash,
        txHash,
        status: simulate ? "completed" : "pending",
      });
      await recordAdminEvent({
        eventType: "UNLOCK",
        payerId: payer,
        contentId: content.id,
        blockIndex,
        amountGross: split.gross,
        metadata: { slug: content.slug },
      });
      if (simulate) {
        void sendEarningNotification({
          creatorId: content.creator_id,
          contentTitle: content.title,
          blockIndex,
          gross: split.gross,
          creatorCut: split.creatorAmount,
        });
      }
      return Response.json({
        paid: true,
        simulated: simulate,
        blockIndex,
        amount,
        amountDisplay: toDecimal(amount),
        txHash,
        text: chunk.text,
      });
    };

    // ── Direct-transfer path ────────────────────────────────────────────────────
    if (body.directTx?.hash) {
      const existing = await getLedgerByToken(body.directTx.hash);
      if (existing) return Response.json({ error: "tx_already_used", friendly: "That payment was already used." }, { status: 409 });
      const verify = await verifyDirectTransfer(body.directTx.hash, payTo, amount);
      if (!verify.ok) {
        return Response.json({ error: verify.reason ?? "transfer_failed", friendly: "That transfer didn't pay the expected USDC." }, { status: 402 });
      }
      return finalize(body.directTx.hash, verify.payer ?? body.directTx.from ?? payTo);
    }

    // ── Gateway settle path ───────────────────────────────────────────────────
    const { authorization, signature } = body;
    if (!authorization || !signature) return Response.json({ error: "missing_authorization" }, { status: 400 });
    if (BigInt(authorization.value) !== BigInt(amount))
      return Response.json({ error: "amount_mismatch", friendly: "Price changed — please try again." }, { status: 400 });
    if (String(authorization.to).toLowerCase() !== payTo.toLowerCase())
      return Response.json({ error: "recipient_mismatch", friendly: "Recipient mismatch — please try again." }, { status: 400 });

    let result;
    try {
      result = await settleViaCircle({ x402Version: 2, payload: { authorization, signature } }, requirements);
    } catch (e) {
      const detail = String((e as Error)?.message ?? e);
      return Response.json({ error: "settlement_failed", detail, friendly: friendlyError(detail) }, { status: 402 });
    }
    if (!result?.success) {
      const reason = result?.errorReason ?? "unknown";
      return Response.json({ error: "gateway_rejected", detail: reason, friendly: friendlyError(reason) }, { status: 402 });
    }
    const txUuid = String(result.transaction ?? "");
    const txHash = txUuid.startsWith("0x") ? txUuid : `0x${txUuid.replace(/-/g, "")}`;
    return finalize(txHash, (result.payer as Address) ?? authorization.from);
  } catch (e) {
    const detail = String((e as Error)?.message ?? e);
    return Response.json({ error: "reader_error", detail, friendly: friendlyError(detail) }, { status: 500 });
  }
}
