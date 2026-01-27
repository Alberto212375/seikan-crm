// src/app/api/quotes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


function eurosToCents(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function pad6(n: number) {
  return String(n).padStart(6, "0");
}

function parseSeqFromNumber(numberStr: string): number {
  const parts = String(numberStr || "").split("-");
  const seq = parts[2] ?? "";
  const n = parseInt(seq, 10);
  return Number.isFinite(n) ? n : 0;
}

type PostersPayload = {
  firstOrder: boolean;
  vatExempt: boolean;

  // ✅ Paiement différé (arrhes 50% / solde 50%) — sinon acompte 0
  deferredPayment?: boolean;

  closingDate: string; // YYYY-MM-DD
  deliveryWindowLabel: string;
  discountAppliedPct?: number;

  // ✅ ordre de sélection par format (pour la règle 1→2 sur la 1ère ligne)
  selectionOrderByFmt?: Record<"30x40" | "A3" | "A2", string[]>;

    selections: Array<{
    format: "30x40" | "A3" | "A2";
    ref: string; // R-XXXXXX
    name: string; // déjà latin + FR ou "-"
    qty: number;

    // ✅ NEW : grammage à afficher dans la désignation PDF (ex: "250g", "135g")
    grammage?: string;
  }>;
};

function calcUnitPriceEuros(format: "30x40" | "A3" | "A2", totalUnitsInFormat: number) {
  const base =
    totalUnitsInFormat >= 50 ? 12 : totalUnitsInFormat >= 25 ? 14 : totalUnitsInFormat >= 10 ? 16 : 18;
  return format === "A2" ? base + 8 : base;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseIsoDateOnly(s: string): Date | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  // attendu YYYY-MM-DD
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysDiffCeil(from: Date, to: Date) {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const ms = b.getTime() - a.getTime();
  const day = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil(ms / day) + 1); // inclusif
}

// ✅ Liste des devis (page /devis)
export async function GET() {
  try {
    const quotes = await prisma.quote.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        issueDate: true,
        clientName: true,
        clientService: true,
        metaJson: true,

        totalHT: true,
        depositHT: true,
        depositPaid: true,
        depositPaidAmount: true,
      },
    });

    return NextResponse.json({ quotes });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const clientId: string | null = body.clientId ?? null;
    const snap = body.clientSnapshot ?? {};
    const metaJson: string | null = body.metaJson ?? null;

    const posters: PostersPayload | null = body.posters ?? null;

    if (!snap?.name || String(snap.name).trim().length === 0) {
      return NextResponse.json({ error: "clientSnapshot.name manquant" }, { status: 400 });
    }

    if (!posters || !Array.isArray(posters.selections) || posters.selections.length === 0) {
      return NextResponse.json({ error: "Aucune sélection Posters" }, { status: 400 });
    }

    const firstOrder = Boolean(posters.firstOrder);
    const vatExempt = posters.vatExempt !== false; // default true
    const deferredPayment = Boolean(posters.deferredPayment); // ✅ NEW
    const discountPct = Math.max(0, Math.min(100, Number(posters.discountAppliedPct ?? 0) || 0));

    // --- normalisation selections ---
    const selections = posters.selections
      .map((s) => ({
        format: String(s.format) as "30x40" | "A3" | "A2",
        ref: String(s.ref ?? "").trim(),
        name: String(s.name ?? "").trim() || "-",
                qty: clampInt(Math.trunc(Number(s.qty ?? 1)), 1, 9999),

        // ✅ NEW
        grammage: String((s as any).grammage ?? "").trim(),
      }))
      .filter((s) => (s.format === "30x40" || s.format === "A3" || s.format === "A2") && s.ref);

    if (selections.length === 0) {
      return NextResponse.json({ error: "Sélections Posters invalides" }, { status: 400 });
    }

    // group by format
    const byFormat: Record<"30x40" | "A3" | "A2", typeof selections> = { "30x40": [], A3: [], A2: [] };
    for (const s of selections) byFormat[s.format].push(s);

    // ✅ règle demandée:
    // si NON première commande et >= 2 refs d’un même format,
    // ALORS la 1ère ref sélectionnée passe de 1 => 2 (une seule marche), les autres ne bougent pas.
    const selectionOrderByFmt = posters.selectionOrderByFmt ?? { "30x40": [], A3: [], A2: [] };

    const qtyEffectiveByRef: Record<string, number> = {};
    for (const s of selections) qtyEffectiveByRef[s.ref] = Math.max(1, s.qty);

    (Object.keys(byFormat) as Array<"30x40" | "A3" | "A2">).forEach((fmt) => {
      const list = byFormat[fmt];
      if (list.length < 2) return;
      if (firstOrder) return;

      const ordered = Array.isArray(selectionOrderByFmt?.[fmt]) ? selectionOrderByFmt[fmt] : [];
      const refsInFmt = new Set(list.map((x) => x.ref));
      const firstSelected = ordered.find((r) => refsInFmt.has(r)) ?? list[0]?.ref;

      if (firstSelected) {
        const cur = Math.max(1, qtyEffectiveByRef[firstSelected] ?? 1);
        if (cur === 1) qtyEffectiveByRef[firstSelected] = 2;
      }
    });

    // totals per format (after rule)
    const formatTotals: Record<"30x40" | "A3" | "A2", number> = { "30x40": 0, A3: 0, A2: 0 };
    (Object.keys(byFormat) as Array<"30x40" | "A3" | "A2">).forEach((fmt) => {
      for (const s of byFormat[fmt]) {
        formatTotals[fmt] += Math.max(1, qtyEffectiveByRef[s.ref] ?? s.qty ?? 1);
      }
    });

    // ✅ validation minimum 10 / format sélectionné
    (Object.keys(byFormat) as Array<"30x40" | "A3" | "A2">).forEach((fmt) => {
      if (byFormat[fmt].length === 0) return;
      const totalUnits = formatTotals[fmt];
      if (totalUnits < 10) {
        throw new Error(`Minimum de 10 posters requis pour le format ${fmt}.`);
      }
    });

    // create quote items (1 ligne par référence)
    const enforced: Array<{ label: string; qty: number; unitCents: number; sort: number }> = [];
    let sort = 0;

    (Object.keys(byFormat) as Array<"30x40" | "A3" | "A2">).forEach((fmt) => {
      const list = byFormat[fmt];
      if (list.length === 0) return;

      const unitEuros = calcUnitPriceEuros(fmt, formatTotals[fmt]);
      const unitCents = eurosToCents(String(unitEuros));

      for (const s of list) {
        const q = Math.max(1, qtyEffectiveByRef[s.ref] ?? s.qty ?? 1);

        // ✅ label demandé:
        // - toujours "R-XXXXXX — <Nom>" (Nom peut être "-" )
        // - format entre parenthèses
        const fmtLabel = fmt === "30x40" ? "30×40" : fmt;
                const gram = String((s as any).grammage ?? "").trim();
        const gramPart = gram ? ` — ${gram}` : "";

        enforced.push({
          // ✅ IMPORTANT : on garde "(format)" à la fin pour que le PDF continue d'extraire le format correctement
          label: `${s.ref} — ${s.name || "-"}${gramPart} (${fmtLabel})`,
          qty: q,
          unitCents,
          sort: sort++,
        });
      }
    });

    // totals HT posters
    const postersHT = enforced.reduce((sum, it) => sum + Math.round(it.qty * it.unitCents), 0);

    // remise
    const discountAmount = discountPct > 0 ? Math.round((postersHT * discountPct) / 100) : 0;
    const afterDiscountHT = postersHT - discountAmount;

    // franco : seuil standard 250€ HT (sinon 20€), si première commande seuil = 120€ HT
    const francoThreshold = firstOrder ? 12000 : 25000;
    const francoCost = afterDiscountHT >= francoThreshold ? 0 : 2000;

    // ✅ ligne franco toujours présente + libellé “Livraison offerte (…)” si 0€
    const francoLabel =
      francoCost === 0
        ? `Livraison offerte (Franco supérieur à ${firstOrder ? "120" : "250"}€ HT)`
        : `Frais de livraison (Franco supérieur à ${firstOrder ? "120" : "250"}€ HT)`;

    enforced.push({
      label: francoLabel,
      qty: 1,
      unitCents: francoCost,
      sort: sort++,
    });

    // total HT final
    const totalHT = afterDiscountHT + francoCost;

    // ✅ ARRHES DB : dépend uniquement de “Paiement différé”
    // - NON coché => 0%
    // - coché => 50%
    const depositPct = deferredPayment ? 50 : 0;
    const depositHT = Math.round((totalHT * depositPct) / 100);
    const balanceHT = totalHT - depositHT;

    // ✅ Seq global
    const agg = await prisma.quote.aggregate({ _max: { seq: true } });
    const nextSeq = (agg._max.seq ?? 0) + 1;

    // ✅ Numéro devis DEV-YYYY-000001
    const year = new Date().getFullYear();
    const prefix = `DEV-${year}-`;

    const lastThisYear = await prisma.quote.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    const lastYearSeq = lastThisYear?.number ? parseSeqFromNumber(lastThisYear.number) : 0;
    const nextYearSeq = lastYearSeq + 1;
    const number = `${prefix}${pad6(nextYearSeq)}`;

    const issueDate = new Date();

    // ✅ Validité = jusqu’à la clôture choisie
    const closing = parseIsoDateOnly(String(posters.closingDate ?? "")) ?? issueDate;
    const validUntil = closing;
    const validDays = daysDiffCeil(issueDate, validUntil);

    // ✅ Arrhes : par défaut non versées, montant proposé = depositHT (0 si paiement comptant)
    const depositPaid = false;
    const depositPaidAmount = depositHT;

    // meta merge (utile PDF)
    const metaMerged = (() => {
      try {
        const base = metaJson ? JSON.parse(metaJson) : {};
        return JSON.stringify({
          ...base,
          posters: {
  ...(base?.posters ?? {}),
  firstOrder,
  vatExempt,

  // ✅ IMPORTANT : persist pour le PDF
  deferredPayment,

  discountAppliedPct: discountPct,
  francoThreshold,
  francoCost,
  closingDate: String(posters.closingDate ?? ""),
  deliveryWindowLabel: String(posters.deliveryWindowLabel ?? ""),

  // ✅ IMPORTANT : nécessaire pour /api/orders (Commandes)
  selections: selections.map((s) => ({
    format: s.format,
    ref: s.ref,
    name: s.name || "-",
    qty: Math.max(1, qtyEffectiveByRef[s.ref] ?? s.qty ?? 1),
  })),
},

        });
      } catch {
        return metaJson;
      }
    })();

    const quote = await prisma.quote.create({
      data: {
        seq: nextSeq,
        number,
        status: "DRAFT",
        issueDate,
        validDays,
        validUntil,
        metaJson: metaMerged,

        clientId,
        clientName: String(snap.name ?? "").trim(),
        clientService: snap.service ? String(snap.service) : null,
        clientEmail: snap.email ? String(snap.email) : null,
        clientPhone: snap.phone ? String(snap.phone) : null,
        clientAddress: snap.address ? String(snap.address) : null,

        totalHT,
        depositPct,
        depositHT,

        depositPaid,
        depositPaidAmount,

        balanceHT,
        currency: "EUR",

        items: {
          create: enforced.map((it) => ({
            label: it.label,
            qty: it.qty,
            unitPrice: it.unitCents,
            vatRate: 0,
            discountRate: 0,
            sort: it.sort,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json({ quote });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id manquant" }, { status: 400 });
    }

    const depositPaid = Boolean(body?.depositPaid);
    const amountEuros = body?.depositPaidAmountEuros ?? "";
    const depositPaidAmount = eurosToCents(amountEuros);

    const updated = await prisma.quote.update({
      where: { id },
      data: { depositPaid, depositPaidAmount },
      select: {
        id: true,
        depositPaid: true,
        depositPaidAmount: true,
        totalHT: true,
        depositHT: true,
      },
    });

    return NextResponse.json({ quote: updated });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
