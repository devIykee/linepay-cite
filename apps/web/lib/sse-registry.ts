/**
 * In-process registry of open admin SSE connections. Enforces the per-admin
 * concurrency cap (RATE_LIMIT_ADMIN_SSE) and exposes the live client count for
 * the health panel. Per-process only — fine for the admin dashboard's scale.
 */
const perAdmin = new Map<string, number>();
let total = 0;

/** Try to acquire a slot; false if the admin is at their cap. */
export function sseAcquire(adminId: string, max: number): boolean {
  const current = perAdmin.get(adminId) ?? 0;
  if (current >= max) return false;
  perAdmin.set(adminId, current + 1);
  total += 1;
  return true;
}

export function sseRelease(adminId: string): void {
  const current = perAdmin.get(adminId) ?? 0;
  perAdmin.set(adminId, Math.max(0, current - 1));
  total = Math.max(0, total - 1);
}

export function sseCount(): number {
  return total;
}
