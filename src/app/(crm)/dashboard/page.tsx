import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-neutral-600">
          Raccourcis + stats (on les branche juste après).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Créer un prospect" href="/prospects" />
        <Card title="Créer un devis" href="/devis" />
        <Card title="Voir les factures" href="/facturation" />
        <Card title="Archives" href="/archives" />
        <Card title="Paramètres" href="/settings" />
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="text-sm font-medium">Stats (placeholder)</div>
        <p className="mt-1 text-sm text-neutral-600">
          À brancher : prospects par statut, devis en attente, factures en retard, CA mois, etc.
        </p>
      </div>
    </div>
  );
}

function Card({ title, href }: { title: string; href: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="text-base font-medium tracking-tight group-hover:underline">
        {title}
      </div>
    </Link>
  );
}