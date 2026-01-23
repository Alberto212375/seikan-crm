// src/app/api/invoices/[id]/send/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodemailer = require("nodemailer");

function fmtDateFR(d: Date | string | null | undefined) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function centsToEurosStr(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function safeJson<T = any>(s: any): T | null {
  if (!s) return null;
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return null;
  }
}

function pickClientName(displayName: string) {
  const s = String(displayName || "").trim();
  return s || "Client";
}

function buildPosterLines(items: { label: string; qty: number }[]) {
  const posters = items.filter((it) => /poster/i.test(it.label || ""));
  if (posters.length === 0) return ["(aucune ligne “Poster …” détectée dans la facture)"];

  return posters.map((it) => {
    const label = String(it.label || "").trim();
    const qty = Number(it.qty || 0);

    // tente : "Poster R-123456 : A3"
    const m = label.match(/Poster\s+([A-Za-z0-9-]+)\s*[:—-]\s*(.+)$/i);
    if (m) {
      const ref = m[1];
      const rest = m[2];
      return `Poster ${ref} : ${rest} — quantité ${qty}`;
    }

    // fallback : on reprend le label tel quel
    return `${label} — quantité ${qty}`;
  });
}

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP non configuré. Ajoute SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS dans les variables d’environnement."
    );
  }

  const secure = String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true" ? true : port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function getFromAddress() {
  // par défaut : ton adresse
  return process.env.SMTP_FROM || "SEIKAN GALLERY <seikan.gallery@gmail.com>";
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const invoiceId = params.id;

  try {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        quote: true,
        items: true,
      },
    });

    if (!inv) return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

    // On ne permet l’envoi que si facture émise
    const status = String((inv as any).status || "");
    if (status !== "ISSUED") {
      return NextResponse.json({ error: "La facture doit être en statut ISSUED pour être envoyée." }, { status: 400 });
    }

    const issuedAt = (inv as any).issuedAt ?? null;

    const toEmail =
      String((inv as any).client?.email || "").trim() ||
      String((inv as any).quote?.clientEmail || "").trim();

    if (!toEmail) {
      return NextResponse.json({ error: "Email client manquant (fiche client / snapshot devis)." }, { status: 400 });
    }

    const clientName = pickClientName(String((inv as any).client?.displayName || ""));
    const invoiceNumber = String((inv as any).number || "").trim() || "FACTURE";
    const quoteNumber = String((inv as any).quote?.number || "").trim();
    const quoteId = (inv as any).quote?.id || null;

    // Meta devis (si dispo) pour livraison / paiement différé etc.
    const quoteMeta = safeJson<any>((inv as any).quote?.metaJson) || {};
    const deliveryDate =
      String(quoteMeta?.delivery?.date || "").trim() ||
      String(quoteMeta?.delivery?.estimated || "").trim() ||
      "";

    const deferredPayment = Boolean(quoteMeta?.posters?.deferredPayment);
    const dueAt = (inv as any).dueAt ?? null;

    // PDF buffers via tes routes exports (on réutilise tes générateurs existants)
    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    // facture PDF
    const invPdfResp = await fetch(`${origin}/api/exports/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });
    if (!invPdfResp.ok) {
      const t = await invPdfResp.text().catch(() => "");
      return NextResponse.json(
        { error: "Impossible de générer/charger le PDF de facture.", details: t.slice(0, 500) },
        { status: 500 }
      );
    }
    const invoicePdf = Buffer.from(await invPdfResp.arrayBuffer());

    // devis PDF (si lié)
    let quotePdf: Buffer | null = null;
    if (quoteId) {
      const qPdfResp = await fetch(`${origin}/api/exports/quotes/${encodeURIComponent(quoteId)}/pdf`, {
        headers: cookie ? { cookie } : undefined,
        cache: "no-store",
      });
      if (qPdfResp.ok) {
        quotePdf = Buffer.from(await qPdfResp.arrayBuffer());
      }
    }

    // lignes posters
    const posterLines = buildPosterLines(
      (inv as any).items?.map((it: any) => ({ label: it.label, qty: Number(it.qty || 0) })) ?? []
    );

    // Montants
    // Dans ton UI tu affiches invoice.totalHT => donc ton /api/invoices renvoie totalHT.
    // Ici, côté DB, on n’a pas forcément ce champ. On tente :
    const totalHT =
      Number((inv as any).totalHT ?? 0) ||
      (Array.isArray((inv as any).items)
        ? (inv as any).items.reduce((s: number, it: any) => {
            const qty = Number(it.qty || 0);
            const unit = Number(it.unitPrice || 0);
            return s + Math.round(qty * unit);
          }, 0)
        : 0);

    const subjectRef = quoteNumber || invoiceNumber;
    const subject = `Confirmation de votre commande et envoi du devis et de la facture – ${subjectRef}`;

    const bodyText = [
      `Bonjour Madame, Monsieur, ${clientName},`,
      ``,
      `Nous vous remercions sincèrement pour votre commande de posters.`,
      ``,
      `Nous vous confirmons avoir bien reçu votre demande et nous avons le plaisir de vous envoyer, en pièces jointes, les documents relatifs à votre commande :`,
      ``,
      quoteNumber ? `Le devis signé daté du ${fmtDateFR((inv as any).quote?.updatedAt ?? (inv as any).quote?.createdAt)}` : `Le devis (pièce jointe)`,
      ``,
      `La facture correspondant à votre commande, pour un montant total de ${centsToEurosStr(totalHT)} €`,
      ``,
      `Les références des posters commandés :`,
      ``,
      ...posterLines.map((l) => `- ${l}`),
      ``,
      `Détails importants concernant votre commande :`,
      `Date de livraison estimée : ${deliveryDate || "—"}`,
      `Montant total de la commande : ${centsToEurosStr(totalHT)} €`,
      ``,
      `Modalités de paiement : ${deferredPayment ? "Paiement différé" : "Paiement à la commande"}`,
      `Date d'échéance du paiement : ${deferredPayment ? fmtDateFR(dueAt) : "—"}`,
      `Mode de paiement : Virement bancaire (ou selon accord)`,
      ``,
      `Nous vous remercions encore une fois pour votre confiance et restons à votre entière disposition pour toute question ou information complémentaire.`,
      `N'hésitez pas à nous contacter si vous avez besoin de précisions sur votre commande ou sur les modalités de paiement.`,
      ``,
      `Nous vous souhaitons une excellente journée et à très bientôt pour la livraison de vos posters.`,
      ``,
      `Cordialement,`,
      `Xavier CUZIN`,
      `SEIKAN GALLERY`,
      `seikan.gallery@gmail.com`,
      `06.10.38.02.08`,
      ``,
      `Pièces jointes :`,
      quoteNumber ? `- Devis signé ${quoteNumber} (PDF)` : `- Devis (PDF)`,
      `- Facture ${invoiceNumber} (PDF)`,
      ``,
    ].join("\n");

    const transporter = buildTransporter();

    const attachments: any[] = [
      {
        filename: `Facture-${invoiceNumber}.pdf`,
        content: invoicePdf,
        contentType: "application/pdf",
      },
    ];

    if (quotePdf && quoteNumber) {
      attachments.unshift({
        filename: `Devis-${quoteNumber}.pdf`,
        content: quotePdf,
        contentType: "application/pdf",
      });
    } else if (quotePdf) {
      attachments.unshift({
        filename: `Devis.pdf`,
        content: quotePdf,
        contentType: "application/pdf",
      });
    }

    await transporter.sendMail({
      from: getFromAddress(),
      to: toEmail,
      subject,
      text: bodyText,
      attachments,
    });

        // ✅ Marquer "email envoyé" (metaJson facture)
    try {
      const currentMeta = safeJson<any>((inv as any).metaJson) || {};
      const nowIso = new Date().toISOString();

      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          metaJson: JSON.stringify({
            ...currentMeta,
            emailSentAt: nowIso,
            emailSentCount: Number(currentMeta.emailSentCount || 0) + 1,
            emailSentTo: toEmail,
            emailLastSubject: subject,
          }),
        },
      });
    } catch {
      // non bloquant
    }

    // Optionnel : log activité
    try {
      await prisma.activity.create({
        data: {
          type: "EMAIL",
          title: `Facture envoyée au client (${invoiceNumber})`,
          body: `Envoyé à ${toEmail}\nDevis: ${quoteNumber || "—"}`,
          clientId: (inv as any).clientId,
        },
      });
    } catch {
      // non bloquant
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Erreur envoi email.", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
