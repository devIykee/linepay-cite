"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt, switchChain } from "@wagmi/core";
import { erc20Abi, parseUnits } from "viem";
import type { Address } from "viem";
import { formatUsdc } from "@/lib/money";
import { useToast } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";
import { getOrCreateSessionAccount } from "@/lib/session-key-client";
import { executeChallenge } from "@/lib/useEmbeddedWallet";
import { paySessionAuthMessage, GATEWAY_WALLET_ADDRESS, ARC_USDC_ADDRESS } from "@/lib/burn-intent";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const LIVE = (process.env.NEXT_PUBLIC_PAYMENTS_MODE ?? "simulate").toLowerCase() === "live";

const GATEWAY_WALLET_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addDelegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "delegate", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "availableBalance",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface PaySessionInfo {
  sessionId: string;
  sessionAddress: Address;
  mainWallet: Address;
  cap: string;
  spent: string;
  remaining: string;
  recipient: Address;
}

interface Props {
  mainWallet: Address;
  /** "external" = wagmi wallet signs; "embedded" = Circle PIN challenges. */
  kind?: "external" | "embedded";
  /** Suggested cap (e.g. enough for the whole article). */
  suggestedCap?: number;
  onReady: (session: PaySessionInfo) => void;
  onClose: () => void;
}

/**
 * One-time setup for silent payments. The user chooses how much USDC to deposit
 * (the spend cap) and authorizes a local session key; afterwards chunks unlock
 * with no popup. External wallets do the Gateway approve/deposit/addDelegate via
 * wagmi; embedded (Circle) wallets do the same steps via PIN-approved challenges.
 */
