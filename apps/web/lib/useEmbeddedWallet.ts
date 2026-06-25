"use client";

/**
 * Client hook for the user's Circle developer-controlled wallet. Wallets are
 * custodial and auto-provisioned at signup, so there is no PIN, no challenge,
 * and no browser SDK — this hook just reads status and (as a fallback) triggers
 * server-side provisioning for accounts that predate auto-provisioning.
 *
 * Exposes:
 *   provision() — server-side create (idempotent), then refresh status
 *   status      — { hasWallet, address, walletSource, isAdmin, enabled }
 */
import { useCallback, useEffect, useState } from "react";

export interface EmbeddedStatus {
  enabled: boolean;
  isAdmin: boolean;
  hasWallet: boolean;
  address: string | null;
  walletId: string | null;
  walletSource: string | null;
  payoutAddress: string | null;
}

export function useEmbeddedWallet() {
  const [status, setStatus] = useState<EmbeddedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // null = not yet resolved (loading); true/false once the status call answers.
  // Lets callers distinguish "still loading" from "signed out" (401), so the
  // reader can prompt sign-in instead of spinning forever.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/embedded", { credentials: "include" });
      if (res.ok) {
        setStatus((await res.json()) as EmbeddedStatus);
        setSignedIn(true);
      } else if (res.status === 401) {
        setSignedIn(false);
      }
    } catch {
      /* network hiccup — leave state as-is */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Provision the wallet server-side (idempotent), then refresh status. */
  const provision = useCallback(async (): Promise<EmbeddedStatus | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/embedded", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Provisioning failed.");
      await refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, provision, refresh, signedIn };
}
