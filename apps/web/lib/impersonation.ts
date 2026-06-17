/**
 * Signed impersonation tokens (admin → creator). Stored in a separate httpOnly
 * cookie alongside the NextAuth session; verified server-side on /dashboard.
 * Uses jose (HS256) so it's edge- and node-compatible.
 */
import { SignJWT, jwtVerify } from "jose";

export const IMPERSONATION_COOKIE = "impersonation_token";

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET (or AUTH_SECRET) must be set to sign impersonation tokens.");
  return new TextEncoder().encode(s);
}

export interface ImpersonationClaims {
  adminId: string;
  targetId: string;
}

export async function signImpersonation(claims: ImpersonationClaims): Promise<string> {
  return new SignJWT({ adminId: claims.adminId, targetId: claims.targetId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret());
}

export async function verifyImpersonation(token: string): Promise<ImpersonationClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.adminId === "string" && typeof payload.targetId === "string") {
      return { adminId: payload.adminId, targetId: payload.targetId };
    }
    return null;
  } catch {
    return null;
  }
}
