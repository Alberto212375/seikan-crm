// src/app/api/orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PosterFormat = "30x40" | "A3" | "A2";

type ItemAgg = {
  format: PosterFormat;
  ref: string;
  name: string;
  totalQty: number;
  clients: Array<{ clientId: string; clientName: string; qty: number }>;
};

type ClosureAgg = {
  key: string; // YYYY-MM-DD (clôture) ou date de création (TEST)
  items: ItemAgg[];
};

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

type OrderMetaLite = {
  closureDateISO?: string | null;
};

type OrderRow = {
  id: string;
  createdAt: Date;
  payBeforeDate: Date | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  items: Array<{ ref: string; label: string; qty: number; sort: number }>;
  metaJson: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const formatFilter = String(url.searchParams.get("format") || "ALL"); // ALL | 30x40 | A3 | A2

    // ✅ on prend toutes les commandes
    const orders = (await prisma.order.findMany({
      select: {
  id: true,
  createdAt: true,
  payBeforeDate: true,
  firstName: true,
  lastName: true,
  companyName: true,
  metaJson: true,
  items: { select: { ref: true, label: true, qty: true, sort: true } },
},
      orderBy: { createdAt: "desc" },
    })) as unknown as OrderRow[];

    // closureKey -> itemKey -> agg
    const closureMap = new Map<
      string,
      Map<
        string,
        {
          format: PosterFormat;
          ref: string;
          name: string;
          totalQty: number;
          clientMap: Map<string, { clientId: string; clientName: string; qty: number }>;
        }
      >
    >();

    for (const o of orders) {
  const meta = safeJsonParse<OrderMetaLite>(o.metaJson) ?? {};

  // ✅ Priorité :
  // 1) closureDateISO (commande CLASSIC)
  // 2) payBeforeDate (commande TEST)
  // 3) createdAt (fallback sécurité)
  const closureKey =
    String(meta.closureDateISO || "").trim() ||
    isoDateOnly(new Date(o.payBeforeDate ?? o.createdAt));

  const clientId = o.id; // clé unique suffisante
  const clientName =
    o.companyName && o.companyName.trim()
      ? o.companyName.trim()
      : `${String(o.firstName || "").trim()} ${String(o.lastName || "").trim()}`.trim() || "Client";

      if (!closureMap.has(closureKey)) closureMap.set(closureKey, new Map());
      const itemMap = closureMap.get(closureKey)!;

      const items = Array.isArray(o.items) ? o.items.slice() : [];
      items.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

      for (const it of items) {
        const ref = String(it.ref || "").trim();
        const name = String(it.label || "-").trim();
        const qty = Math.max(0, Number(it.qty ?? 0) || 0);

        if (!ref || qty <= 0) continue;

        // on ignore la ligne livraison dans l’agrégation produit
        if (ref.toUpperCase() === "LIVRAISON") continue;

        const fmt: PosterFormat = "30x40";
        if (formatFilter !== "ALL" && fmt !== formatFilter) continue;

        const itemKey = `${fmt}__${ref}`;
        if (!itemMap.has(itemKey)) {
          itemMap.set(itemKey, {
            format: fmt,
            ref,
            name,
            totalQty: 0,
            clientMap: new Map(),
          });
        }

        const agg = itemMap.get(itemKey)!;
        agg.totalQty += qty;

        if (!agg.clientMap.has(clientId)) {
          agg.clientMap.set(clientId, { clientId, clientName, qty: 0 });
        }
        agg.clientMap.get(clientId)!.qty += qty;
      }
    }

    const closures: ClosureAgg[] = Array.from(closureMap.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // plus récent d’abord
      .map(([key, itemMap]) => {
        const items: ItemAgg[] = Array.from(itemMap.values())
          .sort((a, b) => {
            if (a.format !== b.format) return a.format.localeCompare(b.format);
            return a.ref.localeCompare(b.ref);
          })
          .map((x) => ({
            format: x.format,
            ref: x.ref,
            name: x.name,
            totalQty: x.totalQty,
            clients: Array.from(x.clientMap.values()).sort((a, b) => a.clientName.localeCompare(b.clientName)),
          }));

        return { key, items };
      });

    return NextResponse.json({ closures });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur /api/orders" }, { status: 500 });
  }
}
