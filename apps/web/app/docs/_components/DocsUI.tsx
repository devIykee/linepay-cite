import Link from "next/link";

/** Shared docs primitives so the overview and integrations pages stay consistent. */

export function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <pre className="my-stack-md overflow-x-auto rounded-xl border border-on-surface/15 bg-[#0b0c10] p-4 font-data-mono text-[12.5px] leading-relaxed text-[#e4e2dd]">
      {lang && <div className="mb-2 select-none font-label-caps text-[10px] uppercase text-white/40">{lang}</div>}
      <code className="whitespace-pre">{children}</code>
    </pre>
  );
}

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-stack-lg scroll-mt-24 border-b border-outline-variant pb-2 font-headline-md text-headline-md">
      {children}
    </h2>
  );
}

/** Top-of-page tab strip switching between the user docs and the integration docs. */
export function DocsTabs({ active }: { active: "overview" | "integrations" }) {
  const tabs: Array<{ href: string; label: string; key: "overview" | "integrations" }> = [
    { href: "/docs", label: "Using Skimflow", key: "overview" },
    { href: "/docs/integrations", label: "Integrations", key: "integrations" },
  ];
  return (
    <nav className="mb-stack-lg flex gap-1 border-b border-outline-variant">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={
              on
                ? "-mb-px border-b-2 border-primary px-4 py-2 font-label-lg text-label-lg text-primary"
                : "-mb-px border-b-2 border-transparent px-4 py-2 font-label-lg text-label-lg text-on-surface-variant hover:text-primary"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
