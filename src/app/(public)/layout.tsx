// src/app/(public)/layout.tsx

import Link from "next/link";
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-black/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-6">
          
          <div className="text-lg font-semibold tracking-tight">
            Seikan Gallery
          </div>

          <nav className="flex items-center gap-8 text-sm font-medium">
            <Link
              href="/portfolio-pro"
              className="hover:underline"
            >
              Portfolio
            </Link>

            <Link
              href="/skgl-national"
              className="hover:underline"
            >
              Commander
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-10">
        {children}
      </main>
    </div>
  );
}
