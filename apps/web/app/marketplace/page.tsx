"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Item {
  id: string;
  slug: string;
  title: string;
  summary: string;
  contentType: string;
  pricePerBlock: string;
  blockCount: number;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorVerified?: boolean;
  url: string;
  agentUrl: string | null;
  excerpt?: string;
}

export default function MarketplacePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => {
    if (q.trim()) {
      setSearching(true);
      fetch(`/api/marketplace/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setItems(d.results ?? []))
        .catch(() => {})
        .finally(() => setSearching(false));
      return;
    }
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (sort) p.set("sort", sort);
    fetch(`/api/marketplace?${p}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }, [q, type, sort]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-8">
        <h1 className="mb-2 font-display-lg text-display-lg-mobile md:text-display-lg">Marketplace</h1>
        <p className="max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Pay-per-block content for humans and agents. Read the free block, then unlock the rest in USDC on Arc.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search content…"
          className="flex-grow rounded-lg border border-outline px-4 py-2 text-body-md"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm" disabled={!!q.trim()}>
          <option value="">All types</option>
          <option value="article">Articles</option>
          <option value="agent-skills">Agent Skills</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm" disabled={!!q.trim()}>
          <option value="newest">Newest</option>
          <option value="popular">Popular</option>
        </select>
      </div>

      {searching && <p className="font-body-sm text-on-surface-variant">Searching…</p>}

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <Link key={c.id} href={c.url} className="card flex flex-col text-left transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-2 flex items-center gap-2">
              <span className="pill">{c.contentType === "agent-skills" ? "Agent Skills" : "Article"}</span>
              {c.creatorVerified && <span className="font-label-caps text-label-caps text-secondary">verified</span>}
            </div>
            <h3 className="mb-2 font-headline-sm text-headline-sm leading-tight">{c.title}</h3>
            {c.excerpt ? (
              <p className="mb-4 flex-grow font-body-sm text-body-sm text-on-surface-variant" dangerouslySetInnerHTML={{ __html: c.excerpt }} />
            ) : (
              <p className="mb-4 flex-grow font-body-sm text-body-sm text-on-surface-variant">{c.summary}</p>
            )}
            <div className="flex items-center justify-between font-data-mono text-[12px] text-outline">
              <span>@{c.creatorHandle ?? "unknown"}</span>
              <span>{c.pricePerBlock} USDC/block</span>
            </div>
          </Link>
        ))}
        {items.length === 0 && !searching && (
          <p className="font-body-md text-on-surface-variant">No content found.</p>
        )}
      </div>
    </div>
  );
}
