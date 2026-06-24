"use client";

import { useEffect } from "react";
import { useToast } from "@/components/Toaster";
import { flushQueuedRequests, registerSync } from "@/lib/offline-drafts";

/**
 * Registers the service worker (public/sw.js) and wires up offline-draft sync.
 * App Router has no _app.jsx, so this client component mounted in the root
 * layout is the registration entry point.
 *
 *  • Registers /sw.js (scope "/").
 *  • On reconnect ('online'), asks for a Background Sync AND flushes the queue
 *    directly (covers browsers without Background Sync).
 *  • Listens for the SW's "drafts-synced" message to confirm to the user.
 */
export default function ServiceWorkerRegister() {
  const toast = useToast();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration failures shouldn't break the app */
    });

    const onSynced = (e: MessageEvent) => {
      if (e.data?.type === "drafts-synced" && e.data.count > 0) {
        toast("success", `Synced ${e.data.count} draft${e.data.count === 1 ? "" : "s"} saved while you were offline.`);
      }
    };
    navigator.serviceWorker.addEventListener("message", onSynced);

    const onOnline = async () => {
      await registerSync();
      const synced = await flushQueuedRequests();
      if (synced > 0) toast("success", `Synced ${synced} draft${synced === 1 ? "" : "s"} saved offline.`);
      // Also poke the active SW to flush (in case it owns the queue first).
      navigator.serviceWorker.controller?.postMessage({ type: "flush-drafts" });
    };
    window.addEventListener("online", onOnline);

    // Attempt a flush on load too, in case drafts were queued in a prior session.
    if (navigator.onLine) void flushQueuedRequests();

    return () => {
      navigator.serviceWorker.removeEventListener("message", onSynced);
      window.removeEventListener("online", onOnline);
    };
  }, [toast]);

  return null;
}
