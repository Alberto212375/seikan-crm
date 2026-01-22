import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SettingsPage() {
  const session = await auth();
  const email = session?.user?.email;

  let isAdmin = false;
  if (email) {
    const me = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });
    isAdmin = me?.role === "ADMIN";
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Paramètres</h1>
      <p className="mt-2 text-neutral-600">
        Configuration du CRM — société, TVA, numérotation, modèles PDF, utilisateurs.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {/* ✅ Visible uniquement ADMIN */}
        {isAdmin && (
          <Link
            href="/settings/users"
            className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow"
          >
            <div className="text-sm font-semibold">Utilisateurs</div>
            <div className="mt-1 text-sm text-zinc-600">
              Créer des comptes, gérer les rôles (Admin/Utilisateur).
            </div>
            <div className="mt-3 text-sm font-medium text-zinc-900 underline underline-offset-4 opacity-70 group-hover:opacity-100">
              Ouvrir
            </div>
          </Link>
        )}

        {/* ✅ Toujours visible : sécurité / mot de passe */}
        <Link
          href="/settings/security"
          className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow"
        >
          <div className="text-sm font-semibold">Sécurité</div>
          <div className="mt-1 text-sm text-zinc-600">
            Changer votre mot de passe.
          </div>
          <div className="mt-3 text-sm font-medium text-zinc-900 underline underline-offset-4 opacity-70 group-hover:opacity-100">
            Ouvrir
          </div>
        </Link>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm opacity-60">
          <div className="text-sm font-semibold">Société & TVA</div>
          <div className="mt-1 text-sm text-zinc-600">À venir (placeholder).</div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm opacity-60">
          <div className="text-sm font-semibold">Numérotation</div>
          <div className="mt-1 text-sm text-zinc-600">À venir (DEV/FAC, séquences).</div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm opacity-60">
          <div className="text-sm font-semibold">Modèles PDF</div>
          <div className="mt-1 text-sm text-zinc-600">À venir (devis/factures).</div>
        </div>
      </div>
    </div>
  );
}
