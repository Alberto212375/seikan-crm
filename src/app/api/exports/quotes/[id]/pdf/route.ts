// src/app/api/exports/quotes/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfkitMod = require("pdfkit");
const PdfDoc = pdfkitMod?.default ?? pdfkitMod;

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

  signature?: {
    signerFirstName?: string;
    signerLastName?: string;
    signerRole?: string;
    accepted?: boolean;
    signedAt?: string;
    signatureDataUrl?: string;
    context?: { ip?: string; userAgent?: string };
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
function formatDateTimeFR(d: Date) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yy = d.getFullYear();
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${dd}/${mm}/${yy} à ${hh}:${mi}`;
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

  // on force une date "minuit" locale pour éviter les décalages
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function computePayBeforeDateFromClosure(closingDateIso: string | undefined | null): Date | null {
  const closing = closingDateIso ? parseIsoDateOnly(closingDateIso) : null;
  if (!closing) return null;
  const d = new Date(closing);
  d.setDate(d.getDate() - 2); // J-2
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

// ✅ échéance = 28 du mois de livraison
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

/** Fond + liseré + dentelle */
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

// ✅ Lecture robuste des dimensions PNG
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

function decodeDataUrlToPngBuffer(dataUrl: string): Buffer | null {
  try {
    const s = String(dataUrl || "");
    if (!s.startsWith("data:image/")) return null;
    const base64 = s.split(",")[1] || "";
    if (!base64) return null;
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

// ✅ Détourage + recadrage (si pngjs dispo). Fallback = buffer original.
function tryTrimSignaturePng(buf: Buffer): Buffer {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PNG } = require("pngjs");

    const png = PNG.sync.read(buf);
    const { width, height, data } = png;

    // 1) rendre le "presque blanc" transparent
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (width * y + x) << 2;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a === 0) continue;

        // blanc / quasi blanc => transparent
        if (r >= 245 && g >= 245 && b >= 245) {
          data[i + 3] = 0;
        }
      }
    }

    // 2) bounding box des pixels non transparents
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (width * y + x) << 2;
        const a = data[i + 3];
        if (a > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    // si rien trouvé, on renvoie le PNG original
    if (maxX < 0 || maxY < 0) return buf;

    // padding léger (évite de couper la plume)
    const pad = 6;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);

    const outW = maxX - minX + 1;
    const outH = maxY - minY + 1;

    const out = new PNG({ width: outW, height: outH });

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const srcI = (width * (minY + y) + (minX + x)) << 2;
        const dstI = (outW * y + x) << 2;
        out.data[dstI] = data[srcI];
        out.data[dstI + 1] = data[srcI + 1];
        out.data[dstI + 2] = data[srcI + 2];
        out.data[dstI + 3] = data[srcI + 3];
      }
    }

    return PNG.sync.write(out);
  } catch {
    // pngjs pas dispo ou erreur => fallback
    return buf;
  }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { items: true },
  });

  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = safeJsonParse<QuoteMeta>((quote as any).metaJson) ?? {};
  const postersMeta = meta.posters ?? {};

  const rawItems = (quote.items ?? []).map((it: any) => {
    const original = String(it.label ?? "");
    const { cleanLabel, format } = extractFormatAndCleanLabel(original);

    return {
      label: cleanLabel,
      format,
      qty: Math.max(1, Number(it.qty ?? 1)),
      unit: Math.max(0, Number(it.unitPrice ?? 0)), // cents
    };
  });

  // Totaux HT depuis DB
  const totalHT = Number((quote as any).totalHT ?? 0) || 0;
  const depositPct = toInt((quote as any).depositPct ?? 0, 0);
  const depositHT = Number((quote as any).depositHT ?? 0) || 0;
  const balanceHT = Number((quote as any).balanceHT ?? 0) || 0;

  // ✅ Paiement différé réel = meta.posters.deferredPayment OU depositPct>0 (fallback robuste)
  const deferredPayment = Boolean(postersMeta.deferredPayment) || depositPct > 0;

  // TVA affichage (si décochée, 20%)
  const vatExempt = postersMeta.vatExempt !== false;
  const totalTTC = vatExempt ? totalHT : Math.round(totalHT * 1.2);
  const vatAmount = totalTTC - totalHT;

  // Dates
  const issueDate = tryParseDate((quote as any).issueDate ?? (quote as any).createdAt ?? Date.now()) ?? new Date();
  const issueDateStr = formatDateFRShort(issueDate);

  const validUntil = tryParseDate((quote as any).validUntil) ?? issueDate;
  const validUntilStr = formatDateFRShort(validUntil);

  // ✅ échéances paiement
const payBeforeDate = computePayBeforeDateFromClosure(postersMeta.closingDate ?? null);
const payBeforeShort = payBeforeDate ? formatDateFRShort(payBeforeDate) : "";

const dueDate28 = deferredPayment ? computeDueDate28FromClosure(postersMeta.closingDate ?? null) : null;
const dueShort = dueDate28 ? formatDateFRShort(dueDate28) : "";
const dueDate28Str = dueDate28 ? formatDateFRLong(dueDate28) : "";

  // Police locale
  const fontPath = path.join(process.cwd(), "src", "assets", "fonts", "DejaVuSans.ttf");

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

  // Fonts
  if (fs.existsSync(fontPath)) {
    doc.registerFont("base", fontPath);
    doc.font("base");
  }
  const fontBoldPath = path.join(process.cwd(), "src", "assets", "fonts", "DejaVuSans-Bold.ttf");
  if (fs.existsSync(fontBoldPath)) {
    doc.registerFont("baseBold", fontBoldPath);
  }

  // ✅ IMPORTANT: on crée une 1ère page RÉELLE immédiatement
  // pour éviter que PDFKit génère des pages "fantômes" pendant les heightOfString()
  doc.addPage({ size: "A4", margin: 50 });

  // Page metrics (A4)
  const pageW = 595.28;
  const pageH = 841.89;
  const left = 50;
  const right = 50;
  const usableW = pageW - left - right;

  // Footer fixed (IMPORTANT : doit rester DANS la zone imprimable)
  // Avec margin: 50, la zone "texte" s'arrête à pageH - 50.
  // Si on écrit plus bas, PDFKit déclenche un saut de page => pages fantômes.
  const FOOTER_FONT_SIZE = 8;

  // On place le footer un peu au-dessus de la limite "pageH - 50"
  const footerY = pageH - 50 - 10; // ✅ 10 pts au-dessus de la marge basse
  const FOOTER_SAFE_TOP = footerY - 18; // contenu doit rester au-dessus du footer

  // IBAN/BIC
  const iban = "FR76 1213 5003 0004 2562 6218 853";
  const bic = "CEPAFRPP213";

  // Logo header
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

  // Party
  const party = meta.party ?? {};
  const isPro = Boolean(party.isProfessional);

  const recipientSocieteRaw = String(party.societe ?? (quote as any).clientName ?? "").trim();
  const recipientSociete = isPro ? recipientSocieteRaw.toUpperCase() : recipientSocieteRaw;

  const recipientService = String(party.service ?? (quote as any).clientService ?? "").trim();
  const recipientSiret = String(party.siret ?? "").trim();

  const recipientEmail = String((quote as any).clientEmail ?? "").trim();
  const recipientPhone = String((quote as any).clientPhone ?? "").trim();
  const recipientAddress = String((quote as any).clientAddress ?? "").trim();

  // Émetteur (fixe)
  const issuerLines = [
    "SEIKAN GALLERY",
    "SIRET : 90051575000025",
    "seikan.gallery@gmail.com",
    "0610380208",
    "5 Rue de Normandie, 91210 Draveil",
  ].join("\n");

  // Destinataire
  const destLines: string[] = [];
  if (isPro && recipientSiret) destLines.push(`${recipientSociete}  SIRET : ${recipientSiret}`);
  else destLines.push(`${recipientSociete}`);
  if (isPro && recipientService) destLines.push(`Service : ${recipientService}`);
  if (recipientEmail) destLines.push(recipientEmail);
  if (recipientPhone) destLines.push(recipientPhone);
  if (recipientAddress) destLines.push(recipientAddress);
  const destText = destLines.filter(Boolean).join("\n");

  // Colonnes tableau
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

  // Text paiement/légal
  // - Si paiement différé: on affiche une phrase de paiement.
  // - Si paiement comptant: on supprime la phrase (tu voulais enlever "Paiement comptant...").
  // - Texte "retard": différent selon paiement différé ou non (logique clôture).
  const paiementHeader = deferredPayment
    ? `Paiement différé : acompte à la commande, solde à régler au plus tard le ${dueDate28Str || "28 du mois de livraison"} : Par virement bancaire`
    : "";

  const lateClause = deferredPayment
    ? `En cas de retard de paiement, des pénalités de retard sont dues, calculées à un taux égal à 3 fois le taux
d’intérêt légal en vigueur.`
    : `À défaut de règlement à réception (paiement comptant), l’exécution de la commande est suspendue jusqu’à encaissement
et la livraison pourra être reportée à la clôture de commande suivante.`;

    const signature = (meta as any)?.signature ?? null;

  const signedOk =
    Boolean(signature?.accepted) &&
    Boolean(signature?.signedAt) &&
    typeof signature?.signatureDataUrl === "string" &&
    String(signature.signatureDataUrl).startsWith("data:image/");

  const signedAtDate = signedOk ? tryParseDate(signature.signedAt) : null;
  const signedAtLabel = signedAtDate ? formatDateTimeFR(signedAtDate) : "";

  const signerFull = signedOk
    ? `${String(signature?.signerFirstName ?? "").trim()} ${String(signature?.signerLastName ?? "").trim()}`.trim()
    : "";

   const signerRole = signedOk ? (String(signature?.signerRole ?? "").trim() || "Gérant") : "";

  const legalSignedBefore = `${paiementHeader ? paiementHeader + "\n" : ""}IBAN : ${iban}
BIC : ${bic}

Bon pour accord : Confirmé
Signataire : ${signerFull}${signerRole ? ` — ${signerRole}` : ""}
Signé le : ${signedAtLabel}

Signature :`;

const legalSignedAfter = `${lateClause}
Une indemnité forfaitaire de 40 € pour frais de recouvrement sera également exigible (articles L.441-10
et D.441-5 du Code de commerce).
Mentions légales :
- TVA non applicable, art. 293 B du CGI`;

const legalUnsigned = `${paiementHeader ? paiementHeader + "\n" : ""}IBAN : ${iban}
BIC : ${bic}

Si ce devis vous convient, veuillez le signer et le dater en marquant "Lu et approuvé. Bon pour Accord.".

Signature / Date :



${lateClause}
Une indemnité forfaitaire de 40 € pour frais de recouvrement sera également exigible (articles L.441-10
et D.441-5 du Code de commerce).
Mentions légales :
- TVA non applicable, art. 293 B du CGI`;


    function drawFooter(pageIndex: number, totalPages: number) {
    doc.save();
    doc.font("base").fontSize(FOOTER_FONT_SIZE).fillColor("#111");

    const leftW = usableW / 2;
    const rightW = usableW / 2;

    // ✅ IMPORTANT :
    // - y (footerY) est dans la zone imprimable => pas de saut de page
    // - lineBreak:false => jamais de retour ligne
    // - ellipsis:true => jamais de débordement
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

    // ✅ drawPageBase : utilise la page déjà créée (la toute première),
  // puis addPage seulement à partir de la 2e page.
  let __pageBaseUsedOnce = false;
  function drawPageBase() {
    if (!__pageBaseUsedOnce) {
      __pageBaseUsedOnce = true;
      // on est déjà sur la 1ère page (créée plus haut)
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
    doc.fontSize(16).fillColor("black").text(`DEVIS ${(quote as any).number ?? ""}`, left, titleY, { width: usableW, align: "center" });
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

  // =========================
  // 1) PAGE 1 (header complet) : calc positions
  // =========================
  // On va faire un "dry-run" pour savoir si TOUT peut tenir en 1 page.
  // Règle : si le tableau ne peut pas tenir avec les totaux + légal => on split (table continue page suivante).
  const TABLE_FONT_MAX = 9.5;
  const TABLE_FONT_MIN = 7.2;

  // Layout header
  const gap = 30;
  const colW = (usableW - gap) / 2;
  const leftColX = left;
  const rightColX = left + colW + gap;

  // On calc le yAfterHeader comme dans ton rendu actuel
  // (sans addPage ici, juste calculs)
  // Approx :
  doc.fontSize(10);
  const issuerH = doc.heightOfString(issuerLines, { width: colW, lineGap: 2 });
  const destH = doc.heightOfString(destText, { width: colW, lineGap: 2 });

  // yAfterHeader dépend du titleY, donc ok
  const baseColsY = titleY + 28;
  let yAfterHeader = baseColsY + 16 + Math.max(issuerH, destH) + 18;
  const yTableStart = yAfterHeader + 58 + 12;

  // Mesure hauteur bloc totaux + légal (qu’on met en bas en 1 page)
  // Totaux (3-5 lignes) : on réserve ~ 110px + marge
  const totalsReserve = 120;

  // Légal : on le shrink si besoin, mais on réserve une base.
  // On va mesurer avec font 8 / lineGap 2.
  doc.fontSize(8);
  const legalBaseH = doc.heightOfString(signedOk ? (legalSignedBefore + "\n\n" + legalSignedAfter) : legalUnsigned, {
  width: usableW,
  lineGap: 2,
});

  // Espace dispo pour TABLEAU en mode "1 page"
  const availableForTableIfSingle = (FOOTER_SAFE_TOP - 6) - (yTableStart + 16 + 8) - totalsReserve - legalBaseH;

  // Est-ce que ça tient en 1 page en réduisant la police du tableau ?
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

  // ✅ Le “X lignes” demandé :
  // Si 1 page possible => pas de split (<= X effectif).
  // Sinon => split (table déborde).
  // On peut te laisser un indicateur lisible :
  // const X_EFFECTIF = singlePagePossible ? rawItems.length : /* calculé à la volée en pagination */;
  // (pas affiché dans PDF, juste logique)

  // =========================
  // 2) RENDER FINAL
  // =========================

  // Helper : dessine une ligne tableau à une coord y, retourne hauteur consommée
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

  // Helper : totaux (utilisé en 1 page ou sur dernière page)
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

  // Helper : draw header COMPLET (uniquement page 1)
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

    doc.fontSize(10).fillColor("black").text(`Date d'émission du devis : ${issueDateStr}`, rightColX, yAfterHeader2, { width: colW });
    doc.fontSize(10).fillColor("black").text(`Devis valable : ${validUntilStr}`, rightColX, yAfterHeader2 + 16, { width: colW });

    yAfterHeader2 += 58;
    return { yAfterHeader: yAfterHeader2 };
  }

  // Helper : header MINIMAL (pages suivantes du tableau)
  function drawTableContinuationHeader() {
  // ✅ Pages suivantes : pas de répétition du numéro de devis
  // (on garde juste le tableau)
}

  // =========================
  // MODE A : 1 PAGE (avant) si possible
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
        (it as any).format ?? "—",
        String(it.qty),
        euros(it.unit),
        euros(amount)
      );
    }

    // trait fin
    y += 4;
    doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
    y += 10;

    // TOTAUX
    y = addTotalLineAt(y, "TOTAL HT", totalHT);
    if (!vatExempt) y = addTotalLineAt(y, "TVA (20%)", vatAmount);
    y = addTotalLineAt(y, "TOTAL TTC", totalTTC);

    y += 6;

    if (!deferredPayment) {
  const label = payBeforeShort
    ? `Montant à payer avant le ${payBeforeShort} :`
    : "Montant à payer lors de la commande :";
  y = addTotalLineAt(y, label, totalTTC, true);
} else {
  const dueLabel = dueShort || "28 du mois de livraison";

  const acompteTTC = vatExempt ? depositHT : Math.round((totalTTC * depositPct) / 100);
  const soldeTTC = vatExempt ? balanceHT : totalTTC - acompteTTC;

  const acompteLabel = payBeforeShort
    ? `Acompte à payer avant le ${payBeforeShort} :`
    : "Acompte à payer à la commande :";

  y = addTotalLineAt(y, acompteLabel, acompteTTC, true);
  y = addTotalLineAt(y, `Solde restant à payer au ${dueLabel} :`, soldeTTC, true);
}

    y += 10;

    // ✅ LEGAL + signature "au bon endroit"
