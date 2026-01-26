// src/app/api/consignments/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  const c = await prisma.consignment.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, displayName: true, email: true } },
      items: { orderBy: { sort: "asc" } },
      documents: true,
    },
  });

  if (!c) return NextResponse.json({ error: "Dépôt introuvable." }, { status: 404 });

  const pdfDoc = (c.documents ?? []).find((d) => d.filename?.includes("Depot-vente") || d.filename?.includes("DV-"));

  return NextResponse.json({
    consignment: {
      id: c.id,
      number: c.number,
      status: c.status,
      client: c.client,
      clientName: c.clientName,
      clientEmail: c.clientEmail,
      clientPhone: c.clientPhone,
      clientAddress: c.clientAddress,
      depositDate: c.depositDate.toISOString(),
      recoveryDate: c.recoveryDate.toISOString(),
      periodDays: c.periodDays,
      emailSentAt: c.emailSentAt ? c.emailSentAt.toISOString() : null,
            emailSentCount: c.emailSentCount ?? 0,

      // ✅ nécessaire pour hydrater l’UI signature + PDF signé
      metaJson: (c as any).metaJson ?? null,
      signedAt: (c as any).signedAt ? (c as any).signedAt.toISOString() : null,

      items: c.items,
      pdf: pdfDoc
        ? { id: pdfDoc.id, filename: pdfDoc.filename, storageKey: pdfDoc.storageKey }
        : null,
    },
  });
}

// PATCH = actions
// - { generate: true } -> passera en GENERATED + (BLOC 2: crée le PDF + Document)
// - { sign: true } -> passera en SIGNED + (BLOC 2: PDF signé)
// - { updateDates: { depositDate, recoveryDate, periodDays } }
// - { updateItem: { itemId, qty, unitPrice, nameFR } }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const body = await req.json().catch(() => ({}));

  const c = await prisma.consignment.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Dépôt introuvable." }, { status: 404 });

  // update dates
  if (body?.updateDates) {
    const d = body.updateDates || {};
    const depositDate = d.depositDate ? new Date(String(d.depositDate)) : c.depositDate;
    const periodDays = Math.max(1, Number(d.periodDays || c.periodDays || 1));
    const recoveryDate = d.recoveryDate ? new Date(String(d.recoveryDate)) : c.recoveryDate;

    await prisma.consignment.update({
      where: { id },
      data: { depositDate, recoveryDate, periodDays },
    });

    return NextResponse.json({ ok: true });
  }

  // update item
  if (body?.updateItem) {
    const it = body.updateItem || {};
    const itemId = String(it.itemId || "");
    if (!itemId) return NextResponse.json({ error: "itemId manquant." }, { status: 400 });

    await prisma.consignmentItem.update({
      where: { id: itemId },
      data: {
        qty: it.qty != null ? Math.max(1, Number(it.qty)) : undefined,
        unitPrice: it.unitPrice != null ? Math.max(0, Math.round(Number(it.unitPrice))) : undefined,
        nameFR: it.nameFR != null ? String(it.nameFR || "").trim() || null : undefined,
      },
    });

    return NextResponse.json({ ok: true });
  }

    // generate = on passe en GENERATED + on crée un Document (comme devis/facture)
  if (body?.generate) {
    const updated = await prisma.consignment.update({
      where: { id },
      data: { status: "GENERATED" },
    });

    // Document “PDF dépôt” (même si le PDF est généré à la volée, on garde un artefact dans Document)
    try {
      const filename = `Depot-vente-${updated.number}.pdf`;
      await prisma.document.create({
        data: {
          type: "CONSIGNMENT_PDF",
          filename,
          mimeType: "application/pdf",
          size: 0,
          storageKey: `exports/consignments/${updated.id}/pdf`,
          consignmentId: updated.id,
          clientId: updated.clientId,
        },
      });
    } catch {
      // non bloquant
    }

    return NextResponse.json({ ok: true });
  }

  // sign = on passe en SIGNED + signedAt + Document “signé”
  if (body?.sign) {
    const updated = await prisma.consignment.update({
      where: { id },
      data: { status: "SIGNED", signedAt: new Date() },
    });

    try {
      const filename = `Depot-vente-${updated.number}-SIGNE.pdf`;
      await prisma.document.create({
        data: {
          type: "CONSIGNMENT_PDF",
          filename,
          mimeType: "application/pdf",
          size: 0,
          storageKey: `exports/consignments/${updated.id}/pdf?signed=1`,
          consignmentId: updated.id,
          clientId: updated.clientId,
        },
      });
    } catch {
      // non bloquant
    }

    return NextResponse.json({ ok: true });
  }


  return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
}
