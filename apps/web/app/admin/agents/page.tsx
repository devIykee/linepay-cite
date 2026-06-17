"use client";

import { useCallback, useEffect, useState } from "react";

interface Session {
  session_key: string;
  ip: string | null;
  user_agent: string | null;
  label: string | null;
  trusted: boolean;
  blocked: boolean;
  first_seen: string;
  last_seen: string;
  total_402_hits: number;
  total_unlocks: number;
  total_spent_usdc: string;
}
interface Funnel { wellKnownHits: number; block0Fetches: number; hits402: number; payments: number }

function FunnelStage({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-lg border border-outline-variant px-3 py-3 text-center">
      <div className="font-headline-sm text-headline-sm">{value}</div>
      <div className="font-label-caps text-label-caps text-on-surface-variant">{label}</div>
    </div>
  );
}

export default function AgentsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/agents", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions ?? []);
        setFunnel(d.funnel ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  async function update(sessionKey: string, body: Record<string, unknown>) {
    setBusy(sessionKey);
    try {
      await fetch("/api/admin/agents/block", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, ...body }),
      });
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card">
        <h2 className="mb-4 font-headline-sm text-headline-sm">Discovery Funnel</h2>
        {funnel && (
          <div className="flex items-center gap-2">
            <FunnelStage label=".well-known" value={funnel.wellKnownHits} />
            <span className="text-outline">→</span>
            <FunnelStage label="block 0" value={funnel.block0Fetches} />
            <span className="text-outline">→</span>
            <FunnelStage label="402 hits" value={funnel.hits402} />
            <span className="text-outline">→</span>
            <FunnelStage label="payments" value={funnel.payments} />
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 font-headline-sm text-headline-sm">Agent Sessions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="font-label-caps text-label-caps text-on-surface-variant">
              <tr className="border-b border-outline">
                <th className="py-2">Session</th><th>Last seen</th><th>402</th><th>Unlocks</th><th>Spent</th><th>State</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.session_key} className="border-b border-outline-variant">
                  <td className="py-2 font-data-mono text-[11px]">
                    {s.session_key.slice(0, 12)}…
                    <div className="text-outline">{(s.user_agent ?? "").slice(0, 30)}</div>
                  </td>
                  <td className="text-[11px]">{new Date(s.last_seen).toLocaleString()}</td>
                  <td>{s.total_402_hits}</td>
                  <td>{s.total_unlocks}</td>
                  <td>${Number(s.total_spent_usdc).toFixed(4)}</td>
                  <td>
                    {s.blocked ? <span className="text-red-600">blocked</span> : s.trusted ? <span className="text-green-600">trusted</span> : "active"}
                  </td>
                  <td className="flex flex-wrap gap-1 py-2">
                    <button disabled={busy === s.session_key} onClick={() => update(s.session_key, { blocked: !s.blocked })} className="btn-outline px-2 py-1 text-[11px]">
                      {s.blocked ? "Unblock" : "Block"}
                    </button>
                    <button disabled={busy === s.session_key} onClick={() => update(s.session_key, { trusted: !s.trusted })} className="btn-outline px-2 py-1 text-[11px]">
                      {s.trusted ? "Untrust" : "Trust (5×)"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
