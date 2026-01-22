// src/app/api/exports/invoices/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfkitMod = require("pdfkit");
const PdfDoc = pdfkitMod?.default ?? pdfkitMod;

type InvoiceMeta = {
  fromQuoteMetaJson?: string | null;
};

type QuoteMeta = {
  discountAppliedPct?: number;
  delivery?: { address?: string; date?: string };

  party?: {
    isProfessional?: boolean;
    lastName?: string;
    firstName?: string;
    societe?: string;
    service?: string;
    siret?: string;
  };

  posters?: {
    firstOrder?: boolean;
    vatExempt?: boolean;

    // ✅ persisté par /api/quotes
    deferredPayment?: boolean;

    closingDate?: string;
    deliveryWindowLabel?: string;
    discountAppliedPct?: number;
    francoThreshold?: number;
    francoCost?: number;
  };
};

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function toInt(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function euros(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + (abs / 100).toFixed(2).replace(".", ",") + " €";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDateFRShort(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function tryParseDate(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const s = String(input).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseIsoDateOnly(s: string): Date | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function addBusinessDays(date: Date, days: number) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 dimanche, 6 samedi
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function formatDateFRLong(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// ✅ échéance = 28 du mois de livraison (même règle que devis)
function computeDueDate28FromClosure(closingDateIso: string | undefined | null): Date | null {
  const closing = closingDateIso ? parseIsoDateOnly(closingDateIso) : null;
  if (!closing) return null;
  const deliveryTo = addBusinessDays(closing, 10);
  return new Date(deliveryTo.getFullYear(), deliveryTo.getMonth(), 28);
}

function extractFormatAndCleanLabel(input: string): { cleanLabel: string; format: string } {
  const s = String(input ?? "").trim();

  const paren = s.match(/\(\s*(30\s*[x×*]\s*40|A3|A2)\s*\)\s*$/i);
  const bare = s.match(/\s+(30\s*[x×*]\s*40|A3|A2)\s*$/i);

  const m = paren ?? bare;
  if (!m) return { cleanLabel: s, format: "—" };

  let fmt = String(m[1] ?? "").toUpperCase().trim();
  if (fmt.startsWith("30")) fmt = "30*40";

  let cleanLabel = s.replace(m[0], "").trim();
  cleanLabel = cleanLabel.replace(/[-–—]\s*$/g, "").trim();

  return { cleanLabel, format: fmt || "—" };
}

/** Fond + liseré + dentelle (identique devis) */
function drawBackgroundAndLace(doc: any, pageW: number, pageH: number) {
  const bg = "#F9F9FA";
  const lace = "#FFFFFF";

  doc.save();
  doc.rect(0, 0, pageW, pageH).fill(bg);
  doc.restore();

  const inset = 16;
  doc.save();
  doc.lineWidth(1.2);
  doc.strokeColor(lace);
  doc.rect(inset, inset, pageW - inset * 2, pageH - inset * 2).stroke();
  doc.restore();

  const r = 3.2;
  const step = 10;

  doc.save();
  doc.lineWidth(0.9);
  doc.strokeColor(lace);

  for (let x = inset + r; x <= pageW - inset - r; x += step) doc.circle(x, inset, r).stroke();
  for (let x = inset + r; x <= pageW - inset - r; x += step) doc.circle(x, pageH - inset, r).stroke();
  for (let y = inset + r; y <= pageH - inset - r; y += step) doc.circle(inset, y, r).stroke();
  for (let y = inset + r; y <= pageH - inset - r; y += step) doc.circle(pageW - inset, y, r).stroke();

  doc.restore();
}

// ✅ Lecture robuste des dimensions PNG (identique devis)
function readPngSize(filePath: string): { w: number; h: number } | null {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 24) return null;
    const sig = buf.slice(0, 8);
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!sig.equals(pngSig)) return null;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
  } catch {
    return null;
  }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { items: true, quote: true },
  });

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const invMeta = safeJsonParse<InvoiceMeta>((invoice as any).metaJson) ?? {};
  const quoteMetaJson = invMeta.fromQuoteMetaJson ?? (invoice as any).quote?.metaJson ?? null;
  const meta = safeJsonParse<QuoteMeta>(quoteMetaJson) ?? {};
  const postersMeta = meta.posters ?? {};

  // Items triés + extraction Format (colonne dédiée)
  const rawItems = (invoice.items ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((it: any) => {
      const original = String(it.label ?? "");
      const { cleanLabel, format } = extractFormatAndCleanLabel(original);
      const qty = Math.max(0, Number(it.qty ?? 0));
      const unit = Math.max(0, Number(it.unitPrice ?? 0)); // cents
      return { label: cleanLabel, format, qty, unit };
    });

  // Totaux HT
  type RawItem = { qty: number; unit: number };
const totalHT = (rawItems as RawItem[]).reduce((s, it) => s + Math.round(it.qty * it.unit), 0);

  // TVA affichage (même règle devis) : par défaut exempt => pas de TVA ; si vatExempt=false => 20%
  const vatExempt = postersMeta.vatExempt !== false;
  const totalTTC = vatExempt ? totalHT : Math.round(totalHT * 1.2);
  const vatAmount = totalTTC - totalHT;

  // Paiement différé (même logique devis) : meta.posters.deferredPayment OU fallback sur quote.depositPct si présent
  const quoteDepositPct = toInt(((invoice as any).quote as any)?.depositPct ?? 0, 0);
  const deferredPayment = Boolean(postersMeta.deferredPayment) || quoteDepositPct > 0;

  // Due date (28 du mois de livraison) si paiement différé
  const dueDate28 = deferredPayment ? computeDueDate28FromClosure(postersMeta.closingDate ?? null) : null;
  const dueDate28Str = dueDate28 ? formatDateFRLong(dueDate28) : "";

  // Date d’émission facture
  const issuedAt = tryParseDate((invoice as any).issuedAt ?? (invoice as any).createdAt ?? Date.now()) ?? new Date();
  const issuedAtStr = formatDateFRShort(issuedAt);

  // accompte / reste à payer (on conserve ta logique existante)
  const depositPaid = Boolean((invoice as any).depositPaid);
  const depositPaidAmountHT = Number((invoice as any).depositPaidAmount ?? 0) || 0; // supposé HT
  const restToPayHT = depositPaid ? Math.max(0, totalHT - depositPaidAmountHT) : totalHT;

  const depositPaidAmountTTC = vatExempt ? depositPaidAmountHT : Math.round(depositPaidAmountHT * 1.2);
  const restToPayTTC = vatExempt ? restToPayHT : totalTTC - depositPaidAmountTTC;

  // Police locale
  const fontPath = path.join(process.cwd(), "src", "assets", "fonts", "DejaVuSans.ttf");
  const fontBoldPath = path.join(process.cwd(), "src", "assets", "fonts", "DejaVuSans-Bold.ttf");

  const doc = new PdfDoc({
    size: "A4",
    margin: 50,
    autoFirstPage: false,
    font: null,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  if (fs.existsSync(fontPath)) {
    doc.registerFont("base", fontPath);
    doc.font("base");
  }
  if (fs.existsSync(fontBoldPath)) {
    doc.registerFont("baseBold", fontBoldPath);
  }

  // ✅ IMPORTANT : crée une 1ère page réelle immédiatement (évite pages fantômes avec heightOfString)
  doc.addPage({ size: "A4", margin: 50 });

  // Page metrics (A4)
  const pageW = 595.28;
  const pageH = 841.89;
  const left = 50;
  const right = 50;
  const usableW = pageW - left - right;

  // Footer fixe "dans la zone imprimable" (identique devis)
  const FOOTER_FONT_SIZE = 8;
  const footerY = pageH - 50 - 10; // 10 pts au-dessus de la marge basse
  const FOOTER_SAFE_TOP = footerY - 18;

  // IBAN/BIC
  const iban = "FR76 1213 5003 0004 2562 6218 853";
  const bic = "CEPAFRPP213";

  // Logo header (mêmes dimensions/positions devis)
  const logoPath = path.join(process.cwd(), "public", "hero-fromage.png");
  const logoW = Math.round(220 * 1.2);
  const logoX = left + (usableW - logoW) / 2;

  const MM = (mm: number) => (72 / 25.4) * mm;
  const TOP_EDGE_MM = 3;
  const LOGO_NUDGE_UP_PTS = 55;
  const logoY = MM(TOP_EDGE_MM) - LOGO_NUDGE_UP_PTS;

  let logoH = 90;
  if (fs.existsSync(logoPath)) {
    const sz = readPngSize(logoPath);
    if (sz) logoH = Math.round(logoW * (sz.h / sz.w));
    else logoH = Math.round(logoW * 0.35);
  }

  const titleY = logoY + logoH - 53;

  // Party / destinataire (mêmes règles devis)
  const party = meta.party ?? {};
  const isPro = Boolean(party.isProfessional);

  const recipientSocieteRaw = String(party.societe ?? (invoice as any).quote?.clientName ?? "").trim();
  const recipientSociete = isPro ? recipientSocieteRaw.toUpperCase() : recipientSocieteRaw;

  const recipientService = String(party.service ?? (invoice as any).quote?.clientService ?? "").trim();
  const recipientSiret = String(party.siret ?? "").trim();

  const recipientEmail = String((invoice as any).quote?.clientEmail ?? "").trim();
  const recipientPhone = String((invoice as any).quote?.clientPhone ?? "").trim();
  const recipientAddress = String((invoice as any).quote?.clientAddress ?? "").trim();

  // Émetteur (aligné sur le devis — SEIKAN)
  const issuerLines = [
    "SEIKAN GALLERY",
    "SIRET : 90051575000025",
    "seikan.gallery@gmail.com",
    "0610380208",
    "5 Rue de Normandie, 91210 Draveil",
  ].join("\n");

  // Destinataire (bloc en lignes)
  const destLines: string[] = [];
  if (isPro && recipientSiret) destLines.push(`${recipientSociete}  SIRET : ${recipientSiret}`);
  else destLines.push(`${recipientSociete}`);
  if (isPro && recipientService) destLines.push(`Service : ${recipientService}`);
  if (recipientEmail) destLines.push(recipientEmail);
  if (recipientPhone) destLines.push(recipientPhone);
  if (recipientAddress) destLines.push(recipientAddress);
  const destText = destLines.filter(Boolean).join("\n");

  // Colonnes tableau (ajout Format, identique devis)
  const colDesignationX = left;
  const colFormatW = 70;
  const colQtyW = 55;
  const colUnitW = 95;
  const colAmountW = 110;

  const colAmountX = left + usableW - colAmountW;
  const colUnitX = colAmountX - colUnitW;
  const colQtyX = colUnitX - colQtyW;
  const colFormatX = colQtyX - colFormatW;

  const colDesignationW = colFormatX - colDesignationX - 10;

  function drawFooter(pageIndex: number, totalPages: number) {
    doc.save();
    doc.font("base").fontSize(FOOTER_FONT_SIZE).fillColor("#111");

    const leftW = usableW / 2;
    const rightW = usableW / 2;

    doc.text("SEIKAN GALLERY", left, footerY, {
      width: leftW,
      align: "left",
      lineBreak: false,
      ellipsis: true,
    });

    doc.text(`Page ${pageIndex}/${totalPages}`, left + leftW, footerY, {
      width: rightW,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });

    doc.restore();
  }

  // ✅ drawPageBase (identique devis)
  let __pageBaseUsedOnce = false;
  function drawPageBase() {
    if (!__pageBaseUsedOnce) {
      __pageBaseUsedOnce = true;
      drawBackgroundAndLace(doc, pageW, pageH);
      return;
    }
    doc.addPage({ size: "A4", margin: 50 });
    drawBackgroundAndLace(doc, pageW, pageH);
  }

  function drawLogoAndTitle() {
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, logoX, logoY, { width: logoW });
    } else {
      doc.fontSize(18).fillColor("black").text("SEIKAN GALLERY", left, logoY + 20, { width: usableW, align: "center" });
    }
    doc.fontSize(16)
      .fillColor("black")
      .text(`FACTURE ${(invoice as any).number ?? ""}`, left, titleY, { width: usableW, align: "center" });
  }

  function drawTableHeader(y: number) {
    doc.fontSize(10).fillColor("black").text("Désignation", colDesignationX, y, { width: colDesignationW });
    doc.text("Format", colFormatX, y, { width: colFormatW, align: "left" });
    doc.text("Qté", colQtyX, y, { width: colQtyW, align: "right" });
    doc.text("PU HT", colUnitX, y, { width: colUnitW, align: "right" });
    doc.text("Montant HT", colAmountX, y, { width: colAmountW, align: "right" });

    y += 16;
    doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
    y += 8;
    return y;
  }

  function drawRowAt(
    y: number,
    fontSize: number,
    lineGap: number,
    label: string,
    format: string,
    qtyText: string,
    unitText: string,
    amountText: string
  ) {
    doc.fontSize(fontSize).fillColor("black").text(label, colDesignationX, y, { width: colDesignationW, lineGap });
    doc.text(format || "—", colFormatX, y, { width: colFormatW, align: "left" });
    if (qtyText) doc.text(qtyText, colQtyX, y, { width: colQtyW, align: "right" });
    if (unitText) doc.text(unitText, colUnitX, y, { width: colUnitW, align: "right" });
    if (amountText) doc.text(amountText, colAmountX, y, { width: colAmountW, align: "right" });

    const labelH = doc.heightOfString(label, { width: colDesignationW, lineGap });
    const rowH = Math.max(labelH, fontSize + 2);
    return rowH + 3;
  }

  function addTotalLineAt(y: number, label: string, valueCents: number, emph = false) {
    const totalsLabelW = 320;
    const totalsValueW = 110;
    const totalsX = left + (usableW - (totalsLabelW + totalsValueW)) / 2;

    const hasBold = fs.existsSync(fontBoldPath);
    const fontName = emph && hasBold ? "baseBold" : "base";

    doc.font(fontName).fontSize(10).fillColor("black").text(label, totalsX, y, { width: totalsLabelW, align: "left" });
    doc.font(fontName).text(euros(valueCents), totalsX + totalsLabelW, y, { width: totalsValueW, align: "right" });
    doc.font("base");

    return y + 14;
  }

  // Layout header (identique devis)
  const gap = 30;
  const colW = (usableW - gap) / 2;
  const leftColX = left;
  const rightColX = left + colW + gap;

  // Mesure hauteurs bloc émetteur/destinataire
  doc.fontSize(10);
  const issuerH = doc.heightOfString(issuerLines, { width: colW, lineGap: 2 });
  const destH = doc.heightOfString(destText, { width: colW, lineGap: 2 });

  const baseColsY = titleY + 28;
  let yAfterHeader = baseColsY + 16 + Math.max(issuerH, destH) + 18;
  const yTableStart = yAfterHeader + 58 + 12;

  // Text légal (très proche devis, harmonisé)
  const paiementHeader = deferredPayment
    ? `Paiement différé : solde à régler au plus tard le ${dueDate28Str || "28 du mois de livraison"} : Par virement bancaire`
    : "";

  const lateClause = deferredPayment
    ? `En cas de retard de paiement, des pénalités de retard sont dues, calculées à un taux égal à 3 fois le taux
d’intérêt légal en vigueur.`
    : `À défaut de règlement à réception (paiement comptant), l’exécution de la commande est suspendue jusqu’à encaissement
et la livraison pourra être reportée à la clôture de commande suivante.`;

  const legalTextBase = `${paiementHeader ? paiementHeader + "\n" : ""}IBAN : ${iban}
BIC : ${bic}

${lateClause}
Une indemnité forfaitaire de 40 € pour frais de recouvrement sera également exigible (articles L.441-10
et D.441-5 du Code de commerce).
Mentions légales :
- TVA non applicable, art. 293 B du CGI`;

  function drawFullHeader(): { yAfterHeader: number } {
    drawLogoAndTitle();

    doc.fontSize(11).fillColor("black").text("Émetteur :", leftColX, baseColsY);
    doc.fontSize(10).fillColor("black").text(issuerLines, leftColX, baseColsY + 16, { width: colW });

    doc.fontSize(11).fillColor("black").text("Destinataire :", rightColX, baseColsY, { width: colW });
    doc.fontSize(10).fillColor("black").text(destText, rightColX, baseColsY + 16, { width: colW });

    doc.fontSize(10);
    const issuerH2 = doc.heightOfString(issuerLines, { width: colW, lineGap: 2 });
    const destH2 = doc.heightOfString(destText, { width: colW, lineGap: 2 });
    let yAfterHeader2 = baseColsY + 16 + Math.max(issuerH2, destH2) + 18;

    doc.fontSize(11).fillColor("black").text("Livraison :", leftColX, yAfterHeader2, { width: colW });

    let deliveryRaw = String(meta.delivery?.address ?? postersMeta.deliveryWindowLabel ?? "").trim() || "—";
    deliveryRaw = deliveryRaw.replace(/^Livraison prévue\s*:\s*/i, "");
    deliveryRaw = deliveryRaw.replace(/^Livraison prévue entre le\s+/i, "Entre le ");
    deliveryRaw = deliveryRaw.replace(/^Livraison prévue entre\s+/i, "Entre ");
    const deliveryOneLine = deliveryRaw || "—";

    doc.fontSize(10).fillColor("black").text(deliveryOneLine, leftColX, yAfterHeader2 + 16, {
      width: colW,
      lineBreak: false,
      ellipsis: true,
    });

    doc.fontSize(10).fillColor("black").text(`Date d'émission : ${issuedAtStr}`, rightColX, yAfterHeader2, { width: colW });

    yAfterHeader2 += 58;
    return { yAfterHeader: yAfterHeader2 };
  }

  function drawTableContinuationHeader() {
    doc.fontSize(14).fillColor("black").text(`FACTURE ${(invoice as any).number ?? ""}`, left, 70, { width: usableW, align: "center" });
  }

  function measureRowsHeight(fontSize: number, lineGap: number) {
    let h = 0;
    doc.fontSize(fontSize);
    for (const it of rawItems) {
      const label = String(it.label ?? "");
      const labelH = doc.heightOfString(label, { width: colDesignationW, lineGap });
      const rowH = Math.max(labelH, fontSize + 2);
      h += rowH + 3;
    }
    return h;
  }

  // On essaie de faire tenir en 1 page comme devis (sinon split)
  const TABLE_FONT_MAX = 9.5;
  const TABLE_FONT_MIN = 7.2;

  const totalsReserve = 140; // un peu plus : total + accompte + reste
  doc.fontSize(8);
  const legalBaseH = doc.heightOfString(legalTextBase, { width: usableW, lineGap: 2 });

  const availableForTableIfSingle = (FOOTER_SAFE_TOP - 6) - (yTableStart + 16 + 8) - totalsReserve - legalBaseH;

  let singlePagePossible = false;
  let singleTableFont = TABLE_FONT_MAX;
  let singleTableLineGap = 1;

  for (let f = TABLE_FONT_MAX; f >= TABLE_FONT_MIN; f -= 0.3) {
    const lg = f < 8.4 ? 0.5 : 1;
    const tableH = measureRowsHeight(f, lg);
    if (tableH <= availableForTableIfSingle) {
      singlePagePossible = true;
      singleTableFont = Number(f.toFixed(1));
      singleTableLineGap = lg;
      break;
    }
  }

  // =========================
  // MODE A : 1 PAGE
  // =========================
  if (singlePagePossible) {
    drawPageBase();
    const { yAfterHeader: yH } = drawFullHeader();

    // TABLE
    let y = yH + 12;
    y = drawTableHeader(y);

    for (const it of rawItems) {
      const amount = Math.round(it.qty * it.unit);
      y += drawRowAt(
        y,
        singleTableFont,
        singleTableLineGap,
        it.label,
        it.format ?? "—",
        String(it.qty),
        euros(it.unit),
        euros(amount)
      );
    }

    y += 4;
    doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
    y += 10;

    // TOTAUX (comme devis)
    y = addTotalLineAt(y, "TOTAL HT", totalHT);
    if (!vatExempt) y = addTotalLineAt(y, "TVA (20%)", vatAmount);
    y = addTotalLineAt(y, "TOTAL TTC", totalTTC);

    y += 6;

    // accompte / reste (facture) : UNIQUEMENT si paiement différé
if (deferredPayment) {
  y = addTotalLineAt(
    y,
    depositPaid ? "accompte versées (TTC)" : "Accompte non versées (TTC)",
    depositPaid ? depositPaidAmountTTC : 0,
    true
  );
  y = addTotalLineAt(y, "Reste à payer (TTC)", restToPayTTC, true);
} else {
  // Paiement comptant : pas d'accompte à afficher
  y = addTotalLineAt(y, "Montant à payer (TTC)", totalTTC, true);
}

y += 10;

    // LEGAL shrink pour tenir avant footer
    const legalBottomY = FOOTER_SAFE_TOP - 6;
    let legalFont = 8;
    let legalLineGap = 2;

    while (legalFont >= 6.8) {
      doc.fontSize(legalFont);
      const h = doc.heightOfString(legalTextBase, { width: usableW, lineGap: legalLineGap });
      if (y + h <= legalBottomY) break;
      legalFont -= 0.2;
      if (legalFont < 7.4) legalLineGap = 1.5;
    }

    doc.fontSize(legalFont).fillColor("#111").text(legalTextBase, left, y, {
      width: usableW,
      lineGap: legalLineGap,
      align: "left",
    });

    drawFooter(1, 1);

    doc.end();
    const pdfBuffer = await done;
    const body = new Uint8Array(pdfBuffer);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Facture_${(invoice as any).number ?? "FACTURE"}.pdf"`,
      },
    });
  }

  // =========================
  // MODE B : SPLIT multi-pages (comme devis)
  // =========================

  const splitTableFont = 9.2;
  const splitLineGap = 1;

  type PageDraw = () => void;
  const pages: PageDraw[] = [];

  function buildTablePage(opts: { first: boolean; items: typeof rawItems; isLastTablePage: boolean }) {
    return () => {
      drawPageBase();

      let yStart = 0;
      if (opts.first) {
        const { yAfterHeader: yH } = drawFullHeader();
        yStart = yH + 12;
      } else {
        drawTableContinuationHeader();
        yStart = 100;
      }

      let y = drawTableHeader(yStart);

      for (const it of opts.items) {
        const amount = Math.round(it.qty * it.unit);
        y += drawRowAt(
          y,
          splitTableFont,
          splitLineGap,
          it.label,
          it.format ?? "—",
          String(it.qty),
          euros(it.unit),
          euros(amount)
        );
      }

      if (opts.isLastTablePage) {
        y += 4;
        doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
      }
    };
  }

  function paginateTable() {
    const chunks: Array<typeof rawItems> = [];
    let i = 0;

    while (i < rawItems.length) {
      const isFirst = chunks.length === 0;

      let yStart = 0;
      if (isFirst) {
        yStart = yTableStart;
      } else {
        yStart = 100 + 16 + 8;
      }

      const available = FOOTER_SAFE_TOP - (yStart + 16 + 8);

      let used = 0;
      const pageItems: typeof rawItems = [];

      while (i < rawItems.length) {
        const it = rawItems[i];
        doc.fontSize(splitTableFont);

        const labelH = doc.heightOfString(String(it.label ?? ""), { width: colDesignationW, lineGap: splitLineGap });
        const rowH = Math.max(labelH, splitTableFont + 2) + 3;

        if (pageItems.length > 0 && used + rowH > available) break;

        pageItems.push(it);
        used += rowH;
        i++;
      }

      chunks.push(pageItems);
    }

    return chunks;
  }

  const tablePages = paginateTable();

  for (let p = 0; p < tablePages.length; p++) {
    pages.push(
      buildTablePage({
        first: p === 0,
        items: tablePages[p],
        isLastTablePage: p === tablePages.length - 1,
      })
    );
  }

  function canFitTotalsAndLegalOnLastTablePage() {
    const isFirst = tablePages.length === 1;

    let yStart = 0;
    if (isFirst) yStart = yTableStart;
    else yStart = 100 + 16 + 8;

    const headerH = 16 + 8;
    let y = yStart + headerH;

    doc.fontSize(splitTableFont);
    for (const it of tablePages[tablePages.length - 1]) {
      const labelH = doc.heightOfString(String(it.label ?? ""), { width: colDesignationW, lineGap: splitLineGap });
      const rowH = Math.max(labelH, splitTableFont + 2) + 3;
      y += rowH;
    }

    y += 18;

    const totalsH = 150;

    doc.fontSize(8);
    const legalH = doc.heightOfString(legalTextBase, { width: usableW, lineGap: 2 });

    return y + totalsH + legalH <= FOOTER_SAFE_TOP - 6;
  }

  const fitOnLast = canFitTotalsAndLegalOnLastTablePage();

  if (!fitOnLast) {
    pages.push(() => {
      drawPageBase();
      doc.fontSize(14).fillColor("black").text(`FACTURE ${(invoice as any).number ?? ""}`, left, 70, { width: usableW, align: "center" });
    });
  }

  const totalPages = pages.length;

  for (let idx = 0; idx < pages.length; idx++) {
    pages[idx]();

    const isLastRenderedPage = idx === pages.length - 1;

    if (isLastRenderedPage) {
      let y = 110;

      if (fitOnLast) {
        const isFirst = tablePages.length === 1;
        let yStart = 0;

        if (isFirst) yStart = yTableStart;
        else yStart = 100 + 16 + 8;

        y = yStart + (16 + 8);

        doc.fontSize(splitTableFont);
        for (const it of tablePages[tablePages.length - 1]) {
          const labelH = doc.heightOfString(String(it.label ?? ""), { width: colDesignationW, lineGap: splitLineGap });
          const rowH = Math.max(labelH, splitTableFont + 2) + 3;
          y += rowH;
        }

        y += 18;
      } else {
        y = 110;
      }

      // Totaux
      y = addTotalLineAt(y, "TOTAL HT", totalHT);
      if (!vatExempt) y = addTotalLineAt(y, "TVA (20%)", vatAmount);
      y = addTotalLineAt(y, "TOTAL TTC", totalTTC);

      y += 6;

      // accompte / reste : UNIQUEMENT si paiement différé
if (deferredPayment) {
  y = addTotalLineAt(
    y,
    depositPaid ? "accompte versées (TTC)" : "Accompte non versées (TTC)",
    depositPaid ? depositPaidAmountTTC : 0,
    true
  );
  y = addTotalLineAt(y, "Reste à payer (TTC)", restToPayTTC, true);
} else {
  // Paiement comptant : pas d'accompte à afficher
  y = addTotalLineAt(y, "Montant à payer (TTC)", totalTTC, true);
}

y += 10;

      // Légal (shrink)
      const legalBottomY = FOOTER_SAFE_TOP - 6;
      let legalFont = 8;
      let legalLineGap = 2;

      while (legalFont >= 6.8) {
        doc.fontSize(legalFont);
        const h = doc.heightOfString(legalTextBase, { width: usableW, lineGap: legalLineGap });
        if (y + h <= legalBottomY) break;
        legalFont -= 0.2;
        if (legalFont < 7.4) legalLineGap = 1.5;
      }

      doc.fontSize(legalFont).fillColor("#111").text(legalTextBase, left, y, {
        width: usableW,
        lineGap: legalLineGap,
        align: "left",
      });
    }

    drawFooter(idx + 1, totalPages);
  }

  doc.end();

  const pdfBuffer = await done;
  const body = new Uint8Array(pdfBuffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Facture_${(invoice as any).number ?? "FACTURE"}.pdf"`,
    },
  });
}
