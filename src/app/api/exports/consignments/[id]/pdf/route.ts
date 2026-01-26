// src/app/api/exports/consignments/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfkitMod = require("pdfkit");
const PdfDoc = pdfkitMod?.default ?? pdfkitMod;

type ConsignmentMeta = {
  signature?: {
    signerFirstName?: string;
    signerLastName?: string;
    signerRole?: string;
    accepted?: boolean;
    signedAt?: string;
    signatureDataUrl?: string; // data:image/png;base64,...
    context?: { ip?: string; userAgent?: string };
  };
};

function safeJsonParse<T>(s: any): T | null {
  if (!s) return null;
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return null;
  }
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
function fmtDateFR(input: Date | string | null | undefined) {
  const d = tryParseDate(input ?? null);
  return d ? formatDateFRShort(d) : "—";
}

function centsToEurosStr(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}
function euros(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + (abs / 100).toFixed(2).replace(".", ",") + " €";
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
        if (r >= 245 && g >= 245 && b >= 245) data[i + 3] = 0;
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

    if (maxX < 0 || maxY < 0) return buf;

    // padding léger
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
    return buf;
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  const c = await prisma.consignment.findUnique({
    where: { id },
    include: {
      client: true,
      items: { orderBy: { sort: "asc" } },
    },
  });

  if (!c) {
    return NextResponse.json({ error: "Dépôt-vente introuvable." }, { status: 404 });
  }

  const meta = safeJsonParse<ConsignmentMeta>((c as any).metaJson) ?? {};
  const signature = meta?.signature ?? null;

  const signedOk =
    Boolean(signature?.accepted) &&
    Boolean(signature?.signedAt) &&
    typeof signature?.signatureDataUrl === "string" &&
    String(signature.signatureDataUrl).startsWith("data:image/");

  const signedAtDate = signedOk ? tryParseDate(signature!.signedAt) : null;
  const signedAtLabel = signedAtDate ? formatDateTimeFR(signedAtDate) : "";

  const signerFull = signedOk
    ? `${String(signature?.signerFirstName ?? "").trim()} ${String(signature?.signerLastName ?? "").trim()}`.trim()
    : "";
  const signerRole = signedOk ? (String(signature?.signerRole ?? "").trim() || "Gérant") : "";

  const rawItems = ((c.items ?? []) as any[]).map((it) => ({
    ref: String(it.ref ?? "").trim() || "—",
    format: String(it.format ?? "").trim() || "—",
    nameFR: String(it.nameFR ?? "").trim() || "—",
    qty: Math.max(0, Number(it.qty ?? 0) || 0),
    unit: Math.max(0, Number(it.unitPrice ?? 0) || 0), // cents
  }));

  const totalQty = rawItems.reduce((s, it) => s + (it.qty || 0), 0);
  const totalValue = rawItems.reduce((s, it) => s + (it.qty || 0) * (it.unit || 0), 0);

  // Police locale (comme devis) : évite Helvetica.afm sur Vercel
  const fontPath = path.join(process.cwd(), "src", "assets", "fonts", "DejaVuSans.ttf");
  const fontBoldPath = path.join(process.cwd(), "src", "assets", "fonts", "DejaVuSans-Bold.ttf");

  const doc = new PdfDoc({
    size: "A4",
    margin: 50,
    autoFirstPage: false,
    font: null,
    info: { Title: `Depot-vente ${(c as any).number ?? ""}` },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Fonts
  if (fs.existsSync(fontPath)) {
    doc.registerFont("base", fontPath);
    doc.font("base");
  }
  if (fs.existsSync(fontBoldPath)) {
    doc.registerFont("baseBold", fontBoldPath);
  }

  // ✅ IMPORTANT : on crée une 1ère page RÉELLE immédiatement (anti pages fantômes)
  doc.addPage({ size: "A4", margin: 50 });

  // Page metrics (A4)
  const pageW = 595.28;
  const pageH = 841.89;
  const left = 50;
  const right = 50;
  const usableW = pageW - left - right;

  // Footer safe (identique devis)
  const FOOTER_FONT_SIZE = 8;
  const footerY = pageH - 50 - 10; // 10 pts au-dessus de la marge basse
  const FOOTER_SAFE_TOP = footerY - 18;

  // Logo header (même logique devis)
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

  // Émetteur (fixe)
  const issuerLines = [
    "SEIKAN GALLERY",
    "SIRET : 90051575000025",
    "seikan.gallery@gmail.com",
    "0610380208",
    "5 Rue de Normandie, 91210 Draveil",
  ].join("\n");

  // Dépositaire (client)
  const depositaireName = String((c as any).clientName ?? (c as any).client?.displayName ?? "").trim() || "—";
  const depositaireEmail = String((c as any).clientEmail ?? "").trim();
  const depositairePhone = String((c as any).clientPhone ?? "").trim();
  const depositaireAddress = String((c as any).clientAddress ?? "").trim();

  const destLines: string[] = [];
  destLines.push(depositaireName);
  if (depositaireEmail) destLines.push(depositaireEmail);
  if (depositairePhone) destLines.push(depositairePhone);
  if (depositaireAddress) destLines.push(depositaireAddress);
  const destText = destLines.filter(Boolean).join("\n") || "—";

  // Colonnes tableau (calque “devis” : calcul stable)
  const colRefW = 85;
  const colFormatW = 65;
  const colQtyW = 45;
  const colUnitW = 85;
  const colAmountW = 95;

  const colAmountX = left + usableW - colAmountW;
  const colUnitX = colAmountX - colUnitW;
  const colQtyX = colUnitX - colQtyW;
  const colFormatX = colQtyX - colFormatW;
  const colRefX = left;
  const colNameX = colRefX + colRefW + 10;
  const colNameW = colFormatX - colNameX - 10;

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

  // ✅ drawPageBase : utilise la page déjà créée (1ère), addPage ensuite
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

    const num = String((c as any).number ?? "").trim();
    doc.fontSize(16).fillColor("black").text(`CONTRAT DÉPÔT-VENTE ${num}`, left, titleY, { width: usableW, align: "center" });
  }

  // Header complet page 1 (même “devis”, juste contenu)
  function drawFullHeader(): { yAfterHeader: number } {
    drawLogoAndTitle();

    const gap = 30;
    const colW = (usableW - gap) / 2;
    const leftColX = left;
    const rightColX = left + colW + gap;

    const baseColsY = titleY + 28;

    doc.fontSize(11).fillColor("black").text("Émetteur :", leftColX, baseColsY);
    doc.fontSize(10).fillColor("black").text(issuerLines, leftColX, baseColsY + 16, { width: colW });

    doc.fontSize(11).fillColor("black").text("Dépositaire :", rightColX, baseColsY, { width: colW });
    doc.fontSize(10).fillColor("black").text(destText, rightColX, baseColsY + 16, { width: colW });

    doc.fontSize(10);
    const issuerH = doc.heightOfString(issuerLines, { width: colW, lineGap: 2 });
    const destH = doc.heightOfString(destText, { width: colW, lineGap: 2 });
    let yAfter = baseColsY + 16 + Math.max(issuerH, destH) + 18;

    // Bloc “infos dépôt” (remplace “Livraison” du devis)
    const depositDate = fmtDateFR((c as any).depositDate ?? null);
    const recoveryDate = fmtDateFR((c as any).recoveryDate ?? null);
    const periodDays = Number((c as any).periodDays ?? 0) || 0;
    const periodLabel = periodDays > 0 ? `${periodDays} jours` : "—";

    doc.fontSize(11).fillColor("black").text("Dépôt :", leftColX, yAfter, { width: colW });
    doc.fontSize(10).fillColor("black").text(`Date de dépôt : ${depositDate}`, leftColX, yAfter + 16, {
      width: colW,
      lineBreak: false,
      ellipsis: true,
    });

    doc.fontSize(10).fillColor("black").text(`Date de récupération : ${recoveryDate}`, rightColX, yAfter, { width: colW });
    doc.fontSize(10).fillColor("black").text(`Durée : ${periodLabel}`, rightColX, yAfter + 16, { width: colW });

    yAfter += 58;

    // Statut signé (comme “devis” => discret mais visible)
    if (signedOk) {
      doc.font("baseBold").fontSize(10).fillColor("#111");
      doc.text(`Statut : SIGNÉ le ${fmtDateFR(signature?.signedAt || new Date())}`, leftColX, yAfter - 10, {
        width: usableW,
        align: "left",
      });
      doc.font("base").fillColor("black");
    }

    return { yAfterHeader: yAfter };
  }

  function drawTableHeader(y: number) {
    doc.fontSize(10).fillColor("black").text("Référence", colRefX, y, { width: colRefW });
    doc.text("Nom (FR)", colNameX, y, { width: colNameW });
    doc.text("Format", colFormatX, y, { width: colFormatW, align: "left" });
    doc.text("Qté", colQtyX, y, { width: colQtyW, align: "right" });
    doc.text("PU (€)", colUnitX, y, { width: colUnitW, align: "right" });
    doc.text("Total (€)", colAmountX, y, { width: colAmountW, align: "right" });

    y += 16;
    doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
    y += 8;
    return y;
  }

  function drawRowAt(y: number, fontSize: number, lineGap: number, it: any) {
    const label = String(it.nameFR ?? "—");

    doc.fontSize(fontSize).fillColor("black").text(String(it.ref ?? "—"), colRefX, y, { width: colRefW });
    doc.text(label, colNameX, y, { width: colNameW, lineGap });
    doc.text(String(it.format ?? "—"), colFormatX, y, { width: colFormatW, align: "left" });

    doc.text(String(it.qty ?? 0), colQtyX, y, { width: colQtyW, align: "right" });
    doc.text(euros(Number(it.unit ?? 0)), colUnitX, y, { width: colUnitW, align: "right" });

    const amount = Math.round(Number(it.qty ?? 0) * Number(it.unit ?? 0));
    doc.text(euros(amount), colAmountX, y, { width: colAmountW, align: "right" });

    const labelH = doc.heightOfString(label, { width: colNameW, lineGap });
    const rowH = Math.max(labelH, fontSize + 2);
    return rowH + 3;
  }

  // Bloc “légal + signature” calqué devis (sans IBAN/BIC ici)
  const legalSignedBefore = `Bon pour accord : Confirmé
Signataire : ${signerFull}${signerRole ? ` — ${signerRole}` : ""}
Signé le : ${signedAtLabel}

Signature :`;

  const legalSignedAfter = `Conditions et obligations :
1) Objet : le présent contrat encadre la mise à disposition des articles listés ci-dessus par SEIKAN GALLERY (le Déposant) au Client (le Dépositaire) pour une durée déterminée.
2) Durée : les articles sont confiés du jour du dépôt jusqu’à la date de récupération indiquée. À l’issue de cette période, le Dépositaire s’engage à restituer l’intégralité des articles invendus, sans frais.
3) Conservation : le Dépositaire doit conserver les articles dans des conditions normales, éviter toute détérioration, perte ou vol, et prendre toute mesure raisonnable de protection.
4) Détérioration / perte : tout article restitué abîmé, détérioré, manquant ou perdu sera dû au Déposant par le Dépositaire, au prix unitaire dépôt indiqué dans le tableau.
5) Invendus : les articles non vendus et restitués dans leur état d’origine sont repris par le Déposant sans frais pour le Dépositaire.
6) Prix : le prix unitaire dépôt est indiqué par article. Ce prix sert de base en cas de perte/dégradation et/ou pour le règlement des articles non restitués.
7) Signature : la signature du Dépositaire vaut acceptation pleine et entière des présentes conditions.`;

  const legalUnsigned = `Si ce contrat vous convient, veuillez le signer et le dater en marquant "Lu et approuvé. Bon pour Accord.".

Signature / Date :



Conditions et obligations :
1) Objet : le présent contrat encadre la mise à disposition des articles listés ci-dessus par SEIKAN GALLERY (le Déposant) au Client (le Dépositaire) pour une durée déterminée.
2) Durée : les articles sont confiés du jour du dépôt jusqu’à la date de récupération indiquée. À l’issue de cette période, le Dépositaire s’engage à restituer l’intégralité des articles invendus, sans frais.
3) Conservation : le Dépositaire doit conserver les articles dans des conditions normales, éviter toute détérioration, perte ou vol, et prendre toute mesure raisonnable de protection.
4) Détérioration / perte : tout article restitué abîmé, détérioré, manquant ou perdu sera dû au Déposant par le Dépositaire, au prix unitaire dépôt indiqué dans le tableau.
5) Invendus : les articles non vendus et restitués dans leur état d’origine sont repris par le Déposant sans frais pour le Dépositaire.
6) Prix : le prix unitaire dépôt est indiqué par article. Ce prix sert de base en cas de perte/dégradation et/ou pour le règlement des articles non restitués.
7) Signature : la signature du Dépositaire vaut acceptation pleine et entière des présentes conditions.`;

  // ====== Pagination table (calque devis) ======
  const TABLE_FONT_MAX = 9.5;
  const TABLE_FONT_MIN = 7.6;

  function measureRowsHeight(fontSize: number, lineGap: number) {
    let h = 0;
    doc.fontSize(fontSize);
    for (const it of rawItems) {
      const label = String(it.nameFR ?? "—");
      const labelH = doc.heightOfString(label, { width: colNameW, lineGap });
      const rowH = Math.max(labelH, fontSize + 2);
      h += rowH + 3;
    }
    return h;
  }

  // Estimation layout page1
  doc.fontSize(10);
  const gapCols = 30;
  const colW = (usableW - gapCols) / 2;
  const issuerH = doc.heightOfString(issuerLines, { width: colW, lineGap: 2 });
  const destH = doc.heightOfString(destText, { width: colW, lineGap: 2 });
  const baseColsY = titleY + 28;
  let yAfterHeaderEst = baseColsY + 16 + Math.max(issuerH, destH) + 18;
  yAfterHeaderEst += 58;
  const yTableStart = yAfterHeaderEst + 12;

  // Réserve totaux + légal
  const totalsReserve = 70; // 2 lignes
  doc.fontSize(8);
  const legalBaseH = doc.heightOfString(signedOk ? (legalSignedBefore + "\n\n" + legalSignedAfter) : legalUnsigned, {
    width: usableW,
    lineGap: 2,
  });

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

  // Helpers “totaux”
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

  // =========================
  // MODE A : 1 PAGE
  // =========================
  if (singlePagePossible) {
    drawPageBase();
    const { yAfterHeader } = drawFullHeader();

    let y = yAfterHeader + 12;
    y = drawTableHeader(y);

    for (const it of rawItems) {
      y += drawRowAt(y, singleTableFont, singleTableLineGap, it);
    }

    y += 4;
    doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
    y += 10;

        // Totaux (dépôt-vente) — ✅ écriture unique (anti-chevauchement)
    const totalsX = left + (usableW - (320 + 110)) / 2;

    doc.save();
    doc.font("baseBold").fontSize(10).fillColor("black");
    doc.text("Récapitulatif", totalsX, y, { width: 430, align: "left" });
    y += 16;

    doc.font("base").fontSize(10).fillColor("black");
    doc.text(`Total articles : ${totalQty}`, totalsX, y, { width: 320, align: "left" });
    doc.text(`${centsToEurosStr(totalValue)} €`, totalsX + 320, y, { width: 110, align: "right" });
    y += 18;
    doc.restore();

    y += 6;

    // Légal + signature (calque devis : shrink si besoin + image)
    const legalBottomY = FOOTER_SAFE_TOP - 6;

    let legalFont = 8;
    let legalLineGap = 2;

    const sigReserveH = signedOk ? 74 : 0;
    const sigGap = signedOk ? 8 : 0;

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

    doc.fontSize(legalFont).fillColor("#111");

    if (!signedOk) {
      doc.text(legalUnsigned, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });
    } else {
      doc.text(legalSignedBefore, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });

      const imgBufRaw = decodeDataUrlToPngBuffer(String(signature?.signatureDataUrl || ""));
      if (imgBufRaw) {
        const imgBuf = tryTrimSignaturePng(imgBufRaw);

        const sigW = 240;
        const sigH = 64;
        const sigX = left + 2;
        const sigY = doc.y + 6;

        try {
          doc.image(imgBuf, sigX, sigY, { fit: [sigW, sigH] });
        } catch {
          // ignore
        }

        doc.y = sigY + sigH + 6;
      }

      doc.text("\n" + legalSignedAfter, left, doc.y, { width: usableW, lineGap: legalLineGap, align: "left" });
    }

    drawFooter(1, 1);

    doc.end();
    const pdfBuffer = await done;
    const body = new Uint8Array(pdfBuffer);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Depot-vente-${String((c as any).number ?? "DEPOT")}${signedOk ? "-SIGNE" : ""}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // =========================
  // MODE B : SPLIT (table déborde)
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
        const { yAfterHeader } = drawFullHeader();
        yStart = yAfterHeader + 12;
      } else {
        yStart = 100;
      }

      let y = drawTableHeader(yStart);

      for (const it of opts.items) {
        y += drawRowAt(y, splitTableFont, splitLineGap, it);
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

        const labelH = doc.heightOfString(String(it.nameFR ?? "—"), { width: colNameW, lineGap: splitLineGap });
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
      const labelH = doc.heightOfString(String(it.nameFR ?? "—"), { width: colNameW, lineGap: splitLineGap });
      const rowH = Math.max(labelH, splitTableFont + 2) + 3;
      y += rowH;
    }

    y += 18;

    const totalsH = 70;

    doc.fontSize(8);
    const legalH = doc.heightOfString(signedOk ? (legalSignedBefore + "\n\n" + legalSignedAfter) : legalUnsigned, {
      width: usableW,
      lineGap: 2,
    });

    return y + totalsH + legalH <= FOOTER_SAFE_TOP - 6;
  }

  const fitOnLast = canFitTotalsAndLegalOnLastTablePage();

  if (!fitOnLast) {
    pages.push(() => {
      drawPageBase();
      // pas de header répétitif (comme devis)
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
          const labelH = doc.heightOfString(String(it.nameFR ?? "—"), { width: colNameW, lineGap: splitLineGap });
          const rowH = Math.max(labelH, splitTableFont + 2) + 3;
          y += rowH;
        }

        y += 18;
      } else {
        y = 110;
      }

      // Totaux (stable)
      const totalsX = left + (usableW - (320 + 110)) / 2;
      doc.font("baseBold").fontSize(10).fillColor("black");
      doc.text("Récapitulatif", totalsX, y, { width: 430, align: "left" });
      y += 16;

      doc.font("base").fontSize(10).fillColor("black");
      doc.text(`Total articles : ${totalQty}`, totalsX, y, { width: 320, align: "left" });
      doc.text(`${centsToEurosStr(totalValue)} €`, totalsX + 320, y, { width: 110, align: "right" });
      y += 18;

      // Légal + signature (shrink + image)
      const legalBottomY = FOOTER_SAFE_TOP - 6;

      let legalFont = 8;
      let legalLineGap = 2;

      const sigReserveH = signedOk ? 74 : 0;
      const sigGap = signedOk ? 8 : 0;

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

      doc.fontSize(legalFont).fillColor("#111");

      if (!signedOk) {
        doc.text(legalUnsigned, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });
      } else {
        doc.text(legalSignedBefore, left, y, { width: usableW, lineGap: legalLineGap, align: "left" });

        const imgBufRaw = decodeDataUrlToPngBuffer(String(signature?.signatureDataUrl || ""));
        if (imgBufRaw) {
          const imgBuf = tryTrimSignaturePng(imgBufRaw);

          const sigW = 240;
          const sigH = 64;
          const sigX = left + 2;
          const sigY = doc.y + 6;

          try {
            doc.image(imgBuf, sigX, sigY, { fit: [sigW, sigH] });
          } catch {
            // ignore
          }

          doc.y = sigY + sigH + 6;
        }

        doc.text("\n" + legalSignedAfter, left, doc.y, { width: usableW, lineGap: legalLineGap, align: "left" });
      }
    }

    drawFooter(idx + 1, totalPages);
  }

  doc.end();

  const pdfBuffer = await done;
  const body = new Uint8Array(pdfBuffer);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Depot-vente-${String((c as any).number ?? "DEPOT")}${signedOk ? "-SIGNE" : ""}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