const legalBottomY = FOOTER_SAFE_TOP - 6;

let legalFont = 8;
let legalLineGap = 2;

const sigReserveH = signedOk ? 74 : 0; // hauteur image + marge
const sigGap = signedOk ? 8 : 0;

// on shrink en tenant compte de l'image
while (legalFont >= 6.8) {
  doc.fontSize(legalFont);

  const textH = signedOk
    ? doc.heightOfString(legalSignedBefore + "\n\n" + legalSignedAfter, { width: usableW, lineGap: legalLineGap })
    : doc.heightOfString(legalUnsigned, { width: usableW, lineGap: legalLineGap });

  const totalH = textH + sigReserveH + sigGap;

  if (y + totalH <= legalBottomY) break;

  legalFont -= 0.2;
  if (legalFont < 7.4) legalLineGap = 1.5;
}

// rendu
doc.fontSize(legalFont).fillColor("#111");

if (!signedOk) {
  doc.text(legalUnsigned, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });
} else {
  // 1) avant
  doc.text(legalSignedBefore, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });

  // 2) image juste après
  const imgBufRaw = decodeDataUrlToPngBuffer(String(signature?.signatureDataUrl || ""));
  if (imgBufRaw) {
    const imgBuf = tryTrimSignaturePng(imgBufRaw);

    const sigW = 240; // largeur visuelle
    const sigH = 64;  // hauteur max
    const sigX = left + 2;
    const sigY = doc.y + 6;

    // ✅ PAS DE CADRE, juste l'image
    doc.image(imgBuf, sigX, sigY, { fit: [sigW, sigH] });

    // on force le curseur sous la zone signature
    doc.y = sigY + sigH + 6;
  }

  // 3) après
  doc.text("\n" + legalSignedAfter, left, doc.y, { width: usableW, lineGap: legalLineGap, align: "left" });
}

    // FOOTER 1/1
    drawFooter(1, 1);

    doc.end();
    const pdfBuffer = await done;
    const body = new Uint8Array(pdfBuffer);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Devis_${(quote as any).number ?? "DEVIS"}.pdf"`,
      },
    });
  }

  // =========================
  // MODE B : SPLIT (table déborde) => on pagine le tableau, et on met totaux+légal à la fin
  // =========================

  // Réglages tableau en mode split (lisible, stable)
  const splitTableFont = 9.2;
  const splitLineGap = 1;

  // On va construire les pages en mémoire (simple) :
  // - page 1 : header complet + table (autant que possible)
  // - pages suivantes : header minimal + table
  // - dernière page : après dernière ligne table => totaux + légal ; si pas de place => nouvelle page pour totaux+légal
  type PageDraw = () => void;
  const pages: PageDraw[] = [];

  // Fonction qui dessine une page de table (1ère ou continuation) avec une tranche d’items
  function buildTablePage(opts: {
    first: boolean;
    items: typeof rawItems;
    isLastTablePage: boolean;
  }) {
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
          (it as any).format ?? "—",
          String(it.qty),
          euros(it.unit),
          euros(amount)
        );
      }

      // si c’est la dernière page de table, on trace un trait en bas du tableau
      if (opts.isLastTablePage) {
        y += 4;
        doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
      }
    };
  }

  // Pagination table : on remplit en calculant ce qui tient sur une page donnée
  function paginateTable() {
    const chunks: Array<typeof rawItems> = [];
    let i = 0;

    while (i < rawItems.length) {
      // On simule hauteur dispo selon type page
      const isFirst = chunks.length === 0;

      // yStart calculé "comme si"
      let yStart = 0;
      if (isFirst) {
        // approx yAfterHeader calculé plus haut, mais on reprend le vrai calcul simple
        yStart = yTableStart;
      } else {
        yStart = 100 + 16 + 8; // continuation title + header table
      }

      const available = FOOTER_SAFE_TOP - (yStart + 16 + 8);

      // On ajoute des lignes jusqu’à remplir
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

  // Construire les pages table
  for (let p = 0; p < tablePages.length; p++) {
    pages.push(
      buildTablePage({
        first: p === 0,
        items: tablePages[p],
        isLastTablePage: p === tablePages.length - 1,
      })
    );
  }

  // Page finale : totaux+légal doivent aller sur la dernière page si possible, sinon page séparée.
  // Pour savoir : on va estimer l’espace restant sur la dernière page de table et décider.
  function canFitTotalsAndLegalOnLastTablePage() {
    const isFirst = tablePages.length === 1;

    // yStart réel
    let yStart = 0;
    if (isFirst) {
      yStart = yTableStart;
    } else {
      yStart = 100 + 16 + 8;
    }

    const headerH = 16 + 8;
    let y = yStart + headerH;

    // hauteur des lignes sur la dernière page de table
    doc.fontSize(splitTableFont);
    for (const it of tablePages[tablePages.length - 1]) {
      const labelH = doc.heightOfString(String(it.label ?? ""), { width: colDesignationW, lineGap: splitLineGap });
      const rowH = Math.max(labelH, splitTableFont + 2) + 3;
      y += rowH;
    }

    y += 18; // trait + marge

    // totaux reserve
    const totalsH = 120;

    // legal base
    doc.fontSize(8);
    const legalH = doc.heightOfString(signedOk ? (legalSignedBefore + "\n\n" + legalSignedAfter) : legalUnsigned, {
  width: usableW,
  lineGap: 2,
});

    return y + totalsH + legalH <= FOOTER_SAFE_TOP - 6;
  }

  const fitOnLast = canFitTotalsAndLegalOnLastTablePage();

  // Si ça ne tient pas, on ajoute une page “totaux+légal”
  if (!fitOnLast) {
  pages.push(() => {
    drawPageBase();
    // ✅ pas de répétition du numéro de devis ici non plus
    // (le footer est géré en fin globale)
  });
}

  // Maintenant on rend tout, en gérant footers Page X/Y
  const totalPages = pages.length;

  for (let idx = 0; idx < pages.length; idx++) {
    pages[idx]();

    const isLastRenderedPage = idx === pages.length - 1;

    // Si on est sur la dernière page (soit dernière page table si fitOnLast, soit page ajoutée)
    if (isLastRenderedPage) {
  // Calcul y de départ : si on est sur une page ajoutée => y = 110
  // Sinon (totaux sur dernière page table) => on doit calculer la position y après table affichée
  let y = 110;

  if (fitOnLast) {
    // On est sur la dernière page de table
    const isFirst = tablePages.length === 1;
    let yStart = 0;

    if (isFirst) {
      yStart = yTableStart;
    } else {
      yStart = 100 + 16 + 8;
    }

    // header table
    y = yStart + (16 + 8);

    // lignes table
    doc.fontSize(splitTableFont);
    for (const it of tablePages[tablePages.length - 1]) {
      const labelH = doc.heightOfString(String(it.label ?? ""), { width: colDesignationW, lineGap: splitLineGap });
      const rowH = Math.max(labelH, splitTableFont + 2) + 3;
      y += rowH;
    }

    y += 18; // marge après tableau
  } else {
    // page ajoutée : y reste 110
    y = 110;
  }

  // Totaux
  y = addTotalLineAt(y, "TOTAL HT", totalHT);
  if (!vatExempt) y = addTotalLineAt(y, "TVA (20%)", vatAmount);
  y = addTotalLineAt(y, "TOTAL TTC", totalTTC);

  y += 6;

  if (!deferredPayment) {
  const label = payBeforeShort
    ? `Montant à payer avant le ${payBeforeShort} :`
    : "Montant à payer lors de la commande :";
  y = addTotalLineAt(y, label, totalTTC, true);
} else {
  const dueLabel = dueShort || "28 du mois de livraison";

  const acompteTTC = vatExempt ? depositHT : Math.round((totalTTC * depositPct) / 100);
  const soldeTTC = vatExempt ? balanceHT : totalTTC - acompteTTC;

  const acompteLabel = payBeforeShort
    ? `Acompte à payer avant le ${payBeforeShort} :`
    : "Acompte à payer à la commande :";

  y = addTotalLineAt(y, acompteLabel, acompteTTC, true);
  y = addTotalLineAt(y, `Solde restant à payer au ${dueLabel} :`, soldeTTC, true);
}

  y += 10;

  // ✅ LEGAL + signature "au bon endroit"
  const legalBottomY = FOOTER_SAFE_TOP - 6;

  let legalFont = 8;
  let legalLineGap = 2;

  const sigReserveH = signedOk ? 74 : 0; // hauteur image + marge
  const sigGap = signedOk ? 8 : 0;

  // on shrink en tenant compte de l'image
  while (legalFont >= 6.8) {
    doc.fontSize(legalFont);

    const textH = signedOk
      ? doc.heightOfString(legalSignedBefore + "\n\n" + legalSignedAfter, { width: usableW, lineGap: legalLineGap })
      : doc.heightOfString(legalUnsigned, { width: usableW, lineGap: legalLineGap });

    const totalH = textH + sigReserveH + sigGap;

    if (y + totalH <= legalBottomY) break;

    legalFont -= 0.2;
    if (legalFont < 7.4) legalLineGap = 1.5;
  }

  // rendu
  doc.fontSize(legalFont).fillColor("#111");

  if (!signedOk) {
    doc.text(legalUnsigned, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });
  } else {
    // 1) avant
    doc.text(legalSignedBefore, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });

    // 2) image juste après
    const imgBufRaw = decodeDataUrlToPngBuffer(String(signature?.signatureDataUrl || ""));
    if (imgBufRaw) {
      const imgBuf = tryTrimSignaturePng(imgBufRaw);

      const sigW = 240; // largeur visuelle
      const sigH = 64;  // hauteur max
      const sigX = left + 2;
      const sigY = doc.y + 6;

      // ✅ PAS DE CADRE, juste l'image
      doc.image(imgBuf, sigX, sigY, { fit: [sigW, sigH] });

      // on force le curseur sous la zone signature
      doc.y = sigY + sigH + 6;
    }

    // 3) après
    doc.text("\n" + legalSignedAfter, left, doc.y, { width: usableW, lineGap: legalLineGap, align: "left" });
  }
}

    // Footer fixe page idx+1 / totalPages
    drawFooter(idx + 1, totalPages);
  }

  doc.end();

  const pdfBuffer = await done;
  const body = new Uint8Array(pdfBuffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Devis_${(quote as any).number ?? "DEVIS"}.pdf"`,
    },
  });
}
