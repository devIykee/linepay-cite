"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Tab = "over-time" | "by-content";
const RANGES = ["7d", "30d", "90d", "all"] as const;

interface TimePoint { date: string; gross: string; platform: string; creator: string; txCount: number }
interface ContentPoint { contentId: string; title: string; slug: string; gross: string; creator: string; platform: string }

export default function RevenueCharts() {
  const [tab, setTab] = useState<Tab>("over-time");
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const [time, setTime] = useState<TimePoint[]>([]);
  const [byContent, setByContent] = useState<ContentPoint[]>([]);

  useEffect(() => {
    if (tab !== "over-time") return;
    fetch(`/api/admin/charts?type=revenue-over-time&range=${range}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setTime(d.data ?? []))
      .catch(() => {});
  }, [tab, range]);

  useEffect(() => {
    if (tab !== "by-content") return;
    fetch(`/api/admin/charts?type=revenue-by-content`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setByContent(d.data ?? []))
      .catch(() => {});
  }, [tab]);

  const timeData = time.map((p) => ({ date: p.date, Gross: Number(p.gross), Platform: Number(p.platform), tx: p.txCount }));
  const contentData = byContent.map((c) => ({
    name: c.title.length > 22 ? c.title.slice(0, 22) + "…" : c.title,
    slug: c.slug,
    Creator: Number(c.creator),
    Platform: Number(c.platform),
  }));

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button onClick={() => setTab("over-time")} className={tab === "over-time" ? "btn-filled px-4 py-1 text-label-lg" : "btn-outline px-4 py-1 text-label-lg"}>
            Revenue Over Time
          </button>
          <button onClick={() => setTab("by-content")} className={tab === "by-content" ? "btn-filled px-4 py-1 text-label-lg" : "btn-outline px-4 py-1 text-label-lg"}>
            Revenue by Content
          </button>
        </div>
        {tab === "over-time" && (
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={range === r ? "rounded-full bg-primary px-3 py-1 text-label-caps text-on-primary" : "rounded-full border border-outline px-3 py-1 text-label-caps"}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: "100%", height: 320 }}>
        {tab === "over-time" ? (
          <ResponsiveContainer>
            <LineChart data={timeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} />
              <Legend />
              <Line type="monotone" dataKey="Gross" stroke="#6750A4" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Platform" stroke="#7D5260" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer>
            <BarChart layout="vertical" data={contentData} margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="name" width={140} fontSize={11} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} />
              <Legend />
              <Bar dataKey="Creator" stackId="a" fill="#6750A4" />
              <Bar dataKey="Platform" stackId="a" fill="#7D5260" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
