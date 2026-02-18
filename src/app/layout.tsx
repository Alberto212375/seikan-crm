// src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import Providers from "./providers";

export const metadata = {
  title: "Seikan Gallery — CRM",
  description: "CRM local Seikan Gallery",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
