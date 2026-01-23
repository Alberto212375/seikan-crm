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

  // ✅ On détecte un poster via sa référence (R-XXXXXX), PAS via le mot "poster"
  const refM = label.match(/\bR-\d{3,}\b/i);
  if (!refM) return null;

  const ref = normalizeSpaces(refM[0].toUpperCase());

  // ✅ format (A2/A3/30×40)
  let format = "";
  const fmtMatch =
    label.match(/\bA2\b/i) ||
    label.match(/\bA3\b/i) ||
    label.match(/\b30\s*[x×]\s*40\b/i) ||
    label.match(/\b30×40\b/i);

  if (fmtMatch) {
    format = normalizeSpaces(fmtMatch[0].toUpperCase().replace(/\s*/g, ""));
    format = format.replace("30X40", "30×40");
  }

  // ✅ noms JP/FR : on cherche "JP / FR"
  // (on reste robuste : si pas de "/", on met tout en FR)
  let jp = "";
  let fr = "";

  // On enlève d’abord la ref et le format pour isoler le "nom"
  let rest = label;
  rest = rest.replace(refM[0], " ");
  if (fmtMatch?.[0]) rest = rest.replace(fmtMatch[0], " ");
  rest = normalizeSpaces(rest);

  // 1) si jamais tu as "JP / FR" -> on garde
const partsSlash = rest.split("/").map((x) => normalizeSpaces(x)).filter(Boolean);
if (partsSlash.length >= 2) {
  jp = partsSlash[0];
  fr = partsSlash.slice(1).join(" / ");
} else {
  // 2) ton format réel : "NomLatin — TraductionFR"
  const partsDash = rest.split("—").map((x) => normalizeSpaces(x)).filter(Boolean);
  if (partsDash.length >= 2) {
    jp = partsDash[0]; // Nom latin
    fr = partsDash.slice(1).join(" — "); // Traduction FR (ou reste)
  } else {
    fr = rest || "";
  }
}

  jp = normalizeSpaces(jp);
  fr = normalizeSpaces(fr);

  return { ref, jp, fr, format };
}

