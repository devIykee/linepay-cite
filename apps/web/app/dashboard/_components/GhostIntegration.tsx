"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toaster";

interface IntegrationView {
  connected: boolean;
  siteUrl: string;
  hasContentKey: boolean;
  hasAdminKey: boolean;
  defaultMonetization: "free" | "paid";
  autoPublish: boolean;
  connectionStatus: "unconnected" | "connected" | "error";
  lastError: string | null;
  lastEventAt: string | null;
  webhookUrl: string;
}

const STATUS_META: Record<IntegrationView["connectionStatus"], { label: string; cls: string; dot: string }> = {
  unconnected: { label: "Unconnected", cls: "text-on-surface-variant", dot: "bg-outline" },
  connected: { label: "Connected", cls: "text-green-600", dot: "bg-green-500" },
  error: { label: "Error", cls: "text-error", dot: "bg-error" },
};

export default function GhostIntegration({ impersonating }: { impersonating: boolean }) {
  const toast = useToast();
  const [view, setView] = useState<IntegrationView | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Form state — keys are write-only (never returned by the API).
  const [siteUrl, setSiteUrl] = useState("");
  const [contentKey, setContentKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [monetization, setMonetization] = useState<"free" | "paid">("paid");
  const [autoPublish, setAutoPublish] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/creator/integrations/ghost", { credentials: "include" });
      const d = await r.json();
      if (r.ok) {
        const v = d.integration as IntegrationView;
        setView(v);
        setEncryptionReady(d.encryptionReady !== false);
        setSiteUrl(v.siteUrl);
        setMonetization(v.defaultMonetization);
        setAutoPublish(v.autoPublish);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        siteUrl: siteUrl.trim(),
        defaultMonetization: monetization,
        autoPublish,
      };
      if (contentKey.trim()) payload.contentApiKey = contentKey.trim();
      if (adminKey.trim()) payload.adminApiKey = adminKey.trim();
      const r = await fetch("/api/creator/integrations/ghost", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (r.ok) {
        toast("success", "Ghost integration saved.");
        setContentKey("");
        setAdminKey("");
        setView(d.integration as IntegrationView);
      } else {
        toast("error", d.message ?? d.error ?? "Couldn't save Ghost settings.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Ghost? Stored credentials will be removed.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/creator/integrations/ghost", { method: "DELETE", credentials: "include" });
      const d = await r.json();
      if (r.ok) {
        toast("success", "Ghost disconnected.");
        setView(d.integration as IntegrationView);
        setContentKey("");
        setAdminKey("");
      }
    } finally {
      setBusy(false);
    }
  }

  function copyWebhook() {
    if (!view) return;
    void navigator.clipboard.writeText(view.webhookUrl).then(
      () => toast("success", "Webhook URL copied."),
      () => toast("error", "Couldn't copy — select and copy manually.")
    );
  }

  if (loading) {
    return (
      <div className="card mt-6">
        <p className="font-body-sm text-on-surface-variant">Loading integrations…</p>
      </div>
    );
  }

  const status = STATUS_META[view?.connectionStatus ?? "unconnected"];
  const hasCreds = !!view?.hasContentKey && !!view?.hasAdminKey;
  const canSave =
    !impersonating &&
    !busy &&
    /^https?:\/\/.+/i.test(siteUrl.trim()) &&
    // New connection needs both keys; an existing one can save options/site alone.
    (hasCreds || (!!contentKey.trim() && !!adminKey.trim()));

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-headline-sm text-headline-sm">Integrations</h2>
      </div>

      <div className="card flex flex-col gap-5">
        {/* Header: Ghost + status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">rss_feed</span>
            <span className="font-headline-sm">Ghost</span>
          </div>
          <span className={`flex items-center gap-2 font-label-caps text-label-caps ${status.cls}`}>
            <span className={`h-2 w-2 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>

        <p className="font-body-sm text-on-surface-variant">
          Keep writing in Ghost. When you publish there, the post syncs here and Skimflow becomes your monetization layer.
        </p>

        {!encryptionReady && (
          <p className="rounded-lg border border-error/30 bg-error/5 p-3 font-body-sm text-error">
            Server encryption key (INTEGRATION_ENC_KEY) isn&apos;t configured — credentials can&apos;t be stored yet.
          </p>
        )}

        {view?.connectionStatus === "error" && view.lastError && (
          <p className="rounded-lg border border-error/30 bg-error/5 p-3 font-body-sm text-error">{view.lastError}</p>
        )}

        {impersonating && (
          <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 font-body-sm text-primary">
            Read-only while impersonating.
          </p>
        )}

        <Field label="Ghost site URL">
          <input
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://myblog.ghost.io"
            className="w-full rounded-lg border border-outline px-3 py-2 font-data-mono text-body-md focus:border-primary focus:outline-none"
          />
        </Field>

        <Field label="Content API key" hint={view?.hasContentKey ? "saved · leave blank to keep" : "from Ghost Admin → Integrations"}>
          <input
            value={contentKey}
            onChange={(e) => setContentKey(e.target.value)}
            placeholder={view?.hasContentKey ? "•••••••• (unchanged)" : "Read-only Content API key"}
            autoComplete="off"
            className="w-full rounded-lg border border-outline px-3 py-2 font-data-mono text-body-md focus:border-primary focus:outline-none"
          />
        </Field>

        <Field label="Admin API key" hint={view?.hasAdminKey ? "saved · leave blank to keep" : "for webhook signature validation"}>
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            type="password"
            placeholder={view?.hasAdminKey ? "•••••••• (unchanged)" : "{id}:{secret}"}
            autoComplete="off"
            className="w-full rounded-lg border border-outline px-3 py-2 font-data-mono text-body-md focus:border-primary focus:outline-none"
          />
          <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
            Stored encrypted, server-side only. Never shown again or sent back to your browser.
          </p>
        </Field>

        {/* Default monetization */}
        <div>
          <span className="font-label-caps text-label-caps text-on-surface-variant">Default monetization</span>
          <div className="mt-2 inline-flex rounded-lg border border-outline p-1">
            <button
              type="button"
              onClick={() => setMonetization("free")}
              className={`rounded-md px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                monetization === "free" ? "bg-primary text-on-primary" : "text-on-surface-variant"
              }`}
            >
              Free
            </button>
            <button
              type="button"
              onClick={() => setMonetization("paid")}
              className={`rounded-md px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                monetization === "paid" ? "bg-primary text-on-primary" : "text-on-surface-variant"
              }`}
            >
              Pay per block
            </button>
          </div>
          <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
            Applied to every incoming Ghost post. You can still edit individual posts in drafts before publishing.
          </p>
        </div>

        {/* Auto-publish */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => setAutoPublish(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--color-primary,#99411e)]"
          />
          <span>
            <span className="font-label-caps text-label-caps">Auto-publish</span>
            <span className="block font-body-sm text-[12px] text-on-surface-variant">
              {autoPublish
                ? "On — posts publish immediately using the default monetization above."
                : "Off — posts land in Skimflow drafts for review first."}
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between">
          {hasCreds ? (
            <button onClick={disconnect} disabled={impersonating || busy} className="font-label-caps text-label-caps text-error hover:underline disabled:opacity-50">
              Disconnect
            </button>
          ) : (
            <span />
          )}
          <button onClick={save} disabled={!canSave} className="btn-primary px-6 py-2">
            {busy ? "Saving…" : hasCreds ? "Save changes" : "Connect Ghost"}
          </button>
        </div>
      </div>

      {/* Webhook setup panel — shown after credentials are saved. */}
      {hasCreds && view && (
        <div className="card mt-4 flex flex-col gap-3">
          <h3 className="font-headline-sm text-headline-sm">Finish in Ghost</h3>
          <p className="font-body-sm text-on-surface-variant">
            In Ghost Admin → Settings → Integrations → your integration → <strong>Add webhook</strong>:
          </p>
          <ul className="flex flex-col gap-2 font-body-sm">
            <li className="flex items-center gap-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant">Event</span>
              <code className="rounded bg-surface-container-low px-2 py-0.5 font-data-mono text-[13px]">Post published</code>
            </li>
            <li>
              <span className="font-label-caps text-label-caps text-on-surface-variant">Target URL</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto whitespace-nowrap rounded bg-surface-container-low px-2 py-1.5 font-data-mono text-[12px]">
                  {view.webhookUrl}
                </code>
                <button
                  onClick={copyWebhook}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-outline px-3 py-1.5 font-label-caps text-label-caps hover:border-primary hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                  Copy
                </button>
              </div>
            </li>
          </ul>
          <p className="font-body-sm text-[12px] text-on-surface-variant">
            Status flips to <strong>Connected</strong> after your first published post arrives. If a webhook signature
            fails, it shows <strong>Error</strong> with the reason here.
          </p>
        </div>
      )}
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
