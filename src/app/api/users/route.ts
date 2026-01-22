import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  const me = await prisma.user.findUnique({ where: { email } });
  if (!me || me.role !== "ADMIN") return null;

  return me;
}

export async function GET() {
  const me = await requireAdmin();
  if (!me) return new Response("Forbidden", { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return Response.json({ users });
}

export async function POST(req: Request) {
  const me = await requireAdmin();
  if (!me) return new Response("Forbidden", { status: 403 });

  const body = await req.json().catch(() => null);

  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = String(body?.name ?? "").trim();
  const password = String(body?.password ?? "");
  const role = body?.role === "ADMIN" ? "ADMIN" : "USER";

  if (!email || !password) {
    return new Response("Email et mot de passe requis", { status: 400 });
  }
  if (!email.includes("@")) {
    return new Response("Email invalide", { status: 400 });
  }
  if (password.length < 8) {
    return new Response("Mot de passe trop court (min 8 caractères)", {
      status: 400,
    });
  }

  // ✅ évite 500 en cas d'email déjà existant
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return new Response("Cet email existe déjà", { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, name: name || null, password: hash, role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return Response.json({ user }, { status: 201 });
}
