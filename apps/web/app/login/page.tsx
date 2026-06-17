"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Creator sign-in (client component).
 *
 * Uses next-auth/react `signIn` rather than a server action on purpose: a
 * server action would have to import `signIn` from `@/auth`, which drags the
 * Node auth + `pg` graph into this page's bundle and makes the dev compile
 * explode. Keeping this a thin client page means the heavy graph stays in the
 * `/api/auth/*` route only.
 */
function LoginInner() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const [busy, setBusy] = useState<"google" | "github" | null>(null);

  function go(provider: "google" | "github") {
    setBusy(provider);
    // redirect: true (default) navigates the browser to the provider.
    signIn(provider, { callbackUrl }).catch(() => setBusy(null));
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6">
      <div className="card w-full text-center">
        <h1 className="mb-2 font-display-lg text-display-lg-mobile md:text-display-lg">Creator sign-in</h1>
        <p className="mb-8 font-body-md text-body-md text-on-surface-variant">
          Sign in to publish content, set per-block pricing, and get paid in USDC on Arc.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => go("google")}
            disabled={busy !== null}
            className="flex items-center justify-center gap-3 rounded-full border border-outline px-6 py-3 font-label-lg text-label-lg transition-colors hover:bg-surface-variant disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            {busy === "google" ? "Redirecting…" : "Continue with Google"}
          </button>

          <button
            type="button"
            onClick={() => go("github")}
            disabled={busy !== null}
            className="flex items-center justify-center gap-3 rounded-full bg-on-surface px-6 py-3 font-label-lg text-label-lg text-surface transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {busy === "github" ? "Redirecting…" : "Continue with GitHub"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
