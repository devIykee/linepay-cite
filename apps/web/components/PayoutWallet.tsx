"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";

/**
 * Payout-wallet display. Every non-admin user has ONE wallet, auto-provisioned
 * at signup (developer-controlled), and payouts always route there — there is no
 * connect/link/create flow. Admins are the sole exception: they sign with an
 * external wallet, so they (and only they) see the Connect Wallet option.
 *
 * Shared between the Wallet tab and Profile settings.
 */
export default function PayoutWallet() {
  const { status: emb, busy: embBusy, provision } = useEmbeddedWallet();

  if (!emb) return null;

  // Admin-only: external wallet connection.
  if (emb.isAdmin) {
    return (
      <div className="card">
        <h2 className="mb-2 font-headline-sm text-[15px] font-semibold">Payout wallet</h2>
        <p className="mb-3 font-body-sm text-on-surface-variant">Admin accounts sign with an external wallet.</p>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    );
  }

  // Everyone else: the auto-provisioned wallet, shown read-only.
  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h2 className="font-headline-sm text-[15px] font-semibold">Payout wallet</h2>
        <p className="font-body-sm text-on-surface-variant">
          Your USDC earnings are paid into your Skimflow wallet automatically.
        </p>
      </div>
      <div className="rounded-lg border border-outline-variant p-3">
        <div className="mb-1 flex items-center gap-1.5 font-label-lg">
          <span className="material-symbols-outlined text-[18px] text-secondary">account_balance_wallet</span>
          Your wallet
        </div>
        {emb.hasWallet ? (
          <code className="font-data-mono text-[12px]">
            {emb.address?.slice(0, 6)}…{emb.address?.slice(-4)}
          </code>
        ) : (
          // Rare: auto-provisioning at signup didn't complete — let the user retry.
          <button
            onClick={() => void provision()}
            disabled={embBusy}
            className="btn-primary mt-1 px-4 py-1.5 text-[12px] disabled:opacity-50"
          >
            {embBusy ? "Setting up…" : "Finish wallet setup"}
          </button>
        )}
      </div>
    </div>
  );
}
