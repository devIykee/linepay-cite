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
    <div className="mx-auto max-w-3xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <Link href="/dashboard" className="inline-flex items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
        ← Dashboard
      </Link>
      <h1 className="mb-1 mt-3 font-display-lg text-display-lg-mobile">New book</h1>
      <p className="mb-8 font-body-md text-on-surface-variant">
        Serialized, pay-as-you-read long-form. Readers turn the page in an immersive viewer and pay per page silently.
      </p>

      {/* Book setup */}
      <section className="card mb-6 flex flex-col gap-4">
        <h2 className="font-headline-sm text-headline-sm">Book details</h2>
        <div>
          <label className="mb-1 block font-label-caps text-label-caps text-outline">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The title of your book"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-body-md focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="mb-1 block font-label-caps text-label-caps text-outline">Cover image URL (optional)</label>
            <input
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://… or a Google Drive share link"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-data-mono text-[13px] focus:border-primary focus:outline-none"
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="mb-1 block font-label-caps text-label-caps text-outline">Price / page (USDC)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-data-mono focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        {coverImageUrl.trim() && isLikelyImageUrl(normalizeImageUrl(coverImageUrl.trim())) && (
          <div className="h-40 w-28 overflow-hidden rounded-lg border border-outline-variant">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={normalizeImageUrl(coverImageUrl.trim())} alt="cover preview" className="h-full w-full object-cover" />
          </div>
        )}
        <div>
          <label className="mb-1 block font-label-caps text-label-caps text-outline">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="A short synopsis shown on the cover card."
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-body-md focus:border-primary focus:outline-none"
          />
        </div>
      </section>

      {/* Chapter builder */}
      <section className="mb-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-sm text-headline-sm">Chapters</h2>
          <span className="font-body-sm text-[12px] text-on-surface-variant">
            {totalPages} page{totalPages === 1 ? "" : "s"} total · page 1 is a free preview
          </span>
        </div>

        {chapters.map((ch, i) => (
          <div key={i} className="card flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="pill shrink-0">Ch {i + 1}</span>
              <input
                value={ch.title}
                onChange={(e) => updateChapter(i, { title: e.target.value })}
                placeholder="Chapter title"
                className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-body-md focus:border-primary focus:outline-none"
              />
              <span className="shrink-0 font-data-mono text-[11px] text-outline">
                {pageCounts[i]} page{pageCounts[i] === 1 ? "" : "s"}
              </span>
              {chapters.length > 1 && (
                <button
                  onClick={() => removeChapter(i)}
                  className="shrink-0 text-outline hover:text-error"
                  title="Remove chapter"
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
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-reading text-[15px] leading-relaxed focus:border-primary focus:outline-none"
            />
          </div>
        ))}

        <button onClick={addChapter} className="btn-outline flex items-center justify-center gap-1 px-4 py-2.5">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add chapter
        </button>
      </section>

      <div className="sticky bottom-4 flex gap-3 rounded-xl border border-outline-variant bg-surface/95 p-3 backdrop-blur">
        <button onClick={() => submit("draft")} disabled={busy} className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 font-body-md hover:bg-surface-container-low disabled:opacity-60">
          Save draft
        </button>
        <button onClick={() => submit("published")} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
          {busy ? "Saving…" : "Publish book"}
        </button>
      </div>
    </div>
  );
}