export default function PaySetupModal({ mainWallet, kind = "external", suggestedCap = 5, onReady, onClose }: Props) {
  const [cap, setCap] = useState(String(suggestedCap));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const embedded = kind === "embedded";

  /**
   * Current spendable balance already in the user's Gateway account. When this
   * covers the cap we can skip the approve + deposit steps entirely and go
   * straight to addDelegate — one signature/PIN instead of three.
   */
  async function gatewayAvailable(): Promise<bigint> {
    try {
      return (await readContract(wagmiConfig, {
        address: GATEWAY_WALLET_ADDRESS,
        abi: GATEWAY_WALLET_ABI,
        functionName: "availableBalance",
        args: [ARC_USDC_ADDRESS, mainWallet],
      })) as bigint;
    } catch {
      return 0n; // on any read error, fall back to the full deposit flow
    }
  }

  /** External wallet (wagmi) Gateway setup: approve → deposit → addDelegate. */
  async function runExternalSetup(sessionAddress: Address, capWei: bigint) {
    setStep("Switching to Arc Testnet…");
    try {
      await switchChain(wagmiConfig, { chainId: ARC_CHAIN_ID });
    } catch {
      /* already on Arc */
    }

    const usdc = ARC_USDC_ADDRESS;
    const gateway = GATEWAY_WALLET_ADDRESS;

    // If funds are already deposited in the Gateway, skip approve + deposit.
    const alreadyFunded = (await gatewayAvailable()) >= capWei;

    if (!alreadyFunded) {
      const allowance = (await readContract(wagmiConfig, {
        address: usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [mainWallet, gateway],
      })) as bigint;

      if (allowance < capWei) {
        setStep("Preparing your reading balance…");
        const hash = await writeContract(wagmiConfig, {
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [gateway, capWei],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
      }

      setStep("Adding funds to your reading balance…");
      const depositHash = await writeContract(wagmiConfig, {
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: "deposit",
        args: [usdc, capWei],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: depositHash });
    }

    setStep("Turning on one-tap reading…");
    const delegateHash = await writeContract(wagmiConfig, {
      address: gateway,
      abi: GATEWAY_WALLET_ABI,
      functionName: "addDelegate",
      args: [usdc, sessionAddress],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: delegateHash });
  }

  /** Embedded (Circle) setup: each step is a backend challenge executed via PIN. */
  async function runEmbeddedChallenge(
    step: "approve" | "deposit" | "addDelegate",
    sessionAddress: Address
  ) {
    const res = await fetch("/api/wallet/embedded/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, cap, sessionAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? "Setup step failed.");
    await executeChallenge(data.challengeId, {
      userToken: data.userToken,
      encryptionKey: data.encryptionKey,
    });
  }

  async function runEmbeddedSetup(sessionAddress: Address, capWei: bigint) {
    // If the embedded wallet already has enough deposited in the Gateway, skip
    // straight to addDelegate — a single PIN entry instead of three.
    const alreadyFunded = (await gatewayAvailable()) >= capWei;
    if (!alreadyFunded) {
      setStep("Adding funds (enter your PIN)…");
      await runEmbeddedChallenge("approve", sessionAddress);
      setStep("Adding funds to your reading balance…");
      await runEmbeddedChallenge("deposit", sessionAddress);
    }
    setStep("Turning on one-tap reading…");
    await runEmbeddedChallenge("addDelegate", sessionAddress);
  }

  async function authorize() {
    const capNum = Number(cap);
    if (!Number.isFinite(capNum) || capNum <= 0) {
      toast("warning", "Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      const account = getOrCreateSessionAccount(mainWallet);

      if (LIVE) {
        toast("info", embedded ? "Quick one-time setup — confirm each step with your PIN." : "Quick one-time setup — confirm each step in your wallet.");
        if (embedded) await runEmbeddedSetup(account.address, parseUnits(cap, 6));
        else await runExternalSetup(account.address, parseUnits(cap, 6));
      }

      setStep("Finishing setup…");
      let signature: string | undefined;
      if (!embedded) {
        const message = paySessionAuthMessage({ mainWallet, sessionAddress: account.address, cap });
        toast("info", LIVE ? "Final step: unlock one-tap reading." : "Confirm once to turn on one-tap reading — no funds move.");
        signature = await signMessageAsync({ message });
      }

      const res = await fetch("/api/pay-session/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainWallet,
          sessionAddress: account.address,
          cap,
          signature,
          source: embedded ? "embedded" : "external",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.friendly ?? data.error ?? "Setup failed.");

      toast("success", `You're topped up — ${formatUsdc(data.cap)} USDC of reading fuel, no more interruptions.`);
      onReady(data as PaySessionInfo);
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Setup cancelled.");
      else toast("error", msg, "Couldn't set up reading fuel");
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">bolt</span>
          <h2 className="font-headline-sm text-headline-sm">Read without interruptions</h2>
        </div>
        <p className="mb-5 font-body-sm text-on-surface-variant">
          {LIVE
            ? embedded
              ? "A quick one-time setup adds the amount you choose to your reading balance and turns on one-tap reading with your PIN. After that, each block unlocks instantly — no PIN per block."
              : "A quick one-time setup adds the amount you choose to your reading balance and turns on one-tap reading. After that, each block unlocks instantly — no wallet popup per block."
            : "Confirm once to turn on one-tap reading. After that, each block unlocks instantly — no wallet popup per block."}{" "}
          You stay in control: it stops at your cap, and you can end it anytime.
        </p>

        <label className="mb-1 block font-label-caps text-label-caps text-outline">
          {LIVE ? "Reading fuel to add (USDC)" : "Reading fuel cap (USDC)"}
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          disabled={busy}
          className="mb-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono text-on-surface focus:border-primary focus:outline-none"
        />
        <p className="mb-5 font-body-sm text-[11px] text-on-surface-variant">
          Type the exact amount you want available for this reading session.
        </p>

        {busy && step && (
          <p className="mb-4 flex items-center gap-2 font-body-sm text-[13px] text-primary">
            <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            {step}
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 font-body-md text-on-surface hover:bg-surface-container-low">
            Cancel
          </button>
          <button onClick={authorize} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
            {busy ? "Setting up…" : LIVE ? "Add reading fuel" : "Turn on one-tap reading"}
          </button>
        </div>
      </div>
    </div>
  );
}
