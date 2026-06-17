/**
 * Bridges a credited payment to the (async, batched) creator earning email.
 * Loads the creator + today's running total, then hands off to email.ts which
 * never blocks. Call WITHOUT await from request handlers: `void sendEarning...`.
 */
import { creatorEarnings, getUserById } from "./store.js";
import { notifyEarning } from "./email.js";

export async function sendEarningNotification(args: {
  creatorId: string;
  contentTitle: string;
  blockIndex: number;
  gross: string;
  creatorCut: string;
}): Promise<void> {
  try {
    const creator = await getUserById(args.creatorId);
    if (!creator?.email) return;
    const earn = await creatorEarnings(args.creatorId);
    notifyEarning({
      creatorId: args.creatorId,
      to: creator.email,
      creatorName: creator.display_name ?? undefined,
      contentTitle: args.contentTitle,
      blockIndex: args.blockIndex,
      gross: args.gross,
      creatorCut: args.creatorCut,
      runningTotalToday: earn.todayEarned,
    });
  } catch (e) {
    console.error("[notify] earning notification failed:", e);
  }
}
