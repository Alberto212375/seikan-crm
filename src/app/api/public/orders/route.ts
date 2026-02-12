// src/app/api/public/orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTransporter } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ paramètres business (source de vérité côté serveur)
const FRANCO_CLASSIC_EUR = 180; // HT
const SHIPPING_CLASSIC_EUR = 20; // HT
const TEST_UNIT_EUR = 11;

const MIN_TEST_TOTAL = 2;
const MAX_TEST_TOTAL = 10;

const MIN_CLASSIC_TOTAL = 10;
const MIN_CLASSIC_PER_VISUAL = 2;

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
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function fmtFRShort(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function addDaysUTC(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function deliveryWindowFromClosureISO(closureISO: string) {
  const d12 = addDaysUTC(closureISO, 12);
  const d15 = addDaysUTC(closureISO, 15);
  if (!d12 || !d15) return "";
  return `Livraison entre le ${fmtFRShort(d12)} et le ${fmtFRShort(d15)}`;
}
function classicUnitEur(totalQty: number) {
  if (totalQty >= 40) return 10;
  if (totalQty >= 20) return 11;
  if (totalQty >= 10) return 12;
  return 0; // <10 : pas autorisé
}

function firstBusinessDayOfMonthISO(year: number, monthIndex0: number) {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const day = d.getUTCDay(); // 0 dim, 6 sam
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2); // samedi -> lundi
  if (day === 0) d.setUTCDate(d.getUTCDate() + 1); // dimanche -> lundi
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function allowedClassicClosuresISO(now = new Date()) {
  const list: string[] = [];

  // ✅ aujourd'hui en UTC (00:00)
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // on parcourt à partir du mois courant
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  while (list.length < 2) {
    const y = cursor.getUTCFullYear();
    const m0 = cursor.getUTCMonth();
    const mm = m0 + 1;

    // ✅ skip mars (03)
    if (mm !== 3) {
      const closureISO = firstBusinessDayOfMonthISO(y, m0); // YYYY-MM-DD
      const closureUTC = new Date(`${closureISO}T00:00:00.000Z`);

      // ✅ uniquement les clôtures strictement futures
      if (closureUTC > todayUTC) {
        list.push(closureISO);
      }
    }

    cursor = new Date(Date.UTC(y, m0 + 1, 1));
  }

  return list;
}

type PublicOrderItem = {
  ref: string;
  label: string;
  qty: number;
  unitPriceCents: number;
  sort?: number;
};

type PublicOrderPayload = {
  code?: string;
  kind?: "TEST" | "CLASSIC";

  firstName: string;
  lastName: string;
  email: string;

  companyName?: string | null;
  siret?: string | null;

  street: string;
  postalCode: string;
  city: string;

  // envoyé par le front, mais le serveur peut recalculer
  deliveryWindowLabel?: string;
  packagingLabel?: string;

  closureMonthKey?: string | null;
  closureDateISO?: string | null;

  items: PublicOrderItem[];

  signature: {
    accepted: boolean;
    signerFirstName?: string;
    signerLastName?: string;
    signerRole?: string;
    signedAt?: string;
    signatureDataUrl?: string;
  };
};

function makeEmailHtml(args: {
  orderNumber: string;
  invoiceNumber: string;
  customerName: string;
  deliveryWindow: string;
  totalCents: number;
  payBeforeDateIso: string;
}) {
  const euros = (args.totalCents / 100).toFixed(2).replace(".", ",");
  const payBefore = fmtFRShort(new Date(args.payBeforeDateIso));

  return `
  <div style="font-family: Arial, sans-serif; color:#111; line-height:1.55">
    <h2 style="margin:0 0 10px 0">Confirmation de commande — ${args.orderNumber}</h2>

    <p style="margin:0 0 10px 0">Bonjour ${args.customerName},</p>

    <p style="margin:0 0 12px 0">
      Votre commande est confirmée et signée (“Bon pour accord”).<br/>
      Vous trouverez la commande signée (PDF) et la facture (PDF) en pièces jointes.
    </p>

    <p style="margin:0 0 14px 0">
      <strong>Facture :</strong> ${args.invoiceNumber}<br/>
      <strong>Livraison :</strong> ${args.deliveryWindow}<br/>
      <strong>Total :</strong> ${euros} € HT
    </p>

    <p style="margin:0 0 12px 0">
      La commande est à régler en intégralité avant le <strong>${payBefore}</strong> via virement.
      Merci d’indiquer votre numéro de commande en intitulé du virement.
    </p>

    <p style="margin:0">
      Seikan Gallery<br/>
      Xavier CUZIN<br/>
      seikan.gallery@gmail.com<br/>
      06.10.38.02.08
    </p>
  </div>
  `;
}

function parseSeqFromNumber(numberStr: string): number {
  // attendu: FAC-YYYY-000001
  const parts = String(numberStr || "").split("-");
  const seq = parts[2] ?? "";
  const n = parseInt(seq, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PublicOrderPayload;

    // --- champs client ---
    const firstName = normalize(body.firstName);
    const lastName = normalize(body.lastName);
    const email = normalize(body.email);

    const companyName = body.companyName ? normalize(body.companyName) : null;
    const siret = body.siret ? normalize(body.siret) : null;

    const street = normalize(body.street);
    const postalCode = normalize(body.postalCode);
    const city = normalize(body.city);

    // --- contrôle basique ---
    if (!firstName || !lastName) return NextResponse.json({ error: "Prénom et nom obligatoires." }, { status: 400 });
    if (!email) return NextResponse.json({ error: "Email obligatoire." }, { status: 400 });
    if (!street || !postalCode || !city) return NextResponse.json({ error: "Adresse complète obligatoire." }, { status: 400 });

    // --- commande ---
    const code = normalize(body.code || "skgl").toLowerCase();
    const kind: "TEST" | "CLASSIC" = body.kind === "CLASSIC" ? "CLASSIC" : "TEST";

    const closureMonthKey = body.closureMonthKey ? normalize(body.closureMonthKey) : null;
    const closureDateISO = body.closureDateISO ? normalize(body.closureDateISO) : null;

    // --- signature ---
    const sig = body.signature ?? ({} as any);
    const accepted = Boolean(sig.accepted);
    const signatureDataUrl = normalize(sig.signatureDataUrl || "");
    const signedAt = normalize(sig.signedAt || new Date().toISOString());

    if (!accepted || !signatureDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Bon pour accord + signature obligatoires." }, { status: 400 });
    }

    // --- emballage ---
    const packagingLabel = normalize(body.packagingLabel || "Emballage en pochette plastique + carton rigide");

    // --- livraison + payBeforeDate (recalcul serveur) ---
    let deliveryWindowLabel = normalize(body.deliveryWindowLabel || "Livraison entre le 12 et le 15 mars");
    let payBeforeDate = new Date(`${new Date().getFullYear()}-03-01T00:00:00.000Z`);

    if (kind === "CLASSIC") {
      if (!closureDateISO) {
        return NextResponse.json({ error: "Clôture obligatoire pour une commande classique." }, { status: 400 });
      }

      const allowed = allowedClassicClosuresISO(new Date());
      if (!allowed.includes(closureDateISO)) {
        return NextResponse.json(
          { error: "Clôture non autorisée (merci de choisir une des 2 prochaines clôtures proposées)." },
          { status: 400 }
        );
      }

      const computedDelivery = deliveryWindowFromClosureISO(closureDateISO);
      if (!computedDelivery) {
        return NextResponse.json({ error: "Clôture invalide." }, { status: 400 });
      }

      deliveryWindowLabel = computedDelivery;
      payBeforeDate = new Date(`${closureDateISO}T00:00:00.000Z`);
    }

    // --- items (nettoyage) ---
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

    // --- on ignore toute ligne LIVRAISON envoyée par le front : le serveur la refait ---
    const posterItems = normalizedItems.filter((x) => String(x.ref).toUpperCase() !== "LIVRAISON");
    const postersQty = posterItems.reduce((s, it) => s + (it.qty || 0), 0);

    // --- règles quantités ---
    if (kind === "TEST") {
      if (postersQty < MIN_TEST_TOTAL) {
        return NextResponse.json({ error: `Minimum ${MIN_TEST_TOTAL} posters en commande test.` }, { status: 400 });
      }
      if (postersQty > MAX_TEST_TOTAL) {
        return NextResponse.json({ error: `Maximum ${MAX_TEST_TOTAL} posters en commande test.` }, { status: 400 });
      }
    } else {
      if (postersQty < MIN_CLASSIC_TOTAL) {
        return NextResponse.json({ error: `Minimum ${MIN_CLASSIC_TOTAL} posters en commande classique.` }, { status: 400 });
      }
      const bad = posterItems.filter((it) => it.qty > 0 && it.qty < MIN_CLASSIC_PER_VISUAL);
      if (bad.length) {
        return NextResponse.json(
          { error: `Merci de sélectionner au moins ${MIN_CLASSIC_PER_VISUAL} posters par visuel.` },
          { status: 400 }
        );
      }
    }

    // --- prix unitaire recalculé serveur ---
    const unitEur = kind === "TEST" ? TEST_UNIT_EUR : classicUnitEur(postersQty);
    if (kind === "CLASSIC" && unitEur === 0) {
      return NextResponse.json({ error: "Commande classique : le barème commence à 10 posters." }, { status: 400 });
    }
    const unitCents = Math.round(unitEur * 100);

    // --- sous-total posters ---
    const postersSubtotalCents = postersQty * unitCents;

    // --- shipping recalculé ---
    let shippingCents = 0;
    if (kind === "CLASSIC") {
      shippingCents = postersSubtotalCents >= FRANCO_CLASSIC_EUR * 100 ? 0 : SHIPPING_CLASSIC_EUR * 100;
    }

    // --- items reconstruits ---
    const rebuiltItems: PublicOrderItem[] = [
      ...posterItems.map((it) => ({
        ref: it.ref,
        label: it.label,
        qty: it.qty,
        unitPriceCents: unitCents,
        sort: it.sort ?? 0,
      })),
    ];

    if (kind === "CLASSIC") {
      rebuiltItems.push({
        ref: "LIVRAISON",
        label:
          shippingCents === 0
            ? `Livraison offerte (Franco supérieur à ${FRANCO_CLASSIC_EUR}€ HT)`
            : `Frais de livraison (Franco supérieur à ${FRANCO_CLASSIC_EUR}€ HT)`,
        qty: 1,
        unitPriceCents: shippingCents,
        sort: 9998,
      });
    }

    const totalCents = rebuiltItems.reduce((s, it) => s + it.qty * it.unitPriceCents, 0);

    // --- Numérotation Order ---
    const agg = await prisma.order.aggregate({ _max: { seq: true } });
    const nextSeq = (agg._max.seq ?? 0) + 1;
    const year = new Date().getFullYear();
    const number = `CMD-${year}-${pad6(nextSeq)}`;

    // --- metaJson Order (pour PDF + regroupement Commandes) ---
    const orderMeta = {
      code,
      kind,
      closureMonthKey,
      closureDateISO,
      deliveryWindowLabel,
      packagingLabel,
      pricing: {
        postersQty,
        unitEur,
        postersSubtotalCents,
        shippingCents,
        totalCents,
        francoClassicEur: FRANCO_CLASSIC_EUR,
      },
      signature: {
        accepted: true,
        signerFirstName: normalize(sig.signerFirstName || firstName),
        signerLastName: normalize(sig.signerLastName || lastName),
        signerRole: normalize(sig.signerRole || "Client") || "Client",
        signedAt,
        signatureDataUrl,
      },
    };

    // --- DB create Order ---
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
        packagingLabel,
        deliveryWindowLabel,
        payBeforeDate,
        metaJson: JSON.stringify(orderMeta),
        totalCents,
        items: {
          create: rebuiltItems.map((it) => ({
            ref: it.ref,
            label: it.label,
            qty: it.qty,
            unitPriceCents: it.unitPriceCents,
            sort: it.sort ?? 0,
          })),
        },
      },
      include: { items: true },
    });

    // ===========================
    // ✅ CRM : créer/mettre à jour Client + Facture auto
    // ===========================

    // 1) Client (email NON unique dans ton schema -> findFirst puis update/create)
const displayName = companyName ? companyName : `${firstName} ${lastName}`.trim();

const existingClient = await prisma.client.findFirst({
  where: { email }, // ok même si email n'est pas unique
  select: { id: true },
});

const client = existingClient
  ? await prisma.client.update({
      where: { id: existingClient.id },
      data: {
        displayName,
        companyName: companyName ?? null,
        // on aligne l'adresse (simple : on stocke en string)
        billingAddress: `${street}, ${postalCode} ${city}`.trim(),
        shippingAddress: `${street}, ${postalCode} ${city}`.trim(),
        // on ne force pas phone/tags/notes : on ne touche pas
      },
      select: { id: true },
    })
  : await prisma.client.create({
      data: {
        type: companyName ? "COMPANY" : "INDIVIDUAL",
        typeLocked: Boolean(companyName),
        companyName: companyName ?? null,
        serviceName: null,
        displayName,
        email, // ton Client.email est optionnel, mais ici on en a un (order email)
        phone: null,
        billingAddress: `${street}, ${postalCode} ${city}`.trim(),
        shippingAddress: `${street}, ${postalCode} ${city}`.trim(),
        tags: [],
        notes: null,
      },
      select: { id: true },
    });

    // 2) Numérotation Facture FAC-YYYY-000001 (comme /api/invoices)
    const invYear = new Date().getFullYear();
    const prefix = `FAC-${invYear}-`;

    const lastThisYear = await prisma.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    const lastSeq = lastThisYear?.number ? parseSeqFromNumber(lastThisYear.number) : 0;
    const nextInvSeq = lastSeq + 1;
    const invoiceNumber = `${prefix}${pad6(nextInvSeq)}`;

    // 3) Créer Invoice + lignes (unitPrice en cents, cohérent avec ton PDF facture)
    const invoiceMeta = {
      source: "SKGL_ORDER",
      orderId: order.id,
      orderNumber: order.number,

      // ✅ infos nécessaires au PDF facture sans Quote
      orderSnapshot: {
        firstName,
        lastName,
        email,
        companyName,
        siret,
        street,
        postalCode,
        city,
        deliveryWindowLabel,
        packagingLabel,
        payBeforeDateIso: payBeforeDate.toISOString(),
      },

      // ✅ statut envoi email (si tu veux badge plus tard)
      emailSentAt: null,
      emailSentCount: 0,
      emailSentTo: null,
      emailLastSubject: null,
    };

    const invoice = await prisma.invoice.create({
      data: {
        number: invoiceNumber,
        status: "ISSUED", // ✅ générée automatiquement
        issuedAt: new Date(),
        dueAt: payBeforeDate,

        clientId: client.id,
        quoteId: null, // ✅ pas de devis

        currency: "EUR",
        metaJson: JSON.stringify(invoiceMeta),

        // ✅ montants en cents
        totalHT: totalCents,
        depositPct: 0,
        depositHT: 0,
        depositPaid: false,
        depositPaidAmount: 0,

        items: {
          create: rebuiltItems.map((it) => ({
            label: `${it.ref} — ${it.label} (30×40)`,
            qty: it.qty,
            unitPrice: it.unitPriceCents, // cents
            vatRate: 0,
            discountRate: 0,
            sort: it.sort ?? 0,
          })),
        },
      },
      select: { id: true, number: true },
    });

    // --- PDF Commande (déjà existant chez toi) ---
    const origin = new URL(req.url).origin;

    const orderPdfUrl = `${origin}/api/exports/orders/${order.id}/pdf`;
    const orderPdfResp = await fetch(orderPdfUrl, { method: "GET" });
    if (!orderPdfResp.ok) {
      const txt = await orderPdfResp.text().catch(() => "");
      console.error("ORDER PDF EXPORT FAILED", { status: orderPdfResp.status, txt });
      return NextResponse.json({ error: `Commande créée mais PDF commande impossible (${orderPdfResp.status}).` }, { status: 500 });
    }
    const orderPdfBuffer = Buffer.from(await orderPdfResp.arrayBuffer());

    // --- PDF Facture ---
    const invoicePdfUrl = `${origin}/api/exports/invoices/${invoice.id}/pdf`;
    const invoicePdfResp = await fetch(invoicePdfUrl, { method: "GET" });
    if (!invoicePdfResp.ok) {
      const txt = await invoicePdfResp.text().catch(() => "");
      console.error("INVOICE PDF EXPORT FAILED", { status: invoicePdfResp.status, txt });
      return NextResponse.json({ error: `Commande + facture créées mais PDF facture impossible (${invoicePdfResp.status}).` }, { status: 500 });
    }
    const invoicePdfBuffer = Buffer.from(await invoicePdfResp.arrayBuffer());

    // --- mail ---
    const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || "seikan.gallery@gmail.com";
    const proCopyTo = process.env.ORDERS_BCC || smtpFrom;

    const transporter = getTransporter();

    const subject = `Seikan Gallery — Commande signée ${order.number}`;
    const html = makeEmailHtml({
      orderNumber: order.number,
      invoiceNumber: invoice.number,
      customerName: `${firstName} ${lastName}`.trim(),
      deliveryWindow: deliveryWindowLabel,
      totalCents,
      payBeforeDateIso: payBeforeDate.toISOString(),
    });

    await transporter.sendMail({
      from: `SEIKAN GALLERY <${smtpFrom}>`,
      to: email,
      bcc: proCopyTo,
      subject,
      html,
      attachments: [
        {
          filename: `Commande_${order.number}.pdf`,
          content: orderPdfBuffer,
          contentType: "application/pdf",
        },
        {
          filename: `Facture_${invoice.number}.pdf`,
          content: invoicePdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      number: order.number,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
    });
  } catch (e: any) {
    console.error("POST /api/public/orders ERROR", e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
