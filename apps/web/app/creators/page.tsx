"use client";

import { useEffect, useState } from "react";

interface Creator { id: string; handle: string; display_name: string; wallet: string; verified: number }

export default function CreatorsPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [earnings, setEarnings] = useState<any>(null);
  const [msg, setMsg] = useState("");

  // register form
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("0x");
  const [verified, setVerified] = useState(false);

  // upload form
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("article");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("0.00005");
  const [body, setBody] = useState("");

  const loadCreators = () => fetch("/api/creators").then((r) => r.json()).then((d) => setCreators(d.creators ?? []));
  useEffect(() => { loadCreators(); }, []);

  useEffect(() => {
    const c = creators.find((x) => x.id === selected);
    if (!c) { setEarnings(null); return; }
    fetch(`/api/creators/${c.handle}/earnings`).then((r) => r.json()).then(setEarnings);
  }, [selected, creators]);

  async function register() {
    const res = await fetch("/api/creators", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, display_name: name || handle, wallet, verified }),
    });
    const d = await res.json();
    if (d.creator) { setMsg(`Registered @${d.creator.handle}`); await loadCreators(); setSelected(d.creator.id); }
    else setMsg(d.error ?? "error");
  }

  async function upload() {
    const c = creators.find((x) => x.id === selected);
    if (!c) { setMsg("select a creator first"); return; }
    const res = await fetch("/api/content", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorHandle: c.handle, title, kind, summary, tags, pricePerLine: Number(price), body }),
    });
    const d = await res.json();
    if (d.content) {
      setMsg(`Published "${d.content.title}" (${d.content.line_count} lines)`);
      setTitle(""); setBody(""); setSummary(""); setTags("");
      fetch(`/api/creators/${c.handle}/earnings`).then((r) => r.json()).then(setEarnings);
    } else setMsg(d.error ?? "error");
  }

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-bold">Creator portal</h1>
      {msg && <p className="pill">{msg}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">1 · Register / select creator</h2>
          <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">— pick a creator —</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>@{c.handle} {c.verified ? "✓" : ""}</option>
            ))}
          </select>
          <div className="border-t border-black/10 pt-3 space-y-2">
            <input className="input" placeholder="handle (e.g. ada_writes)" value={handle} onChange={(e) => setHandle(e.target.value)} />
            <input className="input" placeholder="display name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input mono" placeholder="wallet 0x… (Arc)" value={wallet} onChange={(e) => setWallet(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> verified creator
            </label>
            <button className="btn" onClick={register}>Register</button>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="font-semibold">2 · Upload content</h2>
          <input className="input" placeholder="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-2">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="article">article</option>
              <option value="novel_chapter">novel chapter</option>
            </select>
            <input className="input" placeholder="$ / line" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <input className="input" placeholder="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <input className="input" placeholder="tags, comma, separated" value={tags} onChange={(e) => setTags(e.target.value)} />
          <textarea className="input h-32" placeholder="Markdown body (priced per line)" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn btn-accent" onClick={upload}>Publish (x402-protected)</button>
        </section>
      </div>

      {earnings && (
        <section className="card">
          <h2 className="font-semibold">Earnings — @{earnings.creator?.handle}</h2>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <Stat label="Earned" value={earnings.earnedDisplay} />
            <Stat label="Payments" value={earnings.payments} />
            <Stat label="Lines sold" value={earnings.linesSold} />
          </div>
          <h3 className="mt-4 mb-1 text-sm font-semibold">Transaction history</h3>
          <div className="max-h-64 overflow-auto text-sm">
            <table className="w-full">
              <thead className="text-left text-xs text-black/40">
                <tr><th>when</th><th>title</th><th>lines</th><th>earned</th><th>tx</th></tr>
              </thead>
              <tbody>
                {earnings.history?.map((h: any) => (
                  <tr key={h.id} className="border-t border-black/5">
                    <td className="py-1">{new Date(h.created_at).toLocaleTimeString()}</td>
                    <td>{h.title}</td>
                    <td>{h.line_start}–{h.line_end}</td>
                    <td className="text-accent2">{h.amountDisplay}</td>
                    <td className="mono text-xs text-black/40">{h.tx_hash.slice(0, 10)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!earnings.history || earnings.history.length === 0) && <p className="text-black/40">No sales yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg bg-paper p-3">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-black/50">{label}</div>
    </div>
  );
}
