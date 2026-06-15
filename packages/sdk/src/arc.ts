import type { Address } from "./types.js";

/**
 * Arc testnet configuration.
 *
 * Arc is Circle's L1 for stablecoin payments. These defaults are wired through
 * environment variables so the same code runs against the real testnet (via the
 * ARC CLI / RPC) or in local simulation mode.
 *
 * Set ARC_RPC_URL, ARC_CHAIN_ID, USDC_ADDRESS in your .env once you have
 * provisioned them with `arc` CLI + Circle console.
 */
export interface ArcConfig {
  rpcUrl: string;
  chainId: number;
  /** USDC ERC-20 on Arc testnet. */
  usdcAddress: Address;
  /** Circle Gateway facilitator endpoint (batched, gas-free settlement). */
  gatewayUrl: string;
  /** Deployed RevenueSplit contract; falls back to direct creator pay if unset. */
  revenueSplitAddress?: Address;
  /** When true, no network calls are made — payments settle in a local ledger. */
  simulate: boolean;
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export function loadArcConfig(env: NodeJS.ProcessEnv = process.env): ArcConfig {
  const simulate =
    (env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live" ||
    !env.ARC_RPC_URL;

  return {
    rpcUrl: env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    chainId: Number(env.ARC_CHAIN_ID ?? "13371"),
    usdcAddress: (env.USDC_ADDRESS as Address) ?? ZERO,
    gatewayUrl: env.CIRCLE_GATEWAY_URL ?? "https://gateway.circle.com/v1",
    revenueSplitAddress: env.REVENUE_SPLIT_ADDRESS as Address | undefined,
    simulate,
  };
}

/** viem chain object for Arc testnet (used only in live mode). */
export function arcChain(cfg: ArcConfig) {
  return {
    id: cfg.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    testnet: true,
  } as const;
}
