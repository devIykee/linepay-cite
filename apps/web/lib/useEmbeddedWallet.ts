"use client";

/**
 * Client hook for the Circle User-Controlled (embedded) wallet. Wraps the W3S
 * Web SDK challenge flow: the backend creates challenges, the SDK executes them
 * with the user's PIN. The SDK is browser-only, so it's dynamically imported.
 *
 * Exposes:
 *   provision()        — create the wallet (PIN setup), then persist its address
 *   executeChallenge() — run a backend-created challenge (used by silent-pay setup)
 *   status            — { hasWallet, address, walletSource, isAdmin, enabled }
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

// Minimal shape of the lazily-loaded W3S SDK (avoids importing browser-only code at module scope).
type W3SSdkLike = {
  setAuthentication: (a: { userToken: string; encryptionKey: string }) => void;
  getDeviceId: () => Promise<string>;
  execute: (challengeId: string, cb: (err: unknown, result: unknown) => void) => void;
  setThemeColor?: (theme: Record<string, string | number>) => void;
  setResources?: (resources: { fontFamily?: { name?: string; url?: string } }) => void;
  setLocalizations?: (loc: Record<string, Record<string, string>>) => void;
};

/** Friendly, first-party copy for the PIN/setup screens. */
function w3sCopy(): Record<string, Record<string, string>> {
  return {
    common: { continue: "Continue", confirm: "Confirm", showPin: "Show", hidePin: "Hide" },
    initPincode: {
      headline: "Set a PIN for your wallet",
      subhead: "This secures your free Skimflow wallet. You'll use it to approve payments.",
    },
    confirmInitPincode: {
      headline: "Confirm your PIN",
      subhead: "Re-enter it to finish setting up your wallet.",
    },
    enterPincode: {
      headline: "Enter your PIN",
      subhead: "Confirm to continue reading.",
    },
  };
}

const CHROME_STYLE_ID = "w3s-skimflow-style";
const CHROME_BACKDROP_ID = "w3s-skimflow-backdrop";

/**
 * Reshape the SDK's full-viewport iframe into a centered, card-sized modal and
 * dim the app behind it ourselves — so the PIN step reads as an in-app popup,
 * not a full-screen takeover. The iframe background is set to the card color so
 * any padding around Circle's responsive card blends into one solid card.
 * Returns a cleanup fn that removes the backdrop when the challenge resolves.
 */
