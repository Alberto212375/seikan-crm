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

function normalize(s: unknown) {
  return String(s ?? "").trim();
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

  // ✅ indispensable pour que la liste affiche "Signé" (vert/jaune)
  metaJson: c.metaJson ?? null,
};
  });

  return NextResponse.json({ consignments: rows });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
        const snap = body?.clientSnapshot ?? {};
    const snapBilling = snap?.billing ?? {};


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

    const paperWeight = body?.paperWeight === "135g" ? "135g" : "250g";

const items = itemsRaw.map((it: any, idx: number) => {
  const nameFR = String(it?.nameFR || "").trim() || null;

  // grammage : priorité à la ligne, sinon paperWeight global
  let grammage = String(it?.grammage || "").trim() || paperWeight;
  grammage = grammage === "135g" ? "135g" : "250g";

  // ✅ IMPORTANT : on injecte le grammage dans la désignation stockée (garanti pour PDF)
  const nameFRWithGram = nameFR ? `${nameFR} — ${grammage}` : null;

  // ✅ PU fixe dépôt-vente (en centimes)
  const unitPriceCents = grammage === "135g" ? 1500 : 1800;

  return {
    ref: String(it?.ref || "—").trim(),
    format: String(it?.format || "—").trim(),
    nameFR: nameFRWithGram,
    qty: Math.max(1, Number(it?.qty || 1)),
    unitPrice: unitPriceCents,
    sort: idx,
  };
});

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

                metaJson: JSON.stringify({
  party: {
    isProfessional: Boolean(snap?.isProfessional),
    societe: normalize(snap?.societe),
    service: normalize(snap?.service),
    siret: normalize(snap?.siret),
    lastName: normalize(snap?.lastName),
    firstName: normalize(snap?.firstName),
  },
  billingAddress: {
    street: normalize(snapBilling?.street),
    postalCode: normalize(snapBilling?.postalCode),
    city: normalize(snapBilling?.city),
  },

  // ✅ NEW : audit posters (papier)
  posters: {
    paperWeight,
  },
}),

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
