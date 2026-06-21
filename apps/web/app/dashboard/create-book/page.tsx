"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toaster";
import { splitPages } from "@/lib/chunk-content";
import { normalizeImageUrl, isLikelyImageUrl } from "@/lib/image-links";

interface ChapterDraft {
  title: string;
  body: string;
}

/**
 * Chapter Builder — create a Skimflow Book. The author sets a cover + blurb, then
 * adds chapters one at a time (paste text; split pages with a `---` line). Pages
 * are the payable unit; the very first page is a free preview. Publishes in one
 * POST to /api/creator/content with contentType:"book".
 */
export default function CreateBookPage() {
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0.05");
  const [chapters, setChapters] = useState<ChapterDraft[]>([{ title: "Chapter 1", body: "" }]);
  const [busy, setBusy] = useState(false);

  const pageCounts = useMemo(() => chapters.map((ch) => splitPages(ch.body).length), [chapters]);
  const totalPages = pageCounts.reduce((a, b) => a + b, 0);

  function updateChapter(i: number, patch: Partial<ChapterDraft>) {
    setChapters((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addChapter() {
    setChapters((cs) => [...cs, { title: `Chapter ${cs.length + 1}`, body: "" }]);
  }
  function removeChapter(i: number) {
    setChapters((cs) => (cs.length <= 1 ? cs : cs.filter((_, idx) => idx !== i)));
  }

  async function submit(status: "draft" | "published") {
    if (!title.trim()) {
      toast("warning", "Give your book a title.");
      return;
    }
    if (coverImageUrl.trim() && !isLikelyImageUrl(normalizeImageUrl(coverImageUrl.trim()))) {
      toast("warning", "That cover image link doesn't look like a valid URL.");
      return;
    }
    if (totalPages < 2) {
      toast("warning", "Add at least 2 pages — the first is a free preview. Use a `---` line to split pages.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/creator/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: "book",
          title: title.trim(),
          coverImageUrl: coverImageUrl.trim() || undefined,
          summary: description.trim(),
          pricePerBlock: price,
          status,
          chapters: chapters.map((c) => ({ title: c.title.trim() || "Untitled", body: c.body })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Couldn't save the book.");
      if (data.walletRequired) {
        toast("info", "Saved as a draft — add a payout wallet in your dashboard to publish.");
        router.push("/dashboard");
        return;
      }
      toast("success", status === "published" ? "Book published!" : "Draft saved.");
      router.push(status === "published" && data.content?.slug ? `/read/${data.content.slug}` : "/dashboard");
    } catch (e) {
      toast("error", String((e as Error)?.message ?? e), "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-margin-mobile pb-40 pt-stack-lg md:px-margin-desktop">
      <Link href="/dashboard" className="inline-flex h-11 items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
        ← Dashboard
      </Link>

      {/* Book setup — a seamless canvas, no boxes. The title writes large like a
          manuscript; secondary fields are underlined, not boxed. */}
      <section className="mt-2 flex flex-col gap-8">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled book"
          aria-label="Book title"
          className="w-full border-0 border-b border-outline-variant/50 bg-transparent pb-2 font-display-lg text-display-lg-mobile leading-tight placeholder:text-outline/50 focus:border-primary focus:outline-none"
        />

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex-1">
            <label className="mb-1.5 block font-label-caps text-label-caps text-outline">Cover image URL — optional</label>
            <input
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://… or a Google Drive share link"
              className="w-full border-0 border-b border-outline-variant/50 bg-transparent py-2 font-data-mono text-[13px] placeholder:text-outline/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="w-full sm:w-32">
            <label className="mb-1.5 block font-label-caps text-label-caps text-outline">Price / page</label>
            <div className="flex items-baseline gap-1 border-b border-outline-variant/50 focus-within:border-primary">
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-transparent py-2 font-data-mono focus:outline-none"
              />
              <span className="font-data-mono text-[12px] text-outline">USDC</span>
            </div>
          </div>
        </div>

        {coverImageUrl.trim() && isLikelyImageUrl(normalizeImageUrl(coverImageUrl.trim())) && (
          <div className="h-40 w-28 overflow-hidden rounded-lg editorial-shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={normalizeImageUrl(coverImageUrl.trim())} alt="cover preview" className="h-full w-full object-cover" />
          </div>
        )}

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="A short synopsis, shown on the cover card…"
          aria-label="Description"
          className="w-full resize-none border-0 bg-transparent font-body-lg text-on-surface-variant placeholder:text-outline/50 focus:outline-none"
        />
      </section>

      {/* Chapter builder — chapters flow down the page, separated by hairlines
          rather than cards. Title underlined, body fully borderless. */}
      <section className="mt-12 flex flex-col">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-label-caps text-label-caps uppercase tracking-wide text-outline">Chapters</h2>
          <span className="font-body-sm text-[12px] text-on-surface-variant">
            {totalPages} page{totalPages === 1 ? "" : "s"} · page 1 is a free preview
          </span>
        </div>

        {chapters.map((ch, i) => (
          <div key={i} className="flex flex-col gap-2 border-t hairline py-6 first:border-t-0">
            <div className="flex items-center gap-3">
              <span className="shrink-0 font-data-mono text-[12px] text-outline">{i + 1}.</span>
              <input
                value={ch.title}
                onChange={(e) => updateChapter(i, { title: e.target.value })}
                placeholder="Chapter title"
                className="flex-1 border-0 bg-transparent font-headline-sm text-[18px] placeholder:text-outline/50 focus:outline-none"
              />
              <span className="shrink-0 font-data-mono text-[11px] text-outline">
                {pageCounts[i]} pg{pageCounts[i] === 1 ? "" : "s"}
              </span>
              {chapters.length > 1 && (
                <button
                  onClick={() => removeChapter(i)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-outline transition-colors hover:bg-on-surface/5 hover:text-error"
                  title="Remove chapter"
                  aria-label={`Remove chapter ${i + 1}`}
                >
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                </button>
              )}
            </div>
            <textarea
              value={ch.body}
              onChange={(e) => updateChapter(i, { body: e.target.value })}
              rows={10}
              placeholder={"Paste the chapter text here (Markdown supported).\n\nSplit it into pages with a line containing only ---"}
              className="w-full resize-y border-0 bg-transparent font-reading text-[16px] leading-relaxed placeholder:text-outline/50 focus:outline-none"
            />
          </div>
        ))}

        <button
          onClick={addChapter}
          className="mt-4 inline-flex items-center gap-1.5 self-start font-label-caps text-label-caps text-primary transition-opacity hover:opacity-70"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add chapter
        </button>
      </section>

      {/* Actions — Publish carries the accent; Save draft is plain, borderless. */}
      <div className="fixed inset-x-0 bottom-14 z-40 border-t hairline bg-surface/80 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-4 px-margin-mobile py-3 pb-safe md:px-margin-desktop">
          <button
            onClick={() => submit("draft")}
            disabled={busy}
            className="min-h-[44px] px-4 font-label-caps text-label-caps text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            onClick={() => submit("published")}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-7 font-label-caps text-label-caps text-on-primary shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Publish book"}
          </button>
        </div>
      </div>
    </div>
  );
}
