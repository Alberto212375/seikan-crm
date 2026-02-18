// src/app/(crm)/layout.tsx
import type { ReactNode } from "react";
import Link from "next/link";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/prospects", label: "Prospects" },
  { href: "/clients", label: "Clients" },
  { href: "/devis", label: "Devis" },
  { href: "/depot-vente", label: "Dépôt-vente" },
  { href: "/commandes", label: "Commandes" },
  { href: "/facturation", label: "Facturation" },
  { href: "/archives", label: "Archives" },
  { href: "/settings", label: "Paramètres" },
];

export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b bg-white">
        <div className="flex w-full items-center justify-between px-8 py-5">
          <div className="text-lg font-semibold tracking-tight">Seikan Gallery</div>

          <nav className="flex flex-wrap gap-6 text-base font-medium">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-neutral-700 hover:text-neutral-900 hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="w-full px-8 py-8">{children}</main>
    </div>
  );
}
