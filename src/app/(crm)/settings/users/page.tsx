import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function UsersPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) notFound();

  const me = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });

  if (!me || me.role !== "ADMIN") notFound();

  return <UsersClient />;
}
