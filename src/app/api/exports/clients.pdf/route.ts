// src/app/api/exports/clients.pdf/route.ts
import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ Import robuste (Next peut exposer pdfkit en CJS ou en default export)
const pdfkitMod = require("pdfkit");
const PdfDoc = pdfkitMod?.default ?? pdfkitMod;

type ClientPdfRow = {
  societe: string;
  contact: string;
  service: string;
  email: string;
  telephone: string;
  adresse: string;
  clientDepuisLe: string;
  notes: string;
};

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeText(v: unknown) {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ton modèle Prisma Client (d’après l’erreur TS) ressemble à :
 * { id, type, displayName, email, phone, billingAddress, shippingAddress, notes, createdAt, updatedAt, tags }
 *
 * Ta page /clients affiche des colonnes "societe/contact/service/telephone/adresse/clientDepuisLe/notes".
 * Dans ton API /clients, tu construis probablement ces colonnes en lisant un JSON stocké dans notes.
 * Ici on fait pareil : on tente JSON.parse(notes), sinon on fallback sur champs natifs.
 */
function extractClientRow(c: any): ClientPdfRow {
  const base: ClientPdfRow = {
    societe: "",
    contact: safeText(c.displayName),
    service: "",
    email: safeText(c.email),
    telephone: safeText(c.phone),
    adresse: safeText(c.billingAddress || c.shippingAddress),
    clientDepuisLe: fmtDate(c.createdAt),
    notes: safeText(c.notes),
  };

  const rawNotes = typeof c.notes === "string" ? c.notes : "";
  try {
    const parsed = JSON.parse(rawNotes);
    if (parsed && typeof parsed === "object") {
      const p: any = parsed;
      return {
        societe: safeText(p.societe ?? base.societe),
        contact: safeText(p.contact ?? base.contact),
        service: safeText(p.service ?? base.service),
        email: safeText(p.email ?? base.email),
        telephone: safeText(p.telephone ?? base.telephone),
        adresse: safeText(p.adresse ?? base.adresse),
        clientDepuisLe: safeText(p.clientDepuisLe ?? base.clientDepuisLe),
        notes: safeText(p.notes ?? base.notes),
      };
    }
  } catch {
    // notes pas JSON => on garde base
  }

  return base;
}

function ellipsize(s: string, max = 40) {
  const t = safeText(s);
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

export async function GET() {
  const clients = await prisma.client.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });

  // ✅ Police TTF locale (évite Helvetica.afm)
  const fontPath = path.join(
    process.cwd(),
    "src",
    "assets",
    "fonts",
    "DejaVuSans.ttf"
  );

  // ✅ IMPORTANT : on empêche l’init des polices standard (Helvetica.afm) dans Next
  const doc = new PdfDoc({
    size: "A4",
    layout: "landscape",
    margin: 36,
    autoFirstPage: false,
    font: null,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ✅ On ajoute la page nous-mêmes
  doc.addPage();

  // ✅ On set notre police TTF si dispo
  if (fs.existsSync(fontPath)) {
    doc.registerFont("base", fontPath);
    doc.font("base");
  }

  const now = new Date();
  doc.fontSize(16).text(`Export Clients — ${fmtDate(now)}`);
  doc.moveDown(0.8);

  // Zone dispo
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const usableW = pageW - left - right;

  // Colonnes (8) comme la page /clients
  const headers = [
    "Société",
    "Nom du contact",
    "Service",
    "Email",
    "Téléphone",
    "Adresse",
    "Client depuis le",
    "Notes",
  ];

  // ✅ Pondérations pour tenir en paysage (Notes plus large)
  const weights = [1.15, 1.15, 0.9, 1.55, 1.0, 1.55, 1.05, 2.65];
  const sum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((w) => (usableW * w) / sum);

  const rowH = 16;
  const padY = 3;

  function ensureRoom(nextHeight: number) {
    const bottomLimit = pageH - doc.page.margins.bottom;
    if (doc.y + nextHeight > bottomLimit) {
      doc.addPage();
      if (fs.existsSync(fontPath)) {
        doc.font("base");
      }
      doc.fontSize(9);
      drawHeaderRow();
    }
  }

  function drawHeaderRow() {
    doc.fontSize(9);
    const y = doc.y;

    // fond léger
    doc
      .save()
      .fillColor("#F2F2F2")
      .rect(left, y - 1, usableW, rowH + 2)
      .fill()
      .restore();

    let x = left;
    doc.fillColor("black");
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x + 2, y + padY, {
        width: colW[i] - 4,
        height: rowH,
        ellipsis: true,
      });
      x += colW[i];
    }

    doc
      .moveTo(left, y + rowH + 2)
      .lineTo(left + usableW, y + rowH + 2)
      .strokeColor("#D0D0D0")
      .stroke();

    doc.y = y + rowH + 6;
  }

  function drawRow(cells: string[]) {
    ensureRoom(rowH + 8);

    const y = doc.y;
    let x = left;
    doc.fontSize(9).fillColor("black");

    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i] ?? "", x + 2, y + padY, {
        width: colW[i] - 4,
        height: rowH,
        ellipsis: true,
      });
      x += colW[i];
    }

    doc
      .moveTo(left, y + rowH + 2)
      .lineTo(left + usableW, y + rowH + 2)
      .strokeColor("#EEEEEE")
      .stroke();

    doc.y = y + rowH + 6;
  }

  drawHeaderRow();

  for (const c of clients) {
    const r = extractClientRow(c);

    drawRow([
      ellipsize(r.societe, 28),
      ellipsize(r.contact, 28),
      ellipsize(r.service, 18),
      ellipsize(r.email, 34),
      ellipsize(r.telephone, 20),
      ellipsize(r.adresse, 36),
      ellipsize(r.clientDepuisLe, 12),
      ellipsize(r.notes, 40),
    ]);
  }

  doc.end();

  const pdfBuffer = await done;
  const body = new Uint8Array(pdfBuffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="clients.pdf"',
    },
  });
}
