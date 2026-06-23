import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import RichText from "@/components/RichText";

// Read the canonical Markdown at build time and bake it into static HTML.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Partners & Developers",
  description:
    "Integrate, resell, or co-market with Skimflow: build a paying agent, sell content programmatically, attach payment sidecars, and earn the on-chain referral cut.",
  alternates: { canonical: "/partners" },
};

function loadDoc(): string {
  // Build runs in apps/web; the docs live at the repo root.
  const p = path.join(process.cwd(), "..", "..", "docs", "PARTNERS.md");
  return readFileSync(p, "utf8");
}

export default function PartnersPage() {
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
