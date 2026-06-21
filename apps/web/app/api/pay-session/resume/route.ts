import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Address } from "viem";
import { resumePaySession, getUserById } from "@/lib/store";
import { currentSession } from "@/lib/session";
import { validateWallet } from "@/lib/validate-wallet";
import { toDecimal, toBaseUnits } from "@/lib/money";
import { relayerRecipient } from "@/lib/gateway-relayer";
import { PAY_SESSION_COOKIE, signPaySession } from "@/lib/session-key";

export const runtime = "nodejs";

/**
 * POST /api/pay-session/resume — silently re-open a previously-ended
 * silent-payment session WITHOUT a new deposit.
 *
 * When the reader ends a session from the fuel chip, the on-chain Gateway is
 * still funded and the local session key is still an authorized delegate — so
 * tapping "Read on" again should just continue, not ask them to deposit again.
 * We restore the prior session's cap/spent tally (so the remaining fuel is
 * accurate) and re-issue the cookie.
 *
 * No fresh signature is required: spending still needs the device-held session
 * key to sign each burn intent, so re-issuing the cookie alone grants nothing.
 * Embedded wallets are additionally bound to the signed-in owner.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mainWallet?: string;
      sessionAddress?: string;
      source?: "embedded" | "external";
    };

    const mainCheck = validateWallet(body.mainWallet);
    if (!mainCheck.valid || !mainCheck.checksummed)
      return Response.json({ ok: false, error: "bad_main_wallet" }, { status: 400 });
    const sessCheck = validateWallet(body.sessionAddress);
    if (!sessCheck.valid || !sessCheck.checksummed)
      return Response.json({ ok: false, error: "bad_session_address" }, { status: 400 });

    const mainWallet = mainCheck.checksummed as Address;
    const sessionAddress = sessCheck.checksummed as Address;

    // Embedded wallets are server-custodied — only the signed-in owner may
    // resume one. External wallets need no extra proof here (the device key
    // gates spending).
    if (body.source === "embedded") {
      const session = await currentSession();
      if (!session?.user?.id)
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      const user = await getUserById(session.user.id);
      const owns =
        user?.embedded_wallet_address && getAddress(user.embedded_wallet_address) === mainWallet;
      if (!owns) return Response.json({ ok: false, error: "embedded_mismatch" }, { status: 403 });
    }

    const session = await resumePaySession(mainWallet, sessionAddress);
    if (!session) return Response.json({ ok: false, resumable: false });

    const token = await signPaySession({
      sessionId: session.id,
      mainWallet,
      sessionAddress,
      cap: session.cap,
    });
    const remaining = toDecimal(toBaseUnits(session.cap) - toBaseUnits(session.spent));

    const res = Response.json({
      ok: true,
      sessionId: session.id,
      sessionAddress,
      mainWallet,
      cap: session.cap,
      spent: session.spent,
      remaining,
      recipient: getAddress(relayerRecipient()),
    });
    res.headers.append(
      "Set-Cookie",
      `${PAY_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
    );
    return res;
  } catch (e) {
    return Response.json(
      { ok: false, error: "resume_failed", detail: String((e as Error)?.message ?? e) },
      { status: 500 }
    );
  }
}
