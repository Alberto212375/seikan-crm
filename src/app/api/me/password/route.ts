import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");

  if (!currentPassword || !newPassword) {
    return new Response("Champs requis", { status: 400 });
  }

  if (newPassword.length < 8) {
    return new Response("Mot de passe trop court (min 8)", { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true },
  });

  if (!me) return new Response("Unauthorized", { status: 401 });

  const ok = await bcrypt.compare(currentPassword, me.password);
  if (!ok) return new Response("Mot de passe actuel incorrect", { status: 400 });

  const hash = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: me.id },
    data: { password: hash },
  });

  return Response.json({ ok: true });
}