function escHtml(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPosterBlock(items: { label: string; qty: number }[]) {
  const posters: PosterParsed[] = [];

  for (const it of items) {
    const parsed = parsePosterLabel(String(it.label || ""));
    if (!parsed) continue;

    posters.push({
      ref: parsed.ref || "—",
      jp: parsed.jp || "—",
      fr: parsed.fr || "—",
      format: parsed.format || "—",
      qty: Math.max(0, Number(it.qty || 0)),
    });
  }

  if (posters.length === 0) {
    return {
      textLines: ["(Aucun poster détecté dans la facture)"],
      html: `<div>(Aucun poster détecté dans la facture)</div>`,
    };
  }

  // tri stable : ref puis format
  posters.sort((a, b) => (a.ref + a.format).localeCompare(b.ref + b.format));

  // ✅ TEXT : tableau lisible (monospace)
  const refW = Math.max(7, ...posters.map((p) => p.ref.length));
  const fmtW = Math.max(4, ...posters.map((p) => p.format.length));
  const qtyW = Math.max(3, ...posters.map((p) => String(p.qty).length));

  const header = `${"Réf".padEnd(refW)}  ${"Fmt".padEnd(fmtW)}  ${"Qté".padStart(qtyW)}  Nom JP / Nom FR`;
  const sep = `${"".padEnd(refW, "-")}  ${"".padEnd(fmtW, "-")}  ${"".padEnd(qtyW, "-")}  ------------------`;

  const lines = [
    header,
    sep,
    ...posters.map((p) => {
      const name = `${p.jp || "—"} / ${p.fr || "—"}`;
      return `${p.ref.padEnd(refW)}  ${p.format.padEnd(fmtW)}  ${String(p.qty).padStart(qtyW)}  ${name}`;
    }),
  ];

  // ✅ HTML : vrai tableau (ce que tu demandes)
  const rowsHtml = posters
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;white-space:nowrap;">${escHtml(p.ref)}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;white-space:nowrap;">${escHtml(p.format)}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;white-space:nowrap;">${escHtml(p.qty)}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;">${escHtml(p.jp)}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;">${escHtml(p.fr)}</td>
      </tr>
    `
    )
    .join("");

  const html = `
    <table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px;">
      <thead>
        <tr>
          <th style="padding:8px 10px;border:1px solid #e5e7eb;background:#fafafa;text-align:left;">Référence</th>
          <th style="padding:8px 10px;border:1px solid #e5e7eb;background:#fafafa;text-align:left;">Format</th>
          <th style="padding:8px 10px;border:1px solid #e5e7eb;background:#fafafa;text-align:right;">Quantité</th>
          <th style="padding:8px 10px;border:1px solid #e5e7eb;background:#fafafa;text-align:left;">Nom (JP)</th>
          <th style="padding:8px 10px;border:1px solid #e5e7eb;background:#fafafa;text-align:left;">Nom (FR)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

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

function addDays(d: Date | string | null | undefined, days: number) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  const out = new Date(dt.getTime());
  out.setDate(out.getDate() + days);
  return out;
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
  quoteMeta?.delivery?.address ||
    quoteMeta?.posters?.deliveryWindowLabel ||
    quoteMeta?.posters?.delivery?.address ||
    quoteMeta?.shipping?.deliveryWindowLabel ||
    ""
);

    // Paiement
    const deferredPayment = Boolean(quoteMeta?.posters?.deferredPayment);

    // Dates limites (source de vérité : clôture + signature)
const dueAt = (inv as any).dueAt ?? null;

// helpers dates (local)
function parseIsoDateOnlyLocal(s: any): Date | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDaysLocal(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

const baseDate: Date | null = (() => {
  const d = (inv as any).issuedAt ?? (inv as any).createdAt ?? null;
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? null : dt;
})();

// source de vérité chez toi : clôture + signature
const closingDateIso = quoteMeta?.posters?.closingDate || "";
const closingDate = parseIsoDateOnlyLocal(closingDateIso);

const signedAt = (() => {
  const s = quoteMeta?.signature?.signedAt;
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
})();

// “avant le” = clôture - 2 jours
const payBefore = closingDate ? addDaysLocal(closingDate, -2) : null;

// solde = (signature si dispo sinon baseDate) + 30 jours
const balanceBase = signedAt || baseDate;
const balanceDue = balanceBase ? addDaysLocal(balanceBase, 30) : null;

// comptant: total avant clôture-2 (sinon fallback)
const payTotalUntil = payBefore || (baseDate ? addDaysLocal(baseDate, 7) : dueAt || null);

// différé: acompte avant clôture-2, solde avant balanceDue (sinon fallback)
const payDepositUntil = payBefore || (baseDate ? addDaysLocal(baseDate, 7) : null);
const payBalanceUntil = balanceDue || dueAt || (baseDate ? addDaysLocal(baseDate, 30) : null);


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

// ✅ Salutation sur 2 lignes comme tu veux
const helloHtml = `Bonjour Madame, Monsieur,<br/><strong>${escHtml(clientPersonName)}</strong>,`;
const helloText = `Bonjour Madame, Monsieur,\n${clientPersonName},`;

// ✅ Phrase merci (on garde ta logique PRO / non PRO)
const thanksLine =
  isPro && companyName
    ? `Nous vous remercions sincèrement pour votre commande de posters passée auprès de notre entreprise ${companyName}.`
    : `Nous vous remercions sincèrement pour votre commande de posters.`;

// ✅ Lignes paiement séparées (au lieu d’un seul bloc “/”)
const paymentModeText = `Mode de paiement : Virement bancaire`;

const paymentDeadlineText = deferredPayment
  ? `Délai de paiement acompte autorisé jusqu'au ${fmtDateFRShort(payDepositUntil)}\nDélai de paiement restant autorisé jusqu'au ${fmtDateFRShort(payBalanceUntil)}`
  : `Délai de paiement total autorisé jusqu'au ${fmtDateFRShort(payTotalUntil)}`;

const paymentModeHtml = `<strong>Mode de paiement :</strong> <strong>Virement bancaire</strong>`;
const paymentDeadlineHtml = deferredPayment
  ? `<strong>Délai de paiement acompte autorisé</strong> jusqu'au <strong>${fmtDateFRShort(
      payDepositUntil
    )}</strong><br/><strong>Délai de paiement restant autorisé</strong> jusqu'au <strong>${fmtDateFRShort(
      payBalanceUntil
    )}</strong>`
  : `<strong>Délai de paiement total autorisé</strong> jusqu'au <strong>${fmtDateFRShort(
      payTotalUntil
    )}</strong>`;

// ✅ Texte “Documents joints” structuré
const quoteDocText = quoteNumber
  ? `• Le devis signé daté du ${fmtDateFR((inv as any).quote?.updatedAt ?? (inv as any).quote?.createdAt)}`
  : `• Le devis (pièce jointe)`;

const quoteDocHtml = quoteNumber
  ? `<li><strong>Le devis signé</strong> daté du <strong>${fmtDateFR(
      (inv as any).quote?.updatedAt ?? (inv as any).quote?.createdAt
    )}</strong></li>`
  : `<li><strong>Le devis</strong> (pièce jointe)</li>`;

const invoiceDocText = `• La facture correspondant à votre commande, pour un montant total de ${centsToEurosStr(
  totalHT
)} €`;

const invoiceDocHtml = `<li><strong>La facture</strong> correspondant à votre commande, pour un montant total de <strong>${centsToEurosStr(
  totalHT
)} €</strong></li>`;

// ✅ Détails : bullet list, avec mots en gras en HTML
const deliveryLabel = deliveryDate || "—";

const bodyText = [
  helloText,
  ``,
  thanksLine,
  ``,
  `Nous vous confirmons avoir bien reçu votre demande et avons le plaisir de vous envoyer, en pièces jointes, les documents relatifs à votre commande :`,
  ``,
  `Documents joints :`,
  quoteDocText,
  invoiceDocText,
  ``,
  `Les références des posters commandés :`,
  ``,
  ...posters.textLines,
  ``,
  `Détails importants concernant votre commande :`,
  `• Date de livraison estimée : ${deliveryLabel}`,
  `• Montant total de la commande : ${centsToEurosStr(totalHT)} €`,
  `• ${paymentModeText}`,
  `• ${paymentDeadlineText.replace(/\n/g, "\n• ")}`,
  ``,
  `Nous restons à votre entière disposition pour toute question ou information complémentaire. N'hésitez pas à nous contacter si vous avez besoin de précisions sur votre commande ou sur les modalités de paiement.`,
  ``,
  `Nous vous souhaitons une excellente journée et à très bientôt pour la livraison de vos posters.`,
  ``,
  `Cordialement,`,
  `Xavier CUZIN`,
  `SEIKAN GALLERY`,
  `seikan.gallery@gmail.com`,
  `06.10.38.02.08`,
  ``,
].join("\n");

// ✅ HTML : structure propre + listes + titres en gras + tableau “classe”
const bodyHtml = `
<div style="font-family: Arial, Helvetica, sans-serif; font-size:14px; color:#111; line-height:1.55;">
  <div>${helloHtml}</div>

  <div style="height:14px;"></div>

  <div>${escHtml(thanksLine)}</div>

  <div style="height:14px;"></div>

  <div>Nous vous confirmons avoir bien reçu votre demande et avons le plaisir de vous envoyer, en pièces jointes, les documents relatifs à votre commande :</div>

  <div style="height:12px;"></div>

  <div><strong>Documents joints :</strong></div>
  <ul style="margin:8px 0 0 18px; padding:0;">
    ${quoteDocHtml}
    ${invoiceDocHtml}
  </ul>

  <div style="height:16px;"></div>

  <div><strong>Les références des posters commandés :</strong></div>

  <div style="height:8px;"></div>

  <div style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
    <div style="padding:10px 12px; background:#fafafa; border-bottom:1px solid #e5e7eb;">
      <div style="font-size:12px; color:#374151;">Détail des articles</div>
    </div>
    <div style="padding:10px 12px;">
      ${posters.html}
    </div>
  </div>

  <div style="height:18px;"></div>

  <div><strong>Détails importants concernant votre commande :</strong></div>
  <ul style="margin:8px 0 0 18px; padding:0;">
    <li><strong>Date de livraison estimée</strong> : <strong>${escHtml(deliveryLabel)}</strong></li>
    <li><strong>Montant total de la commande :</strong> <strong>${escHtml(
      centsToEurosStr(totalHT)
    )} €</strong></li>
    <li>${paymentModeHtml}</li>
    <li>${paymentDeadlineHtml}</li>
  </ul>

  <div style="height:16px;"></div>

  <div>Nous restons à votre entière disposition pour toute question ou information complémentaire. N&apos;hésitez pas à nous contacter si vous avez besoin de précisions sur votre commande ou sur les modalités de paiement.</div>

  <div style="height:16px;"></div>

  <div>Nous vous souhaitons une excellente journée et à très bientôt pour la livraison de vos posters.</div>

  <div style="height:18px;"></div>

  <div>Cordialement,</div>
  <div>Xavier CUZIN</div>
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
