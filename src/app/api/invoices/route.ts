// src/app/api/invoices/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function pad6(n: number) {
  return String(n).padStart(6, "0");
}

function parseSeqFromNumber(numberStr: string): number {
  // attendu: FAC-YYYY-000001
  const parts = String(numberStr || "").split("-");
  const seq = parts[2] ?? "";
  const n = parseInt(seq, 10);
  return Number.isFinite(n) ? n : 0;
}

function safeParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

type QuoteItemLite = {
  label: string | null;
  qty: number | null;
  unitPrice: number | null;
  sort: number | null;
};

type QuoteMetaLite = {
  party?: {
    isProfessional?: boolean;
  };
};

type InvoiceMetaLite = {
  fromQuoteMetaJson?: string | null;
};

export async function GET() {
  try {
    // ✅ On n’affiche en liste que les factures "émises" (pas les brouillons)
    const invoices = await prisma.invoice.findMany({
      where: {
        archivedAt: null,
        status: { not: "DRAFT" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        issuedAt: true,
        currency: true,

        totalHT: true,
        depositPaid: true,
        depositPaidAmount: true,

        // ✅ nécessaire pour déduire PRO/PART depuis le devis d'origine
        metaJson: true,

        client: { select: { id: true, displayName: true } },
        quote: { select: { id: true, number: true } },
      },
    });

    // ✅ ajoute isProfessional (PRO/PART) dans la liste
    const enriched = invoices.map((inv: any) => {
      const invMeta = safeParse<InvoiceMetaLite>(inv.metaJson) ?? {};
      const fromQuoteMetaJson = invMeta.fromQuoteMetaJson ?? null;
      const quoteMeta = safeParse<QuoteMetaLite>(fromQuoteMetaJson) ?? {};
      const isProfessional = Boolean(quoteMeta.party?.isProfessional);

      const { metaJson, ...rest } = inv as any;
      return { ...rest, isProfessional };
    });

    return NextResponse.json({ invoices: enriched });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

// ✅ création (ou ouverture) d’une facture depuis un devis (en BROUILLON)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const quoteId = String(body?.quoteId ?? "").trim();
    if (!quoteId) return NextResponse.json({ error: "quoteId manquant" }, { status: 400 });

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true, client: true },
    });
    if (!quote) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    // ✅ si déjà une facture liée NON archivée, on renvoie celle-ci (même si DRAFT)
    const existing = await prisma.invoice.findFirst({
      where: { quoteId: quote.id, archivedAt: null },
      select: { id: true },
    });
    if (existing?.id) return NextResponse.json({ invoiceId: existing.id, already: true });

    if (!quote.clientId) return NextResponse.json({ error: "Devis sans clientId" }, { status: 400 });

    // ✅ numérotation facture FAC-YYYY-000001
    const year = new Date().getFullYear();
    const prefix = `FAC-${year}-`;

    const lastThisYear = await prisma.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    const lastYearSeq = lastThisYear?.number ? parseSeqFromNumber(lastThisYear.number) : 0;
    const nextYearSeq = lastYearSeq + 1;
    const number = `${prefix}${pad6(nextYearSeq)}`;

    // ✅ copie des lignes du devis
    const items = (quote.items ?? [])
      .slice()
      .sort((a: QuoteItemLite, b: QuoteItemLite) => (a.sort ?? 0) - (b.sort ?? 0))
      .map((it: QuoteItemLite) => ({
        label: String(it.label ?? ""),
        qty: Math.max(0, Number(it.qty ?? 0)),
        unitPrice: Math.max(0, Number(it.unitPrice ?? 0)),
        sort: Number(it.sort ?? 0),
        vatRate: 0,
        discountRate: 0,
      }));

    const totalHT = items.reduce((s: number, it: any) => s + Math.round((it.qty ?? 0) * (it.unitPrice ?? 0)), 0);

    // ✅ arrhes : on fige l’état du devis au moment de la transformation
    const depositPct = Number((quote as any).depositPct ?? 35) || 35;
    const depositHT = Number((quote as any).depositHT ?? 0) || 0;

    const depositPaid = Boolean((quote as any).depositPaid);
    const depositPaidAmount = Number((quote as any).depositPaidAmount ?? depositHT) || 0;

    // ✅ meta facture (remise/pénalité)
    const metaFromQuote = (quote as any).metaJson ?? null;
    const invoiceMeta = JSON.stringify({
      fromQuoteMetaJson: metaFromQuote,
      discountMode: null,
      discountPct: 0,
      discountEuros: 0,
      penalty40: false,
      penaltyExtraEuros: 0,
    });

    // ✅ IMPORTANT : facture créée en DRAFT, issuedAt = null
    const invoice = await prisma.invoice.create({
      data: {
        number,
        status: "DRAFT",
        issuedAt: null,
        clientId: quote.clientId,
        quoteId: quote.id,
        currency: "EUR",

        metaJson: invoiceMeta,

        totalHT,
        depositPct,
        depositHT,
        depositPaid,
        depositPaidAmount,

        items: {
          create: items.map((it: any) => ({
            label: it.label,
            qty: it.qty,
            unitPrice: it.unitPrice,
            vatRate: 0,
            discountRate: 0,
            sort: it.sort,
          })),
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ invoiceId: invoice.id, already: false });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
