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

// ✅ AJOUT
function fmtDateFRShort(d: Date | string | null | undefined) {
  // JJ/MM/AA
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

// ✅ AJOUT
function normalizeSpaces(s: any) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ AJOUT
function upperLastName(s: string) {
  const x = normalizeSpaces(s);
  return x ? x.toUpperCase() : "";
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

// ✅ REMPLACE pickClientName
function pickClientPersonName(quoteMeta: any, fallbackDisplayName: string) {
  // On veut TOUJOURS: "NOM Prénom" (même si PRO)
  const party = quoteMeta?.party ?? {};
  const ln = upperLastName(party?.lastName || "");
  const fn = normalizeSpaces(party?.firstName || "");

  const fromParty = normalizeSpaces([ln, fn].filter(Boolean).join(" "));
  if (fromParty) return fromParty;

  // fallback (au cas où): on tente de nettoyer displayName
  // ex displayName: "DUTRONC — Jean" ou "DUTRONC Jean"
  const s = normalizeSpaces(fallbackDisplayName);
  if (!s) return "Client";

  if (s.includes("—")) {
    const [a, b] = s.split("—").map((x) => normalizeSpaces(x));
    return normalizeSpaces([upperLastName(a), b].filter(Boolean).join(" "));
  }

  // sinon on renvoie tel quel
  return s;
}

// ✅ AJOUT
function pickCompanyNameIfPro(quoteMeta: any, fallbackDisplayName: string) {
  const party = quoteMeta?.party ?? {};
  const isPro = Boolean(party?.isProfessional);
  if (!isPro) return "";

  const soc = normalizeSpaces(party?.societe || "");
  if (soc) return soc;

  // fallback: le displayName client côté CRM (souvent la société pour un PRO)
  return normalizeSpaces(fallbackDisplayName);
}

// ✅ REMPLACE buildPosterLines par bloc aligné
type PosterParsed = {
  ref: string;
  jp: string;
  fr: string;
  format: string;
  qty: number;
};

function parsePosterLabel(labelRaw: string) {
  const label = normalizeSpaces(labelRaw);

  // On garde uniquement les lignes "poster"
  if (!/poster/i.test(label)) return null;

  // ref: "R-000123" (tolérant)
  const refMatch =
    label.match(/\bR-\d{3,}\b/i) || label.match(/Poster\s+([A-Za-z0-9-]+)\b/i);
  const ref = normalizeSpaces(
    refMatch?.[0]?.toUpperCase().replace(/^POSTER\s+/i, "") || ""
  );

  // format
  let format = "";
  const fmtMatch =
    label.match(/\bA2\b/i) ||
    label.match(/\bA3\b/i) ||
    label.match(/\b30\s*[x×]\s*40\b/i) ||
    label.match(/\b30×40\b/i);

  if (fmtMatch) {
    format = normalizeSpaces(fmtMatch[0].toUpperCase().replace(/\s*/g, ""));
    // harmonise "30X40" -> "30×40"
    format = format.replace("30X40", "30×40");
  }

  // noms JP / FR : on cherche "… / …"
  // ex: "静かな翼 / Shizuka no Tsubasa"
  let jp = "";
  let fr = "";

  const slash = label
    .split("/")
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);
  if (slash.length >= 2) {
    jp = slash[0].replace(/^Poster\s+/i, "").replace(ref, "").trim();
    fr = slash.slice(1).join(" / ").trim();
  }

  jp = normalizeSpaces(jp);
  fr = normalizeSpaces(fr);

  return { ref, jp, fr, format };
}

function buildPosterBlock(items: { label: string; qty: number }[]) {
  const posters: PosterParsed[] = [];

  for (const it of items) {
    const label = String(it.label || "");
    const qty = Number(it.qty || 0);
    const parsed = parsePosterLabel(label);
    if (!parsed) continue;

    posters.push({
      ref: parsed.ref || "—",
      jp: parsed.jp || "—",
      fr: parsed.fr || "—",
      format: parsed.format || "—",
      qty: qty > 0 ? qty : 0,
    });
  }

  if (posters.length === 0) {
    return {
      textLines: ["(Aucun poster détecté dans la facture)"],
      html: `<div>(Aucun poster détecté dans la facture)</div>`,
    };
  }

  // bloc aligné (monospace)
  const refW = Math.max(6, ...posters.map((p) => p.ref.length));
  const fmtW = Math.max(2, ...posters.map((p) => p.format.length));
  const qtyW = Math.max(1, ...posters.map((p) => String(p.qty).length));

  const lines = posters.map((p) => {
    const ref = p.ref.padEnd(refW, " ");
    const name = `${p.jp} / ${p.fr}`;
    const fmt = p.format.padEnd(fmtW, " ");
    const qty = String(p.qty).padStart(qtyW, " ");
    return `${ref}  ${fmt}  x${qty}  ${name}`;
  });

  const html = `<pre style="margin:8px 0;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:1.45;white-space:pre-wrap">${lines
    .map((l) => l.replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("\n")}</pre>`;

  return { textLines: lines, html };
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

  const secure =
    String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true"
      ? true
      : port === 465;

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

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
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

    if (!inv)
      return NextResponse.json({ error: "Facture introuvable." }, { status: 404 });

    // On ne permet l’envoi que si facture émise
    const status = String((inv as any).status || "");
    if (status !== "ISSUED") {
      return NextResponse.json(
        { error: "La facture doit être en statut ISSUED pour être envoyée." },
        { status: 400 }
      );
    }

    const issuedAt = (inv as any).issuedAt ?? null;

    const toEmail =
      String((inv as any).client?.email || "").trim() ||
      String((inv as any).quote?.clientEmail || "").trim();

    if (!toEmail) {
      return NextResponse.json(
        { error: "Email client manquant (fiche client / snapshot devis)." },
        { status: 400 }
      );
    }

    const invoiceNumber =
      String((inv as any).number || "").trim() || "FACTURE";
    const quoteNumber = String((inv as any).quote?.number || "").trim();
    const quoteId = (inv as any).quote?.id || null;

    // ✅ Meta facture + meta devis (source unique de vérité)
    const invMeta = safeJson<any>((inv as any).metaJson) || {};
    const fromQuoteMeta = safeJson<any>(invMeta?.fromQuoteMetaJson) || {};
    const quoteMetaDirect = safeJson<any>((inv as any).quote?.metaJson) || {};

    // on fusionne (direct > fromQuote)
    const quoteMeta = { ...fromQuoteMeta, ...quoteMetaDirect };

    // PRO ?
    const isPro = Boolean(quoteMeta?.party?.isProfessional);

    // Nom à afficher dans "Bonjour ...": NOM Prénom (même si PRO)
    const clientPersonName = pickClientPersonName(
      quoteMeta,
      String((inv as any).client?.displayName || "")
    );

    // Société (uniquement dans phrase de remerciement)
    const companyName = pickCompanyNameIfPro(
      quoteMeta,
      String((inv as any).client?.displayName || "")
    );

    // Date livraison (reprend même source que la facture : meta devis embarquée)
    const deliveryDate = normalizeSpaces(
      quoteMeta?.delivery?.date || quoteMeta?.deliveryDate || ""
    );

    // Paiement
    const deferredPayment = Boolean(quoteMeta?.posters?.deferredPayment);

    // Dates limites (on essaye plusieurs clés possibles + fallback dueAt)
    const dueAt = (inv as any).dueAt ?? null;

    // comptant: date limite totale
    const payTotalUntil =
      quoteMeta?.posters?.payTotalUntil ||
      quoteMeta?.posters?.totalUntil ||
      quoteMeta?.posters?.dueTotalUntil ||
      dueAt ||
      null;

    // différé: dates acompte + restant
    const payDepositUntil =
      quoteMeta?.posters?.payDepositUntil ||
      quoteMeta?.posters?.depositUntil ||
      quoteMeta?.posters?.dueDepositUntil ||
      (inv as any).depositDueAt ||
      null;

    const payBalanceUntil =
      quoteMeta?.posters?.payBalanceUntil ||
      quoteMeta?.posters?.balanceUntil ||
      quoteMeta?.posters?.dueBalanceUntil ||
      (inv as any).balanceDueAt ||
      dueAt ||
      null;

    // PDF buffers via tes routes exports (on réutilise tes générateurs existants)
    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    // facture PDF
    const invPdfResp = await fetch(
      `${origin}/api/exports/invoices/${encodeURIComponent(invoiceId)}/pdf`,
      {
        headers: cookie ? { cookie } : undefined,
        cache: "no-store",
      }
    );
    if (!invPdfResp.ok) {
      const t = await invPdfResp.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Impossible de générer/charger le PDF de facture.",
          details: t.slice(0, 500),
        },
        { status: 500 }
      );
    }
    const invoicePdf = Buffer.from(await invPdfResp.arrayBuffer());

    // devis PDF (si lié)
    let quotePdf: Buffer | null = null;
    if (quoteId) {
      const qPdfResp = await fetch(
        `${origin}/api/exports/quotes/${encodeURIComponent(quoteId)}/pdf`,
        {
          headers: cookie ? { cookie } : undefined,
          cache: "no-store",
        }
      );
      if (qPdfResp.ok) {
        quotePdf = Buffer.from(await qPdfResp.arrayBuffer());
      }
    }

    // ✅ Posters (bloc aligné)
    const posters = buildPosterBlock(
      (inv as any).items?.map((it: any) => ({
        label: it.label,
        qty: Number(it.qty || 0),
      })) ?? []
    );

    // Montants
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

    const helloLine = `Bonjour Madame, Monsieur, ${clientPersonName},`;

    const thanksLine =
      isPro && companyName
        ? `Nous remercions sincèrement votre entreprise ${companyName} pour sa commande de posters.`
        : `Nous vous remercions sincèrement pour votre commande de posters.`;

    const paymentLineText = deferredPayment
      ? `Mode de paiement : Virement bancaire / Délai de paiement acompte autorisé jusqu'au ${fmtDateFRShort(
          payDepositUntil
        )} / Délai de paiement restant autorisé jusqu'au ${fmtDateFRShort(
          payBalanceUntil
        )}`
      : `Mode de paiement : Virement bancaire / Délai de paiement total autorisé jusqu'au ${fmtDateFRShort(
          payTotalUntil
        )}`;

    const bodyText = [
      helloLine,
      ``,
      thanksLine,
      ``,
      `Nous vous confirmons avoir bien reçu votre demande et nous avons le plaisir de vous envoyer, en pièces jointes, les documents relatifs à votre commande.`,
      ``,
      quoteNumber
        ? `Le devis signé daté du ${fmtDateFR(
            (inv as any).quote?.updatedAt ?? (inv as any).quote?.createdAt
          )}`
        : `Le devis (pièce jointe)`,
      ``,
      `La facture correspondant à votre commande, pour un montant total de ${centsToEurosStr(
        totalHT
      )} €`,
      ``,
      `Les références des posters commandés :`,
      ``,
      ...posters.textLines,
      ``,
      `Détails importants concernant votre commande :`,
      `Date de livraison estimée : ${deliveryDate || "—"}`,
      `Montant total de la commande : ${centsToEurosStr(totalHT)} €`,
      ``,
      paymentLineText,
      ``,
      `Cordialement,`,
      `Xavier CUZIN`,
      `SEIKAN GALLERY`,
      `seikan.gallery@gmail.com`,
      `06.10.38.02.08`,
      ``,
    ].join("\n");

    // HTML (pour gras + bloc aligné)
    const paymentLineHtml = deferredPayment
      ? `Mode de paiement : Virement bancaire / Délai de paiement <strong>acompte</strong> autorisé jusqu'au ${fmtDateFRShort(
          payDepositUntil
        )} / Délai de paiement <strong>restant</strong> autorisé jusqu'au ${fmtDateFRShort(
          payBalanceUntil
        )}`
      : `Mode de paiement : Virement bancaire / Délai de paiement total autorisé jusqu'au ${fmtDateFRShort(
          payTotalUntil
        )}`;

    const bodyHtml = `
  <div style="font-family: Arial, Helvetica, sans-serif; font-size:14px; color:#111;">
    <div>${helloLine}</div>
    <br/>
    <div>${thanksLine}</div>
    <br/>
    <div>Nous vous confirmons avoir bien reçu votre demande et nous avons le plaisir de vous envoyer, en pièces jointes, les documents relatifs à votre commande.</div>
    <br/>
    <div>${
      quoteNumber
        ? `Le devis signé daté du ${fmtDateFR(
            (inv as any).quote?.updatedAt ?? (inv as any).quote?.createdAt
          )}`
        : `Le devis (pièce jointe)`
    }</div>
    <br/>
    <div>La facture correspondant à votre commande, pour un montant total de <strong>${centsToEurosStr(
      totalHT
    )} €</strong></div>
    <br/>
    <div><strong>Les références des posters commandés :</strong></div>
    ${posters.html}
    <div><strong>Détails importants concernant votre commande :</strong></div>
    <div>Date de livraison estimée : ${deliveryDate || "—"}</div>
    <div>Montant total de la commande : ${centsToEurosStr(totalHT)} €</div>
    <br/>
    <div>${paymentLineHtml}</div>
    <br/>
    <div>Cordialement,</div>
    <div><strong>Xavier CUZIN</strong></div>
    <div>SEIKAN GALLERY</div>
    <div>seikan.gallery@gmail.com</div>
    <div>06.10.38.02.08</div>
  </div>
`;

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
      html: bodyHtml,
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
