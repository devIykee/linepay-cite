import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

/**
 * Edge-safe NextAuth config. Contains NO database access or Node-only imports,
 * so it can be used by the Edge middleware (middleware.ts). The DB-backed jwt
 * callback lives in auth.ts, which is used only by the Node route handler.
 *
 * Providers read GOOGLE_CLIENT_ID/SECRET and GITHUB_CLIENT_ID/SECRET from env.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  // Spec uses NEXTAUTH_SECRET; v5 defaults to AUTH_SECRET — accept either.
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    /**
     * Route protection used by the Edge middleware. Reads role from the JWT —
     * no DB. /dashboard requires a session; /admin requires role 'admin'
     * (logged-in non-admins are bounced to '/', anonymous users to /login).
     */
    authorized({ auth, request }) {
      const user = auth?.user;
      const { pathname, search } = request.nextUrl;

      if (pathname.startsWith("/admin")) {
        if (user?.role === "admin") return true;
        if (user) return Response.redirect(new URL("/", request.nextUrl));
        return false; // → signIn page
      }
      if (pathname.startsWith("/dashboard")) {
        if (user) return true;
        const login = new URL("/login", request.nextUrl);
        login.searchParams.set("callbackUrl", pathname + search);
        return Response.redirect(login);
      }
      return true;
    },
    /** Pass enriched fields from token onto the session (no DB). */
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.role = (token.role as "creator" | "admin") ?? "creator";
        session.user.handle = (token.handle as string | null) ?? null;
        session.user.walletLinked = !!token.walletLinked;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
