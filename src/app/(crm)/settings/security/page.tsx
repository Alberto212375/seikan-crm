import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SecurityClient from "./SecurityClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?from=/settings/security");

  return <SecurityClient />;
}
