// src/app/ui/AppHeader.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const crmNav = [
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

const publicNav = [
  { href: "/public/portfolio-pro", label: "Portfolio" },
  { href: "/public/skgl-national", label: "Commander" },
];

function isPublicRoute(pathname: string) {
  return (
    pathname === "/public/portfolio-pro" ||
    pathname.startsWith("/public/portfolio-pro/") ||
    pathname === "/public/skgl-national" ||
    pathname.startsWith("/public/skgl-national/")
  );
}

export default function AppHeader() {
  const pathname = usePathname() || "/";
  const onPublic = isPublicRoute(pathname);

  const nav = onPublic ? publicNav : crmNav;

  return (
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
  );
}
