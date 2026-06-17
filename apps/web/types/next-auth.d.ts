import type { DefaultSession } from "next-auth";

/** Extra fields we put on the session/JWT (see auth.ts callbacks). */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "creator" | "admin";
      handle: string | null;
      walletLinked: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: "creator" | "admin";
    handle?: string | null;
    walletLinked?: boolean;
  }
}
