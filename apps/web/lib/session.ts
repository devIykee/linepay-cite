/**
 * Server-side session helpers for route handlers and server components.
 * Node runtime only (imports the DB-backed `auth` and the store).
 */
import { cookies } from "next/headers";
import { auth } from "../auth.js";
import { getUserById } from "./store.js";
import { IMPERSONATION_COOKIE, verifyImpersonation } from "./impersonation.js";
import type { User } from "./types.js";

/** Thrown by require* helpers; convert with errorResponse(). */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/** Turn a thrown error into a JSON Response (401/403/4xx/500). */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.code, message: e.message }, { status: e.status });
  }
  console.error("[route error]", e);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

export async function currentSession() {
  return auth();
}

/** Require an authenticated user; returns the full DB row. Throws 401. */
export async function requireUser(): Promise<User> {
  const s = await auth();
  if (!s?.user?.id) throw new HttpError(401, "unauthorized", "Sign in required.");
  const u = await getUserById(s.user.id);
  if (!u) throw new HttpError(401, "unauthorized", "Account not found.");
  if (u.suspended) throw new HttpError(403, "account_suspended", "Your account is suspended.");
  return u;
}

/** Require an admin user. Throws 401/403. */
export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "forbidden", "Admin access required.");
  return u;
}

export interface ActingContext {
  /** The effective creator being acted as (impersonated target or the user). */
  user: User;
  impersonating: boolean;
  /** The real admin's id when impersonating (for audit / write-blocking). */
  realAdminId?: string;
}

/**
 * Resolve who the dashboard renders as. If the logged-in user is an admin and
 * holds a valid impersonation cookie, returns the impersonated creator with
 * `impersonating: true` (callers must treat writes as disabled).
 */
export async function resolveActingUser(): Promise<ActingContext> {
  const user = await requireUser();
  if (user.role === "admin") {
    const cookie = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    if (cookie) {
      const claims = await verifyImpersonation(cookie);
      if (claims && claims.adminId === user.id) {
        const target = await getUserById(claims.targetId);
        if (target) return { user: target, impersonating: true, realAdminId: user.id };
      }
    }
  }
  return { user, impersonating: false };
}

/** Guard for write actions: blocks them during impersonation. */
export function assertNotImpersonating(ctx: ActingContext): void {
  if (ctx.impersonating) {
    throw new HttpError(403, "impersonation_readonly", "Not available in impersonation mode.");
  }
}
