"use client";

import { useEffect, useState } from "react";

interface Step { phase: string; thought: string; t: number }
interface Citation { title: string; creator: string; lineStart: number; lineEnd: number; amountDisplay: string; txHash: string }
interface Result {
  brain: string; mode: string; steps: Step[]; citations: Citation[];
  answer: string; spentDisplay: string; remainingDisplay: string;
}

const ICONS: Record<string, string> = {
  plan: "🧭", discover: "🔎", preview: "👀", evaluate: "⚖️", guardian: "🛡️",
  pay: "💸", skip: "⏭️", extract: "📄", synthesize: "🧩", done: "✅",
};

export default function DemoPage() {
  const [query, setQuery] = useState("How do nanopayments change online writing?");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(0);
  const [feed, setFeed] = useState<any[]>([]);

  // Reveal reasoning steps one at a time for a live feel.
  useEffect(() => {
    if (!result) return;
    if (shown >= result.steps.length) return;
    const id = setTimeout(() => setShown((s) => s + 1), 350);
    return () => clearTimeout(id);
  }, [result, shown]);

  // Poll the live transaction feed.
  useEffect(() => {
    const load = () => fetch("/api/feed?limit=8").then((r) => r.json()).then((d) => setFeed(d.payments ?? []));
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, []);

  async function run() {
    setRunning(true);
    setResult(null);
    setShown(0);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      setResult(await res.json());
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-4">
        <h1 className="font-serif text-2xl font-bold">Reader / Agent demo</h1>
        <p className="text-sm text-black/60">
          Ask a research question, or try <em>&quot;continue reading The Clockwork Archive&quot;</em>. The
          autonomous agent discovers paywalled sources, decides what&apos;s worth paying for, clears
          Guardian policy, and pays per line via x402 + Circle Gateway on Arc.
        </p>

        <div className="flex gap-2">
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask the agent…" />
          <button className="btn btn-accent" onClick={run} disabled={running}>
            {running ? "Thinking…" : "Run agent"}
          </button>
        </div>

        {result && (
          <>
            <div className="card">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Chain of thought</h2>
                <span className="pill">{result.brain === "llm" ? "Claude reasoning" : "heuristic"} · {result.mode}</span>
              </div>
              <ol className="space-y-2 text-sm">
                {result.steps.slice(0, shown).map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span>{ICONS[s.phase] ?? "•"}</span>
                    <span><span className="mono text-xs text-black/40">[{s.phase}]</span> {s.thought}</span>
                  </li>
                ))}
              </ol>
            </div>

            {shown >= result.steps.length && (
              <>
                <div className="card">
                  <h2 className="mb-2 font-semibold">Answer</h2>
                  <pre className="whitespace-pre-wrap font-serif text-sm">{result.answer}</pre>
                </div>
                <div className="card">
                  <h2 className="mb-2 font-semibold">Citations &amp; payments</h2>
                  <ul className="space-y-1 text-sm">
                    {result.citations.map((c, i) => (
                      <li key={i}>
                        [{i + 1}] <strong>{c.title}</strong> @{c.creator} · lines {c.lineStart}–{c.lineEnd} ·
                        paid <span className="text-accent2">{c.amountDisplay}</span> ·
                        <span className="mono text-xs text-black/40"> {c.txHash.slice(0, 14)}…</span>
                      </li>
                    ))}
                    {result.citations.length === 0 && <li className="text-black/50">No paid sources.</li>}
                  </ul>
                  <p className="mt-3 text-sm">Spent <strong>{result.spentDisplay}</strong> · {result.remainingDisplay} budget left.</p>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <aside className="space-y-3">
        <h2 className="font-semibold">Live payments to creators</h2>
        <div className="space-y-2">
          {feed.map((p) => (
            <div key={p.id} className="card !p-3 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">@{p.creator_handle}</span>
                <span className="text-accent2 mono">+{p.creator_amount} µUSDC</span>
              </div>
              <div className="text-black/50">{p.title} · lines {p.line_start}–{p.line_end}</div>
              <div className="mono text-[10px] text-black/30">{p.tx_hash.slice(0, 18)}… {p.simulated ? "(sim)" : ""}</div>
            </div>
          ))}
          {feed.length === 0 && <p className="text-sm text-black/40">No payments yet — run the agent.</p>}
        </div>
      </aside>
    </div>
  );
}
