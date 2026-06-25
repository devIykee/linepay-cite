import Link from "next/link";
import Logo from "@/components/Logo";

/**
 * Marketing footer. Rendered only for signed-out visitors (the landing/public
 * pages) — the authenticated app shell uses the bottom nav instead, so the
 * footer and bottom nav never appear together.
 */
export default function Footer() {
  return (
    <footer className="border-t border-outline-variant bg-surface-container-low">
      <div className="mx-auto flex max-w-max-width flex-col items-center justify-between gap-stack-md px-margin-mobile py-stack-lg md:flex-row md:px-margin-desktop">
        <div className="flex items-center gap-2">
          <Logo className="h-8 w-8 shrink-0" />
          <span className="label-caps text-on-surface">SKIMFLOW</span>
        </div>
        <div className="font-body-sm text-body-sm text-on-surface-variant">
          x402 · Circle Gateway · USDC on Arc
        </div>
        <div className="flex gap-gutter">
          <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/docs">Docs</Link>
          <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/for-you">For You</Link>
          <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/partners">Partners</Link>
          <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/whitepaper">White paper</Link>
          <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/terms">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
