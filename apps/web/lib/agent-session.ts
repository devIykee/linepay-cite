/**
 * Agent session identity + traffic accounting. A session is keyed by a hash of
 * (IP + user-agent) so repeat agent traffic collapses onto one row. Every 402
 * hit and unlock updates the session counters and writes an admin_event.
 */
import { createHash } from "node:crypto";
import { clientIp } from "./rate-limit.js";
import {
  bumpAgent402,
  bumpAgentUnlock,
  getAgentSession,
  recordAdminEvent,
  upsertAgentSession,
} from "./store.js";
import type { AgentSession } from "./types.js";

export interface AgentIdentity {
  sessionKey: string;
  ip: string;
  userAgent: string;
  /** payer_id form used in the ledger. */
  payerId: string;
}

export function deriveAgentIdentity(headers: Headers): AgentIdentity {
  const ip = clientIp(headers);
  const userAgent = headers.get("user-agent") ?? "unknown-agent";
  const sessionKey =
    "as_" + createHash("sha256").update(`${ip}|${userAgent}`).digest("hex").slice(0, 24);
  return { sessionKey, ip, userAgent, payerId: `agent:${sessionKey}` };
}

/** Ensure the session row exists (upsert), returning the current row. */
export function ensureAgentSession(id: AgentIdentity): Promise<AgentSession> {
  return upsertAgentSession(id.sessionKey, id.ip, id.userAgent);
}

export { getAgentSession };

/** Record a 402 hit (intent/discovery, no payment yet). */
export async function record402Hit(
  id: AgentIdentity,
  contentId: string,
  blockIndex: number
): Promise<void> {
  await bumpAgent402(id.sessionKey);
  await recordAdminEvent({
    eventType: "402_HIT",
    payerId: id.payerId,
    contentId,
    blockIndex,
    metadata: { userAgent: id.userAgent, ip: id.ip },
  });
}

/** Record an agent unlock (block served). */
export async function recordAgentUnlock(
  id: AgentIdentity,
  contentId: string,
  blockIndex: number,
  grossAmount: string
): Promise<void> {
  await bumpAgentUnlock(id.sessionKey, grossAmount);
  await recordAdminEvent({
    eventType: "AGENT_UNLOCK",
    payerId: id.payerId,
    contentId,
    blockIndex,
    amountGross: grossAmount,
    metadata: { userAgent: id.userAgent },
  });
}
