import { handlers } from "@/auth";

// NextAuth route handler. Node runtime so the DB-backed jwt callback can run.
export const runtime = "nodejs";
export const { GET, POST } = handlers;
