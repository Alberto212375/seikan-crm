import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfkitMod = require("pdfkit");
const PdfDoc = pdfkitMod?.default ?? pdfkitMod;

type OrderMeta = {
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
function eurosCents(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

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

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { items: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = safeJsonParse<OrderMeta>((order as any).metaJson) ?? {};
  const signature = meta.signature ?? null;

  const signedOk =
    Boolean(signature?.accepted) &&
    Boolean(signature?.signedAt) &&
    typeof signature?.signatureDataUrl === "string" &&
    String(signature.signatureDataUrl).startsWith("data:image/");

  const signedAtDate = signedOk ? new Date(String(signature?.signedAt)) : null;
  const signedAtLabel = signedAtDate && !Number.isNaN(signedAtDate.getTime()) ? formatDateTimeFR(signedAtDate) : "";

  const signerFull = signedOk
    ? `${String(signature?.signerFirstName ?? "").trim()} ${String(signature?.signerLastName ?? "").trim()}`.trim()
    : "";

  const signerRole = signedOk ? (String(signature?.signerRole ?? "").trim() || "Client") : "Client";

  // PDF
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

  // 1ère page
  doc.addPage({ size: "A4", margin: 50 });

  const pageW = 595.28;
  const pageH = 841.89;
  const left = 50;
  const right = 50;
  const usableW = pageW - left - right;

  const footerY = pageH - 50 - 10;
  const FOOTER_SAFE_TOP = footerY - 18;

  drawBackgroundAndLace(doc, pageW, pageH);

  // Logo comme devis
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
    logoH = sz ? Math.round(logoW * (sz.h / sz.w)) : Math.round(logoW * 0.35);
    doc.image(logoPath, logoX, logoY, { width: logoW });
  } else {
    doc.fontSize(18).fillColor("black").text("SEIKAN GALLERY", left, logoY + 20, { width: usableW, align: "center" });
  }

  const titleY = logoY + logoH - 53;

  const hasBold = fs.existsSync(fontBoldPath);
  doc.font(hasBold ? "baseBold" : "base").fontSize(16).fillColor("black").text(
    `COMMANDE ${(order as any).number ?? ""}`,
    left,
    titleY,
    { width: usableW, align: "center" }
  );
  doc.font("base");

  const kindLabel = (order as any).kind === "TEST" ? "COMMANDE TEST" : "COMMANDE CLASSIQUE";
  doc.fontSize(11).fillColor("black").text(kindLabel, left, titleY + 20, { width: usableW, align: "center" });

  // Colonnes Émetteur / Destinataire
  const gap = 30;
  const colW = (usableW - gap) / 2;
  const leftColX = left;
  const rightColX = left + colW + gap;

  const baseColsY = titleY + 52;

  const issuerLines = [
    "SEIKAN GALLERY",
    "SIRET : 90051575000025",
    "seikan.gallery@gmail.com",
    "0610380208",
    "5 Rue de Normandie, 91210 Draveil",
  ].join("\n");

  const destLines: string[] = [];
  destLines.push(`${String((order as any).lastName ?? "").toUpperCase()} ${String((order as any).firstName ?? "").trim()}`.trim());
  if ((order as any).companyName) destLines.push(String((order as any).companyName));
  if ((order as any).siret) destLines.push(`SIRET : ${String((order as any).siret)}`);
  if ((order as any).email) destLines.push(String((order as any).email));
  destLines.push(`${String((order as any).street)}, ${String((order as any).postalCode)} ${String((order as any).city)}`);

  const destText = destLines.filter(Boolean).join("\n");

  doc.fontSize(11).fillColor("black").text("Émetteur :", leftColX, baseColsY);
  doc.fontSize(10).fillColor("black").text(issuerLines, leftColX, baseColsY + 16, { width: colW });

  doc.fontSize(11).fillColor("black").text("Destinataire :", rightColX, baseColsY, { width: colW });
  doc.fontSize(10).fillColor("black").text(destText, rightColX, baseColsY + 16, { width: colW });

  doc.fontSize(10);
  const issuerH = doc.heightOfString(issuerLines, { width: colW, lineGap: 2 });
  const destH = doc.heightOfString(destText, { width: colW, lineGap: 2 });

  let y = baseColsY + 16 + Math.max(issuerH, destH) + 18;

  // Livraison + émission + paiement avant
  doc.fontSize(11).fillColor("black").text("Livraison :", leftColX, y, { width: colW });
  doc.fontSize(10).fillColor("black").text(String((order as any).deliveryWindowLabel ?? "—"), leftColX, y + 16, {
    width: colW,
    lineBreak: false,
    ellipsis: true,
  });

  doc.fontSize(10).fillColor("black").text(`Date : ${formatDateFRShort(new Date((order as any).createdAt ?? Date.now()))}`, rightColX, y, { width: colW });
  doc.fontSize(10).fillColor("black").text(`Paiement avant le : ${formatDateFRShort(new Date((order as any).payBeforeDate))}`, rightColX, y + 16, { width: colW });

  y += 58;

  // Tableau
  const colDesignationX = left;
  const colQtyW = 55;
  const colUnitW = 95;
  const colAmountW = 110;

  const colAmountX = left + usableW - colAmountW;
  const colUnitX = colAmountX - colUnitW;
  const colQtyX = colUnitX - colQtyW;

  const colDesignationW = colQtyX - colDesignationX - 10;

  function drawTableHeader(y0: number) {
    doc.fontSize(10).fillColor("black").text("Désignation", colDesignationX, y0, { width: colDesignationW });
    doc.text("Qté", colQtyX, y0, { width: colQtyW, align: "right" });
    doc.text("PU", colUnitX, y0, { width: colUnitW, align: "right" });
    doc.text("Montant", colAmountX, y0, { width: colAmountW, align: "right" });

    y0 += 16;
    doc.moveTo(left, y0).lineTo(left + usableW, y0).stroke();
    y0 += 8;
    return y0;
  }

  y = drawTableHeader(y + 12);

  const items = (order as any).items ?? [];
  items.sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));

  doc.fontSize(9.2).fillColor("black");

  for (const it of items) {
    const isShipping = String(it.ref || "").toUpperCase() === "LIVRAISON";
const label = isShipping ? `${it.label}` : `${it.ref} — ${it.label} (30×40)`;
    const qty = Math.max(0, Number(it.qty || 0));
    const unit = Math.max(0, Number(it.unitPriceCents || 1200));
    const amount = qty * unit;

    doc.text(label, colDesignationX, y, { width: colDesignationW });
    doc.text(String(qty), colQtyX, y, { width: colQtyW, align: "right" });
    doc.text(eurosCents(unit), colUnitX, y, { width: colUnitW, align: "right" });
    doc.text(eurosCents(amount), colAmountX, y, { width: colAmountW, align: "right" });

    const h = doc.heightOfString(label, { width: colDesignationW, lineGap: 1 });
    y += Math.max(h, 12) + 3;
  }

  y += 4;
  doc.moveTo(left, y).lineTo(left + usableW, y).stroke();
  y += 12;

  // Totaux
  const total = Number((order as any).totalCents ?? 0) || items.reduce((s: number, it: any) => s + (it.qty || 0) * (it.unitPriceCents || 1200), 0);

  doc.font(hasBold ? "baseBold" : "base").fontSize(11).text(`TOTAL : ${eurosCents(total)}`, left, y, { width: usableW, align: "right" });
  doc.font("base");
  y += 18;

  // Bloc paiement + emballage
  doc.fontSize(10).fillColor("#111").text(
    `Emballage : ${(order as any).packagingLabel}\nPaiement à effectuer avant le 1er mars, sinon la commande ne sera pas lancée.`,
    left,
    y,
    { width: usableW, lineGap: 2 }
  );
  y += 40;

  // Signature
  doc.fontSize(10).fillColor("#111");
  if (!signedOk) {
    doc.text(`Bon pour accord : À signer`, left, y, { width: usableW });
  } else {
    doc.text(
      `Bon pour accord : Confirmé\nSignataire : ${signerFull}${signerRole ? ` — ${signerRole}` : ""}\nSigné le : ${signedAtLabel}\nSignature :`,
      left,
      y,
      { width: usableW, lineGap: 2 }
    );

    const imgBuf = decodeDataUrlToPngBuffer(String(signature?.signatureDataUrl || ""));
    if (imgBuf) {
      const sigW = 240;
      const sigH = 64;
      const sigX = left + 2;
      const sigY = doc.y + 6;
      doc.image(imgBuf, sigX, sigY, { fit: [sigW, sigH] });
      doc.y = sigY + sigH + 6;
    }
  }

  // --- Bloc légal / paiement (sous la signature) ---
  // On garde une marge de sécurité pour ne pas entrer dans le footer.
  const LEGAL_BLOCK = [
    "IBAN : FR76 1213 5003 0004 2562 6218 853",
    "BIC : CEPAFRPP213",
    "",
    "À défaut de règlement à réception (paiement comptant), l’exécution de la commande est suspendue jusqu’à encaissement",
    "et la livraison pourra être reportée à la clôture de commande suivante.",
    "Une indemnité forfaitaire de 40 € pour frais de recouvrement sera également exigible (articles L.441-10",
    "et D.441-5 du Code de commerce).",
    "Mentions légales :",
    "- TVA non applicable, art. 293 B du CGI",
  ].join("\n");

  // Si on est trop bas, on remonte légèrement pour rester avant le footer.
  // (PdfKit n'a pas de "page break" automatique ici, donc on sécurise.)
  const safeTop = FOOTER_SAFE_TOP - 92; // zone dispo avant footer
  if (doc.y > safeTop) {
    doc.y = safeTop;
  }

  doc
    .fontSize(8.8)
    .fillColor("#111")
    .text(LEGAL_BLOCK, left, doc.y + 10, {
      width: usableW,
      lineGap: 2,
    });

  // un petit espace après le bloc
  doc.y += 6;

  // Footer
  doc.save();
  doc.font("base").fontSize(8).fillColor("#111");

  doc.text("SEIKAN GALLERY", left, footerY, {
    width: usableW / 2,
    align: "left",
    lineBreak: false,
    ellipsis: true,
  });
  doc.text("Page 1/1", left + usableW / 2, footerY, {
    width: usableW / 2,
    align: "right",
    lineBreak: false,
    ellipsis: true,
  });
  doc.restore();

  doc.end();

  const pdfBuffer = await done;
  const body = new Uint8Array(pdfBuffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Commande_${(order as any).number ?? "CMD"}.pdf"`,
    },
  });
}
