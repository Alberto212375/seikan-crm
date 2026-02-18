// src/app/ui/HeaderGuard.tsx
"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function HeaderGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";

  // ✅ pages publiques : on SUPPRIME le header CRM
  if (pathname.startsWith("/public")) return null;

  // ✅ si tu gardes une ancienne page publique hors /public
  if (pathname === "/skgl") return null;

  return <>{children}</>;
}
