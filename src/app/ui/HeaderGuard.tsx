// src/app/ui/HeaderGuard.tsx
"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function HeaderGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // ✅ pages publiques (pas de menu)
  if (pathname === "/skgl") return null;

  // (si tu ajoutes d'autres pages publiques plus tard, ajoute-les ici)
  // if (pathname.startsWith("/public")) return null;

  return <>{children}</>;
}
