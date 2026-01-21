// src/app/api/invoices/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function eurosToCents(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function safeParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

type InvoiceMeta = {
  fromQuoteMetaJson?: string | null;

  discountMode?: "PCT" | "EUR" | null;
  discountPct?: number;
  discountEuros?: number;

  penalty40?: boolean;
  penaltyExtraEuros?: number;
};

const DISCOUNT_LABEL = "Remise commerciale";
const PENALTY_LABEL = "Pénalités de retard de paiement (L.441-10 / D.441-5)";

type LiteItem = { qty: number | null; unitPrice: number | null };

async function recomputeTotal(invoiceId: string) {
  const items: LiteItem[] = await prisma.invoiceItem.findMany({
    where: { invoiceId },
    select: { qty: true, unitPrice: true },
  });

  const totalHT = items.reduce((s: number, it: LiteItem) => s + Math.round((it.qty ?? 0) * (it.unitPrice ?? 0)), 0);

  await prisma.invoice.update({ where: { id: invoiceId }, data: { totalHT } });
  return totalHT;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const inv = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: {
        items: true,
        client: { select: { id: true, displayName: true } },
        quote: { select: { id: true, number: true } },
      },
    });
    if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ invoice: inv });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = await req.json();

    // ✅ GÉNÉRER PDF = émettre la facture (elle apparaîtra dans la liste)
    if (body?.generatePdf === true) {
      const totalHT = await recomputeTotal(id);

      const inv = await prisma.invoice.findUnique({
        where: { id },
        select: { issuedAt: true, status: true },
      });
      if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

      await prisma.invoice.update({
        where: { id },
        data: {
          status: "ISSUED",
          issuedAt: inv.issuedAt ?? new Date(),
          totalHT,
        },
      });

      return NextResponse.json({ ok: true });
    }

    // ✅ ARCHIVER : archive la facture + le devis lié
    if (body?.archive === true) {
      const inv = await prisma.invoice.findUnique({ where: { id }, select: { quoteId: true } });

      await prisma.invoice.update({ where: { id }, data: { archivedAt: new Date() } });

      if (inv?.quoteId) {
        await prisma.quote.update({ where: { id: inv.quoteId }, data: { archivedAt: new Date() } });
      }

      return NextResponse.json({ ok: true });
    }

    // ✅ SUPPRIMER une ligne
    if (body?.removeItem) {
      const itemId = String(body.removeItem.itemId ?? "").trim();
      if (!itemId) return NextResponse.json({ error: "itemId manquant" }, { status: 400 });

      const item = await prisma.invoiceItem.findUnique({
        where: { id: itemId },
        select: { id: true, invoiceId: true, label: true },
      });
      if (!item || item.invoiceId !== id) return NextResponse.json({ error: "Ligne introuvable" }, { status: 404 });

      // on supprime
      await prisma.invoiceItem.delete({ where: { id: itemId } });

      // ✅ si on a supprimé la ligne remise/pénalité, on nettoie le metaJson
      if (item.label === DISCOUNT_LABEL || item.label === PENALTY_LABEL) {
        const inv0 = await prisma.invoice.findUnique({ where: { id }, select: { metaJson: true } });
        const meta = (safeParse<InvoiceMeta>(inv0?.metaJson) ?? {}) as InvoiceMeta;

        if (item.label === DISCOUNT_LABEL) {
          meta.discountMode = null;
          meta.discountPct = 0;
          meta.discountEuros = 0;
        }
        if (item.label === PENALTY_LABEL) {
          meta.penalty40 = false;
          meta.penaltyExtraEuros = 0;
        }

        await prisma.invoice.update({ where: { id }, data: { metaJson: JSON.stringify(meta) } });
      }

      const totalHT = await recomputeTotal(id);
      return NextResponse.json({ ok: true, totalHT });
    }

    // ✅ maj état arrhes
    if (typeof body?.depositPaid === "boolean") {
      await prisma.invoice.update({ where: { id }, data: { depositPaid: Boolean(body.depositPaid) } });
      return NextResponse.json({ ok: true });
    }

    // ✅ applique pénalité (40€ + extra)
    if (body?.applyPenalty) {
      const penalty40 = Boolean(body?.penalty40);
      const extra = Math.max(0, eurosToCents(body?.penaltyExtraEuros ?? 0));
      const amount = (penalty40 ? 4000 : 0) + extra;

      const inv = await prisma.invoice.findUnique({ where: { id }, select: { metaJson: true } });
      const meta = (safeParse<InvoiceMeta>(inv?.metaJson) ?? {}) as InvoiceMeta;
      meta.penalty40 = penalty40;
      meta.penaltyExtraEuros = Number(extra) / 100;
      await prisma.invoice.update({ where: { id }, data: { metaJson: JSON.stringify(meta) } });

      const existing = await prisma.invoiceItem.findFirst({ where: { invoiceId: id, label: PENALTY_LABEL } });
      if (existing) {
        await prisma.invoiceItem.update({ where: { id: existing.id }, data: { qty: 1, unitPrice: amount } });
      } else {
        const maxSort = await prisma.invoiceItem.aggregate({ where: { invoiceId: id }, _max: { sort: true } });
        await prisma.invoiceItem.create({
          data: {
            invoiceId: id,
            label: PENALTY_LABEL,
            qty: 1,
            unitPrice: amount,
            vatRate: 0,
            discountRate: 0,
            sort: (maxSort._max.sort ?? 0) + 10,
          },
        });
      }

      const totalHT = await recomputeTotal(id);
      return NextResponse.json({ ok: true, totalHT });
    }

    // ✅ applique remise (mode PCT ou EUR) -> ligne négative
    if (body?.applyDiscount) {
      const mode = String(body?.discountMode ?? "").toUpperCase();
      const pct = Math.max(0, Math.min(100, Number(body?.discountPct ?? 0) || 0));
      const euros = Math.max(0, eurosToCents(body?.discountEuros ?? 0));

      const items: Array<{ id: string; label: string; qty: number | null; unitPrice: number | null }> =
        await prisma.invoiceItem.findMany({
          where: { invoiceId: id },
          select: { id: true, label: true, qty: true, unitPrice: true },
        });

      const base = items
        .filter((it) => it.label !== DISCOUNT_LABEL)
        .reduce((s: number, it) => s + Math.round((it.qty ?? 0) * (it.unitPrice ?? 0)), 0);

      const discountAmount = mode === "PCT" ? Math.round((base * pct) / 100) : euros;

      const inv0 = await prisma.invoice.findUnique({ where: { id }, select: { metaJson: true } });
      const meta = (safeParse<InvoiceMeta>(inv0?.metaJson) ?? {}) as InvoiceMeta;
      meta.discountMode = mode === "PCT" ? "PCT" : "EUR";
      meta.discountPct = pct;
      meta.discountEuros = Number(euros) / 100;
      await prisma.invoice.update({ where: { id }, data: { metaJson: JSON.stringify(meta) } });

      const existing = await prisma.invoiceItem.findFirst({ where: { invoiceId: id, label: DISCOUNT_LABEL } });
      if (existing) {
        await prisma.invoiceItem.update({
          where: { id: existing.id },
          data: { qty: 1, unitPrice: -Math.max(0, discountAmount) },
        });
      } else {
        const maxSort = await prisma.invoiceItem.aggregate({ where: { invoiceId: id }, _max: { sort: true } });
        await prisma.invoiceItem.create({
          data: {
            invoiceId: id,
            label: DISCOUNT_LABEL,
            qty: 1,
            unitPrice: -Math.max(0, discountAmount),
            vatRate: 0,
            discountRate: 0,
            sort: (maxSort._max.sort ?? 0) + 20,
          },
        });
      }

      const totalHT = await recomputeTotal(id);
      return NextResponse.json({ ok: true, totalHT });
    }

    // ✅ édition ligne existante
    if (body?.updateItem) {
      const itemId = String(body.updateItem.itemId ?? "").trim();
      if (!itemId) return NextResponse.json({ error: "itemId manquant" }, { status: 400 });

      const label = body.updateItem.label;
      const qty = body.updateItem.qty;
      const unitPriceEuros = body.updateItem.unitPriceEuros;

      await prisma.invoiceItem.update({
        where: { id: itemId },
        data: {
          ...(label !== undefined ? { label: String(label) } : {}),
          ...(qty !== undefined ? { qty: Math.max(0, Number(qty || 0)) } : {}),
          ...(unitPriceEuros !== undefined ? { unitPrice: eurosToCents(unitPriceEuros) } : {}),
        },
      });

      const totalHT = await recomputeTotal(id);
      return NextResponse.json({ ok: true, totalHT });
    }

    return NextResponse.json({ error: "Aucune action reconnue" }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
