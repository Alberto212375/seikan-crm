// src/app/api/orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PosterFormat = "30x40" | "A3" | "A2";

type QuoteMeta = {
  mode?: string;
  posters?: {
    closingDate?: string; // YYYY-MM-DD (1er ou 15)
    selections?: Array<{
      format?: PosterFormat;
      ref?: string; // R-XXXXXX
      name?: string; // "Shizuka no Tsubasa — Les ailes silencieuses" (latin+FR)
      qty?: number;
    }>;
  };
};

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function normalizeFormat(v: unknown): PosterFormat | null {
  const s = String(v || "").trim();
  if (s === "30x40" || s === "A3" || s === "A2") return s;
  return null;
}

function normalizeQty(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i > 0 ? i : 0;
}

type ItemAgg = {
  format: PosterFormat;
  ref: string;
  name: string;
  totalQty: number;
  clients: Array<{ clientId: string; clientName: string; qty: number }>;
};

type ClosureAgg = {
  key: string; // YYYY-MM-DD
  items: ItemAgg[];
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const onlyStatus = String(url.searchParams.get("status") || "ALL"); // ALL | ISSUED | PAID
    const formatFilter = String(url.searchParams.get("format") || "ALL"); // ALL | 30x40 | A3 | A2

    const whereStatus =
      onlyStatus === "ISSUED"
        ? { status: "ISSUED" as const }
        : onlyStatus === "PAID"
          ? { status: "PAID" as const }
          : undefined;

    // ✅ On ne prend que les factures issues d’un devis (quoteId != null)
    const invoices = await prisma.invoice.findMany({
      where: {
        quoteId: { not: null },
        ...(whereStatus ? whereStatus : {}),
      },
      select: {
        id: true,
        status: true,
        client: { select: { id: true, displayName: true } },
        quote: { select: { id: true, metaJson: true, clientName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

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

    for (const inv of invoices) {
      const q = inv.quote;
      if (!q) continue;

      const meta = safeJsonParse<QuoteMeta>(q.metaJson) ?? {};
      const posters = meta.posters ?? {};
      const closingDate = String(posters.closingDate || "").trim();
      if (!closingDate) continue;

      const selections = Array.isArray(posters.selections) ? posters.selections : [];
      if (selections.length === 0) continue;

      const clientId = inv.client?.id || "unknown";
      const clientName = String(inv.client?.displayName || q.clientName || "Client").trim();

      if (!closureMap.has(closingDate)) closureMap.set(closingDate, new Map());
      const itemMap = closureMap.get(closingDate)!;

      for (const s of selections) {
        const fmt = normalizeFormat(s.format);
        const ref = String(s.ref || "").trim();
        const name = String(s.name || "-").trim();
        const qty = normalizeQty(s.qty);

        if (!fmt || !ref || qty <= 0) continue;

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
            // tri: format puis ref
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
