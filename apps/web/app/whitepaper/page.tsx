import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import RichText from "@/components/RichText";

// Read the canonical Markdown at build time and bake it into static HTML, so the
// live page never needs a runtime filesystem read (reliable on Vercel).
export const dynamic = "force-static";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "White Paper",
  description:
    "Skimflow: nanopayments for people and agents — a pay-per-block content market settled in USDC on Arc. The economic and technical thesis.",
  alternates: { canonical: "/whitepaper" },
};

function loadDoc(): string {
  // Build runs in apps/web; the docs live at the repo root.
  const p = path.join(process.cwd(), "..", "..", "docs", "WHITEPAPER.md");
  return readFileSync(p, "utf8");
}

export default function WhitepaperPage() {
  const source = loadDoc();
  return (
    <div className="mx-auto max-w-3xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <Link href="/docs" className="inline-flex h-11 items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
        ← Docs
      </Link>
      <article className="mt-4">
        <RichText source={source} />
      </article>
    </div>
  );
}