function mountW3sChrome(dark: boolean): () => void {
  if (typeof document === "undefined") return () => {};
  const cardBg = dark ? "#18181b" : "#FBF9F3";
  const css = `#sdkIframe{width:min(440px,92vw)!important;height:min(640px,88vh)!important;`
    + `border-radius:20px!important;overflow:hidden!important;background:${cardBg}!important;`
    + `box-shadow:0 24px 60px -12px rgba(0,0,0,.5)!important;}`;
  let style = document.getElementById(CHROME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = CHROME_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;

  let backdrop = document.getElementById(CHROME_BACKDROP_ID);
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = CHROME_BACKDROP_ID;
    // Below the iframe (z 2147483647), above everything else. No click handler:
    // it just blocks the app + dims, while the modal's own X closes it.
    backdrop.style.cssText =
      `position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,${dark ? 0.6 : 0.45});`;
    document.body.appendChild(backdrop);
  }

  const remove = () => document.getElementById(CHROME_BACKDROP_ID)?.remove();
  // Closing via the modal's own X removes #sdkIframe WITHOUT firing our
  // completion callback (so the finally below wouldn't run). Watch for the
  // iframe disappearing and drop the backdrop then, so it never lingers.
  let seen = false;
  const observer = new MutationObserver(() => {
    const exists = !!document.getElementById("sdkIframe");
    if (exists) seen = true;
    else if (seen) {
      remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  return () => {
    observer.disconnect();
    remove();
  };
}

let sdkSingleton: W3SSdkLike | null = null;

/**
 * Theme the Circle PIN modal to match the app. Without this the SDK's hosted UI
 * always renders light, which clashes when the app is in dark mode (the symptom
 * a first-time user hits on the "create your free wallet" PIN step).
 */
function w3sTheme(dark: boolean): Record<string, string | number> {
  if (!dark) {
    return {
      // Our own backdrop dims the app (see mountW3sChrome); keep Circle's own
      // transparent so the constrained iframe reads as a single card.
      backdrop: "#000000",
      backdropOpacity: 0,
      bg: "#FBF9F3",
      divider: "#e7e2d6",
      textMain: "#1c1917",
      textMain2: "#1c1917",
      textAuxiliary: "#6b6660",
      textPlaceholder: "#a8a29e",
      textInteractive: "#99411e",
      mainBtnBg: "#99411e",
      mainBtnText: "#ffffff",
      mainBtnBgOnHover: "#7e3418",
      inputBg: "#ffffff",
      inputText: "#1c1917",
      inputBorderFocused: "#99411e",
      pinDotActivated: "#99411e",
    };
  }
  return {
    backdrop: "#000000",
    backdropOpacity: 0,
    bg: "#18181b",
    divider: "#3f3f46",
    textMain: "#fafafa",
    textMain2: "#e4e4e7",
    textAuxiliary: "#a1a1aa",
    textAuxiliary2: "#a1a1aa",
    textSummary: "#e4e4e7",
    textSummaryHighlight: "#ffffff",
    textPlaceholder: "#71717a",
    textInteractive: "#f2a382",
    interactiveBg: "#27272a",
    mainBtnBg: "#c2674a",
    mainBtnText: "#ffffff",
    mainBtnBgOnHover: "#a8543a",
    secondBtnText: "#e4e4e7",
    secondBtnBorder: "#3f3f46",
    inputBg: "#27272a",
    inputText: "#fafafa",
    inputBorderFocused: "#f2a382",
    dropdownBg: "#27272a",
    pinDotBase: "#3f3f46",
    pinDotBaseBorder: "#52525b",
    pinDotActivated: "#f2a382",
    success: "#34d399",
    error: "#f87171",
  };
}

async function getSdk(): Promise<W3SSdkLike> {
  if (sdkSingleton) return sdkSingleton;
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_CIRCLE_APP_ID is not set.");
  const mod = await import("@circle-fin/w3s-pw-web-sdk");
  const W3SSdk = mod.W3SSdk;
  const sdk = new W3SSdk({ appSettings: { appId } }) as unknown as W3SSdkLike;
  // Required before execute() or the challenge silently fails.
  await sdk.getDeviceId();
  sdkSingleton = sdk;
  return sdk;
}

/** Run a backend-issued challenge with the user's PIN. Resolves on success. */
export async function executeChallenge(
  challengeId: string,
  auth: { userToken: string; encryptionKey: string }
): Promise<void> {
  const sdk = await getSdk();
  sdk.setAuthentication(auth);
  // Make the (hosted, in-page iframe) PIN modal feel native: match the app's
  // current light/dark palette, its UI font, and friendlier first-party copy.
  // Best-effort: never block the challenge.
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  try {
    sdk.setThemeColor?.(w3sTheme(dark));
    sdk.setResources?.({
      fontFamily: {
        name: "Hanken Grotesk",
        url: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap",
      },
    });
    sdk.setLocalizations?.(w3sCopy());
  } catch {
    /* theming is best-effort — never block the challenge */
  }
  // Constrain the iframe into a centered card + dim the app ourselves, so it's a
  // popup rather than a full-screen takeover. Cleaned up when the challenge ends.
  const unmountChrome = mountW3sChrome(dark);
  try {
    await new Promise<void>((resolve, reject) => {
      sdk.execute(challengeId, (err) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      });
    });
  } finally {
    unmountChrome();
  }
}

export function useEmbeddedWallet() {
  const [status, setStatus] = useState<EmbeddedStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/embedded", { credentials: "include" });
      if (res.ok) setStatus((await res.json()) as EmbeddedStatus);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Create the embedded wallet (PIN setup), then persist + refresh status. */
  const provision = useCallback(async (): Promise<EmbeddedStatus | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/embedded", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Provisioning failed.");
      if (data.alreadyProvisioned) {
        await refresh();
        return null;
      }
      await executeChallenge(data.challengeId, {
        userToken: data.userToken,
        encryptionKey: data.encryptionKey,
      });
      // Persist the freshly-created wallet address server-side.
      const confirm = await fetch("/api/wallet/embedded/confirm", {
        method: "POST",
        credentials: "include",
      });
      if (!confirm.ok) {
        const c = await confirm.json().catch(() => ({}));
        throw new Error(c.message ?? "Couldn't save your new wallet.");
      }
      await refresh();
      return (await confirm.json()) as EmbeddedStatus;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, provision, refresh };
}
