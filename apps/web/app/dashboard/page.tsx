import { redirect } from "next/navigation";
import { resolveActingUser } from "@/lib/session";
import DashboardClient from "./_components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let ctx;
  try {
    ctx = await resolveActingUser();
  } catch {
    redirect("/login");
  }
  const u = ctx.user;
  return (
    <DashboardClient
      user={{
        id: u.id,
        name: u.display_name,
        email: u.email,
        handle: u.handle,
        walletLinked: !!u.wallet_address,
        wallet: u.wallet_address,
      }}
      impersonating={ctx.impersonating}
    />
  );
}
