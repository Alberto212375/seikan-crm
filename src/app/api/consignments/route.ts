// src/app/api/consignments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function iso(d: Date) {
  return d.toISOString();
}

function addDaysLocal(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function GET() {
  const consignments = await prisma.consignment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, displayName: true } },
      items: { select: { qty: true } },
    },
  });

  const rows = consignments.map((c) => {
    const totalQty = (c.items ?? []).reduce((s: number, it: { qty: number | null }) => s + (it.qty || 0), 0);
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      client: c.client,
      depositDate: iso(c.depositDate),
      recoveryDate: iso(c.recoveryDate),
      totalQty,
      emailSentAt: c.emailSentAt ? iso(c.emailSentAt) : null,
      emailSentCount: c.emailSentCount ?? 0,
    };
  });

  return NextResponse.json({ consignments: rows });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const clientId = String(body?.clientId || "").trim();
    if (!clientId) {
      return NextResponse.json({ error: "clientId manquant." }, { status: 400 });
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: "Client introuvable." }, { status: 404 });
    }

    // dates
    const depositDate = body?.depositDate ? new Date(String(body.depositDate)) : new Date();
    const periodDays = Math.max(1, Number(body?.periodDays || 14));
    const recoveryDate = body?.recoveryDate
      ? new Date(String(body.recoveryDate))
      : addDaysLocal(depositDate, periodDays);

    // items
    const itemsRaw = Array.isArray(body?.items) ? body.items : [];
    if (!itemsRaw.length) {
      return NextResponse.json({ error: "Aucun article en dépôt." }, { status: 400 });
    }

    const items = itemsRaw.map((it: any, idx: number) => ({
      ref: String(it?.ref || "—").trim(),
      format: String(it?.format || "—").trim(),
      nameFR: String(it?.nameFR || "").trim() || null,
      qty: Math.max(1, Number(it?.qty || 1)),
      unitPrice: Math.max(0, Math.round(Number(it?.unitPrice || 0))),
      sort: idx,
    }));

    // numérotation DV-YYYY-0001
    const year = new Date().getFullYear();
    const maxSeq = await prisma.consignment.aggregate({ _max: { seq: true } });
    const nextSeq = Number(maxSeq._max.seq || 0) + 1;
    const padded = String(nextSeq).padStart(4, "0");
    const number = `DV-${year}-${padded}`;

    const consignment = await prisma.consignment.create({
      data: {
        seq: nextSeq,
        number,
        status: "DRAFT",
        clientId: client.id,

        depositDate,
        recoveryDate,
        periodDays,

        clientName: client.displayName,
        clientEmail: client.email,
        clientPhone: client.phone,
        clientAddress: client.shippingAddress || client.billingAddress || null,

        items: { create: items },
      },
      include: {
        client: { select: { id: true, displayName: true } },
        items: true,
      },
    });

    return NextResponse.json({ consignment });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Erreur création dépôt-vente.", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
