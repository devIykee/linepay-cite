/**
 * Agent-skills consumer — the autonomous A2A flow against the new chunk system.
 *
 *   1. Discover the payment system via /.well-known/agent-payment.json
 *   2. Fetch the free block 0 (onboarding) of a piece
 *   3. For each block 1..N: GET → 402 → pay → retry with X-Payment-Token → read
 *
 * In simulate mode the token is generated locally (the server auto-approves).
 * In live mode the agent pays the gateway address in USDC on Arc (BUYER_PRIVATE_KEY)
 * and uses the tx hash as the token; the Circle webhook confirms it server-side.
 */
import { loadArcConfig, type Hex } from "@linepay/sdk";

export interface AgentSkillsOptions {
  baseUrl: string;
  slug: string;
  simulate: boolean;
  maxBlocks?: number;
}

export interface BlockTrace {
  blockIndex: number;
  status: "paid" | "402" | "stopped";
  token?: string;
  cost?: string;
  chars?: number;
  rateRemaining?: string | null;
}

export interface AgentSkillsResult {
  discovery: Record<string, unknown> | null;
  block0: string;
  blocks: BlockTrace[];
  spent: string;
}

function agentUrl(baseUrl: string, slug: string, block?: number): string {
  const u = `${baseUrl.replace(/\/$/, "")}/read/${slug}/agent-skills.md`;
  return block === undefined ? u : `${u}?block=${block}`;
}

/** Pay for a block; returns an X-Payment-Token. */
async function pay(cost: string, gateway: string, simulate: boolean): Promise<string> {
  if (simulate) {
    // Deterministic-enough unique token; the server auto-approves in simulate.
    return `sim_${Date.now().toString(36)}_${process.hrtime.bigint().toString(36).slice(-6)}`;
  }
  // Live: send USDC to the gateway address on Arc; the tx hash is the token,
  // reconciled by the Circle webhook (payment.confirmed paymentId=txHash).
  const privateKey = (process.env.BUYER_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY) as Hex | undefined;
  if (!privateKey) {
    throw new Error("Live mode needs BUYER_PRIVATE_KEY (a funded Arc testnet wallet) to pay.");
  }
  const { createWalletClient, http, parseUnits, erc20Abi, getAddress } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const arc = loadArcConfig();
  const account = privateKeyToAccount(privateKey);
  const chain = {
    id: arc.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [arc.rpcUrl] } },
  } as const;
  const wallet = createWalletClient({ account, chain: chain as never, transport: http(arc.rpcUrl) });
  const hash = await wallet.writeContract({
    address: getAddress(arc.usdcAddress),
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(gateway), parseUnits(cost, 6)],
  });
  return hash;
}

export async function runAgentSkills(opts: AgentSkillsOptions): Promise<AgentSkillsResult> {
  const { baseUrl, slug, simulate } = opts;
  const maxBlocks = opts.maxBlocks ?? 50;

  // 1. Discover
  let discovery: Record<string, unknown> | null = null;
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/.well-known/agent-payment.json`);
    if (r.ok) discovery = (await r.json()) as Record<string, unknown>;
  } catch {
    /* discovery optional */
  }

  // 2. Block 0 (free)
  const b0 = await fetch(agentUrl(baseUrl, slug, 0));
  const block0 = await b0.text();

  // 3. Sequential paid blocks
  const blocks: BlockTrace[] = [];
  let spentUnits = 0;
  for (let i = 1; i <= maxBlocks; i++) {
    const unpaid = await fetch(agentUrl(baseUrl, slug, i));
    if (unpaid.status === 404) {
      blocks.push({ blockIndex: i, status: "stopped" });
      break;
    }
    if (unpaid.status !== 402) {
      // Already free or unexpected — record and continue.
      blocks.push({ blockIndex: i, status: "stopped" });
      break;
    }
    const quote = (await unpaid.json()) as { cost_per_block: string; payment_gateway: string };
    const token = await pay(quote.cost_per_block, quote.payment_gateway, simulate);

    const paid = await fetch(agentUrl(baseUrl, slug, i), { headers: { "X-Payment-Token": token } });
    if (!paid.ok) {
      blocks.push({ blockIndex: i, status: "402", token, cost: quote.cost_per_block });
      break;
    }
    const text = await paid.text();
    spentUnits += Math.round(Number(quote.cost_per_block) * 1e6);
    blocks.push({
      blockIndex: i,
      status: "paid",
      token,
      cost: quote.cost_per_block,
      chars: text.length,
      rateRemaining: paid.headers.get("x-ratelimit-remaining"),
    });
  }

  return { discovery, block0, blocks, spent: (spentUnits / 1e6).toFixed(6) };
}
