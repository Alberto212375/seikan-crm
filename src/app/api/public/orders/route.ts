// src/app/api/public/orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTransporter } from "@/lib/mailer";

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

  deliveryWindowLabel?: string;
  packagingLabel?: string;

  totalCents?: number;
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
  customerName: string;
  deliveryWindow: string;
  totalCents: number;
}) {
  const euros = (args.totalCents / 100).toFixed(2).replace(".", ",");
  return `
  <div style="font-family: Arial, sans-serif; color:#111; line-height:1.5">
    <h2 style="margin:0 0 8px 0">Confirmation de commande — ${args.orderNumber}</h2>
    <p style="margin:0 0 10px 0">Bonjour ${args.customerName},</p>
    <p style="margin:0 0 10px 0">
      Votre commande est confirmée et signée (“Bon pour accord”). Vous trouverez la commande signée en pièce jointe (PDF).
    </p>
    <p style="margin:0 0 10px 0">
      <strong>Livraison :</strong> ${args.deliveryWindow}<br/>
      <strong>Total :</strong> ${euros} € HT
    </p>
    <p style="margin:0">
      Seikan Gallery<br/>
      seikan.gallery@gmail.com
    </p>
  </div>
  `;
}

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
    const kind = body.kind === "CLASSIC" ? "CLASSIC" : "TEST";

    const deliveryWindowLabel = normalize(body.deliveryWindowLabel || "Livraison entre le 12 et le 15 mars");
    const packagingLabel = normalize(body.packagingLabel || "Emballage en pochette plastique + carton rigide");

    const sig = body.signature ?? ({} as any);
    const accepted = Boolean(sig.accepted);
    const signatureDataUrl = normalize(sig.signatureDataUrl || "");
    const signedAt = normalize(sig.signedAt || new Date().toISOString());

    if (!firstName || !lastName) return NextResponse.json({ error: "Prénom et nom obligatoires." }, { status: 400 });
    if (!email) return NextResponse.json({ error: "Email obligatoire." }, { status: 400 });
    if (!street || !postalCode || !city) return NextResponse.json({ error: "Adresse complète obligatoire." }, { status: 400 });
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

    const computedTotal = normalizedItems.reduce((s, it) => s + it.qty * it.unitPriceCents, 0);
    const totalCents = Math.max(0, toInt(body.totalCents, computedTotal)) || computedTotal;

    // Numérotation + payBeforeDate
    const agg = await prisma.order.aggregate({ _max: { seq: true } });
    const nextSeq = (agg._max.seq ?? 0) + 1;
    const year = new Date().getFullYear();
    const number = `CMD-${year}-${pad6(nextSeq)}`;

    // Paiement avant le 1er mars (comme ton PDF)
    const payBeforeDate = new Date(`${year}-03-01T00:00:00.000Z`);

    // metaJson.signature (exactement comme ton PDF le lit)
    const metaJson = JSON.stringify({
      code,
      kind,
      deliveryWindowLabel,
      packagingLabel,
      pricing: { totalCents, computedTotalCents: computedTotal },
      signature: {
        accepted: true,
        signerFirstName: normalize(sig.signerFirstName || firstName),
        signerLastName: normalize(sig.signerLastName || lastName),
        signerRole: normalize(sig.signerRole || "Client") || "Client",
        signedAt,
        signatureDataUrl,
      },
    });

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
        metaJson,
        totalCents,
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

    // --- Génération PDF via ta route existante /api/exports/orders/[id]/pdf ---
    const origin = new URL(req.url).origin;
    const pdfUrl = `${origin}/api/exports/orders/${order.id}/pdf`;
    const pdfResp = await fetch(pdfUrl, { method: "GET" });

    if (!pdfResp.ok) {
      const txt = await pdfResp.text().catch(() => "");
      console.error("ORDER PDF EXPORT FAILED", { status: pdfResp.status, txt });
      return NextResponse.json(
        { error: `Commande créée mais PDF impossible (${pdfResp.status}).` },
        { status: 500 }
      );
    }

    const pdfArrayBuffer = await pdfResp.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    // --- Envoi mail ---
    const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || "seikan.gallery@gmail.com";
    const proCopyTo = process.env.ORDERS_BCC || smtpFrom;

    const transporter = getTransporter();

    const subject = `Seikan Gallery — Commande signée ${order.number}`;
    const html = makeEmailHtml({
      orderNumber: order.number,
      customerName: `${firstName} ${lastName}`.trim(),
      deliveryWindow: deliveryWindowLabel,
      totalCents,
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
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({ ok: true, orderId: order.id, number: order.number });
  } catch (e: any) {
    console.error("POST /api/public/orders ERROR", e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
