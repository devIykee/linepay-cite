"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useToast } from "@/components/Toaster";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";

const MAX_NAME = 32;
const MAX_HANDLE = 24;
const MAX_BIO = 160;

interface Initial {
  displayName: string;
  handle: string;
  bio: string;
  avatar: string | null;
  email: string;
}

/** Slugify a handle the same way the server does, for live preview. */
function slugifyHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_HANDLE);
}

export default function ProfileSettings({ initial, impersonating }: { initial: Initial; impersonating: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to go on "back". Prefer an explicit ?returnTo=, but only honor an
  // internal same-site path (a leading "/" that isn't "//") to avoid open
  // redirects. Fall back to the dashboard.
  const rawReturn = searchParams.get("returnTo");
  const returnTo = rawReturn && /^\/(?!\/)/.test(rawReturn) ? rawReturn : "/dashboard";
  const backLabel = returnTo === "/dashboard" ? "Dashboard" : "Back";
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [handleInput, setHandleInput] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [busy, setBusy] = useState(false);

  const handle = slugifyHandle(handleInput);
  const nameOk = displayName.trim().length > 0 && displayName.length <= MAX_NAME;
  const handleOk = handle.length >= 3;
  const disabled = impersonating || busy || !nameOk || !handleOk;

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/creator/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), handle, bio: bio.trim() }),
      });
      const d = await r.json();
      if (r.ok) {
        toast("success", "Profile saved.");
        setHandleInput(d.handle ?? handle);
      } else {
        toast("error", d.friendly ?? d.error ?? "Couldn't save profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display-lg text-display-lg-mobile">Profile settings</h1>
        <Link href={returnTo} className="font-label-caps text-label-caps text-outline hover:text-primary">
          ← {backLabel}
        </Link>
      </div>

      {impersonating && (
        <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 font-body-sm text-primary">
          Read-only while impersonating — profile changes are disabled.
        </p>
      )}

      <div className="card flex flex-col gap-5">
        <div className="flex items-center gap-3">
          {initial.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={initial.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 font-headline-sm text-primary">
              {(displayName || initial.email || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="font-body-sm text-on-surface-variant">{initial.email}</div>
        </div>

        <Field label="Display name" hint={`${displayName.length}/${MAX_NAME}`}>
          <input
            value={displayName}
            maxLength={MAX_NAME}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-outline px-3 py-2 text-body-md focus:border-primary focus:outline-none"
          />
        </Field>

        <Field label="Handle" hint={`${handle.length}/${MAX_HANDLE}`}>
          <div className="flex items-center gap-2">
            <span className="font-data-mono text-on-surface-variant">@</span>
            <input
              value={handleInput}
              maxLength={MAX_HANDLE + 8}
              onChange={(e) => setHandleInput(e.target.value)}
              placeholder="your_handle"
              className="w-full rounded-lg border border-outline px-3 py-2 font-data-mono text-body-md focus:border-primary focus:outline-none"
            />
          </div>
          <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
            Public profile: <span className="font-data-mono">@{handle || "…"}</span>
            {!handleOk && handleInput && <span className="text-primary"> · at least 3 letters/numbers</span>}
          </p>
        </Field>

        <Field label="Bio" hint={`${bio.length}/${MAX_BIO}`}>
          <textarea
            value={bio}
            maxLength={MAX_BIO}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short line about you (shown on your profile)."
            className="w-full rounded-lg border border-outline px-3 py-2 text-body-md focus:border-primary focus:outline-none"
          />
        </Field>

        <div className="flex justify-end">
          <button onClick={save} disabled={disabled} className="btn-primary px-6 py-2">
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      {!impersonating && <PayoutWallet />}
    </div>
  );
}

/** Manage which wallet receives payouts: free embedded wallet vs. your own. */
function PayoutWallet() {
  const toast = useToast();
  const { status: emb, busy: embBusy, provision, refresh } = useEmbeddedWallet();
  const { address, isConnected } = useAccount();
  const [working, setWorking] = useState(false);

  if (!emb) return null;
  if (emb.isAdmin) {
    return (
      <div className="card mt-6">
        <h2 className="mb-2 font-headline-sm text-[15px] font-semibold">Payout wallet</h2>
        <p className="mb-3 font-body-sm text-on-surface-variant">Admin accounts sign with an external wallet.</p>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    );
  }

  async function useEmbeddedPayout() {
    setWorking(true);
    try {
      const r = await fetch("/api/creator/payout-source", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "embedded" }),
      });
      const d = await r.json();
      if (r.ok) { toast("success", "Payouts now route to your free wallet."); await refresh(); }
      else toast("error", d.friendly ?? d.error ?? "Couldn't switch.");
    } finally { setWorking(false); }
  }

  async function useExternalPayout() {
    if (!address) return;
    setWorking(true);
    try {
      const r = await fetch("/api/creator/payout-source", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "external", wallet: address }),
      });
      const d = await r.json();
      if (r.ok) { toast("success", "Payouts now route to your connected wallet."); await refresh(); }
      else toast("error", d.friendly ?? d.error ?? "Couldn't switch.");
    } finally { setWorking(false); }
  }

  async function createFree() {
    try { await provision(); toast("success", "Your free wallet is ready."); }
    catch (e) { toast("error", String((e as Error)?.message ?? e), "Couldn't create your wallet"); }
  }

  const active = emb.payoutAddress;
  const usingEmbedded = emb.walletSource === "embedded";

  return (
    <div className="card mt-6 flex flex-col gap-4">
      <div>
        <h2 className="font-headline-sm text-[15px] font-semibold">Payout wallet</h2>
        <p className="font-body-sm text-on-surface-variant">
          Active payout: {active ? (
            <span className="font-data-mono text-[12px]">{active.slice(0, 6)}…{active.slice(-4)}</span>
          ) : <span className="text-outline">none yet</span>}
          {active && <span className="pill ml-2 text-[10px]">{emb.walletSource}</span>}
        </p>
      </div>

      {/* Free embedded wallet */}
      <div className="rounded-lg border border-outline-variant p-3">
        <div className="mb-1 flex items-center gap-1.5 font-label-lg">
          <span className="material-symbols-outlined text-[18px] text-secondary">account_balance_wallet</span>
          Free wallet (recommended)
        </div>
        {emb.hasWallet ? (
          <>
            <code className="font-data-mono text-[12px]">{emb.address?.slice(0, 6)}…{emb.address?.slice(-4)}</code>
            {!usingEmbedded && (
              <button onClick={useEmbeddedPayout} disabled={working} className="btn-outline ml-3 px-3 py-1 text-[12px]">
                Use for payouts
              </button>
            )}
            {usingEmbedded && <span className="ml-3 font-body-sm text-[12px] text-secondary">in use ✓</span>}
          </>
        ) : (
          <button onClick={createFree} disabled={embBusy} className="btn-primary mt-1 px-4 py-1.5 text-[12px] disabled:opacity-50">
            {embBusy ? "Creating…" : "Create your free wallet"}
          </button>
        )}
      </div>

      {/* External wallet */}
      <div className="rounded-lg border border-outline-variant p-3">
        <div className="mb-2 font-label-lg">Your own wallet</div>
        <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        {isConnected && address && (
          <button onClick={useExternalPayout} disabled={working} className="btn-outline ml-3 px-3 py-1 text-[12px]">
            Use this for payouts
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-label-caps text-label-caps text-on-surface-variant">{label}</span>
        {hint && <span className="font-data-mono text-[11px] text-outline">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
