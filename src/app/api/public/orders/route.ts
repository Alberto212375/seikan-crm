// src/app/api/public/orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderKind } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(s: unknown) {
  return String(s ?? "").trim();
}

function toInt(n: unknown, def = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  return Math.trunc(x);
}

function pad6(n: number) {
  return String(n).padStart(6, "0");
}

function parseSeqFromNumber(numberStr: string): number {
  // CMD-YYYY-000123
  const parts = String(numberStr || "").split("-");
  const seq = parts[2] ?? "";
  const n = parseInt(seq, 10);
  return Number.isFinite(n) ? n : 0;
}

type PublicOrderItem = {
  ref: string;
  label: string;
  qty: number;
  unitPriceCents: number;
  sort?: number;
};

type PublicOrderPayload = {
  code?: string; // stocké dans metaJson seulement
  kind?: "TEST" | "CLASSIC";

  firstName: string;
  lastName: string;
  email: string;

  companyName?: string | null;
  siret?: string | null;

  street: string;
  postalCode: string;
  city: string;

  deliveryWindowLabel?: string; // optionnel, sinon default DB
  packagingLabel?: string; // optionnel, sinon default DB
  payBeforeDate?: string; // ISO string, optionnel

  totalCents?: number;

  items: PublicOrderItem[];

  signature: {
    accepted: boolean;
    signerFirstName?: string;
    signerLastName?: string;
    signerRole?: string;
    signedAt?: string; // ISO
    signatureDataUrl?: string; // data:image/...
  };
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PublicOrderPayload;

    const firstName = normalize(body.firstName);
    const lastName = normalize(body.lastName);
    const email = normalize(body.email);

    const companyName = body.companyName ? normalize(body.companyName) : null;
    const siret = body.siret ? normalize(body.siret) : null;

    const street = normalize(body.street);
    const postalCode = normalize(body.postalCode);
    const city = normalize(body.city);

    const code = normalize(body.code || "skgl").toLowerCase();

    const kind: OrderKind = body.kind === "CLASSIC" ? OrderKind.CLASSIC : OrderKind.TEST;

    // si payload vide -> on laisse les defaults Prisma
    const deliveryWindowLabel = normalize(body.deliveryWindowLabel || "");
    const packagingLabel = normalize(body.packagingLabel || "");

    // paiement avant : si non fourni, on met +10 jours (simple et safe)
    const payBeforeDateRaw = normalize(body.payBeforeDate || "");
    const payBeforeDate =
      payBeforeDateRaw && !Number.isNaN(new Date(payBeforeDateRaw).getTime())
        ? new Date(payBeforeDateRaw)
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() + 10);
            return d;
          })();

    const sig = body.signature ?? ({} as any);
    const accepted = Boolean(sig.accepted);
    const signatureDataUrl = normalize(sig.signatureDataUrl || "");
    const signedAtIso = normalize(sig.signedAt || new Date().toISOString());

    if (!firstName || !lastName) {
      return NextResponse.json({ error: "Prénom et nom obligatoires." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: "Email obligatoire." }, { status: 400 });
    }
    if (!street || !postalCode || !city) {
      return NextResponse.json({ error: "Adresse complète obligatoire." }, { status: 400 });
    }
    if (!accepted || !signatureDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Bon pour accord + signature obligatoires." }, { status: 400 });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const normalizedItems = items
      .map((it) => ({
        ref: normalize(it.ref),
        label: normalize(it.label),
        qty: Math.max(0, toInt(it.qty, 0)),
        unitPriceCents: Math.max(0, toInt(it.unitPriceCents, 0)),
        sort: toInt(it.sort, 0),
      }))
      .filter((x) => x.ref && x.qty > 0);

    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: "Aucun article dans la commande." }, { status: 400 });
    }

    // total serveur
    const computedTotal = normalizedItems.reduce((s, it) => s + it.qty * it.unitPriceCents, 0);
    const totalCents = Math.max(0, toInt(body.totalCents, computedTotal)) || computedTotal;

    const signatureMeta = {
      accepted: true,
      signerFirstName: normalize(sig.signerFirstName || firstName),
      signerLastName: normalize(sig.signerLastName || lastName),
      signerRole: normalize(sig.signerRole || "Client") || "Client",
      signedAt: signedAtIso,
      signatureDataUrl,
      context: {
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
    };

    // metaJson (ton PDF le lit déjà via metaJson.signature)
    const metaJson = JSON.stringify({
      code,
      kind,
      deliveryWindowLabel: deliveryWindowLabel || undefined,
      packagingLabel: packagingLabel || undefined,
      pricing: {
        totalCents,
        computedTotalCents: computedTotal,
      },
      signature: signatureMeta,
    });

    // numérotation CMD-YYYY-000001 (séquence par année)
    const year = new Date().getFullYear();
    const prefix = `CMD-${year}-`;

    const lastThisYear = await prisma.order.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    const lastYearSeq = lastThisYear?.number ? parseSeqFromNumber(lastThisYear.number) : 0;
    const nextYearSeq = lastYearSeq + 1;
    const number = `${prefix}${pad6(nextYearSeq)}`;

    // seq global unique
    const agg = await prisma.order.aggregate({ _max: { seq: true } });
    const nextSeq = (agg._max.seq ?? 0) + 1;

    const order = await prisma.order.create({
      data: {
        seq: nextSeq,
        number,

        kind,
        status: "PENDING_PAYMENT",

        firstName,
        lastName,
        email,
        companyName,
        siret,
        street,
        postalCode,
        city,

        // si vide => defaults Prisma
        ...(packagingLabel ? { packagingLabel } : {}),
        ...(deliveryWindowLabel ? { deliveryWindowLabel } : {}),

        payBeforeDate,
        totalCents,

        // signature + code dans metaJson
        metaJson,

        // signedAt DB (utile filtre/status)
        signedAt: new Date(signedAtIso),

        items: {
          create: normalizedItems.map((it) => ({
            ref: it.ref,
            label: it.label,
            qty: it.qty,
            unitPriceCents: it.unitPriceCents,
            sort: it.sort,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json({ ok: true, orderId: order.id, number: order.number });
  } catch (e: any) {
    console.error("POST /api/public/orders ERROR", e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
