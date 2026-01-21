// src/app/api/exports/prospects.pdf/route.ts
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const prospects = await prisma.prospect.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });

  const fontPath = path.join(
    process.cwd(),
    "src",
    "assets",
    "fonts",
    "DejaVuSans.ttf"
  );

  if (!fs.existsSync(fontPath)) {
    return NextResponse.json(
      { error: `Police introuvable: ${fontPath}` },
      { status: 500 }
    );
  }

  // ✅ A4 paysage pour un tableau large
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 36,
    autoFirstPage: false,
    font: null as any,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.addPage();
  doc.registerFont("base", fontPath);
  doc.font("base");

  const title = `Export Prospects — ${new Date().toISOString().slice(0, 10)}`;
  doc.fontSize(16).text(title);
  doc.moveDown(0.8);

  // Zone disponible
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const usableW = pageW - left - right;

  // Colonnes (mêmes colonnes que ton tableau UI)
  const headers = [
    "Société",
    "Contact",
    "Service",
    "Email",
    "Téléphone",
    "Adresse",
    "Démarché le",
    "Méthode",
    "Stage",
  ];

  // ✅ largeurs “pondérées” puis normalisées à la largeur dispo
  // (Email + Adresse plus larges)
  const weights = [1.2, 1.1, 0.9, 1.6, 1.0, 1.6, 1.0, 0.9, 0.7];
  const sum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((w) => (usableW * w) / sum);

  const rowH = 16;
  const padY = 3;

  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  function ensureRoom(nextHeight: number) {
    const bottomLimit = pageH - doc.page.margins.bottom;
    if (doc.y + nextHeight > bottomLimit) {
      doc.addPage();
      doc.font("base");
      doc.fontSize(9);
      drawHeaderRow(); // répète l’en-tête en haut de chaque page
    }
  }

  function drawHeaderRow() {
    doc.fontSize(9);

    const y = doc.y;
    // fond léger (rectangle)
    doc
      .save()
      .fillColor("#F2F2F2")
      .rect(left, y - 1, usableW, rowH + 2)
      .fill()
      .restore();

    // texte
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

    // trait dessous
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

    // trait dessous
    doc
      .moveTo(left, y + rowH + 2)
      .lineTo(left + usableW, y + rowH + 2)
      .strokeColor("#EEEEEE")
      .stroke();

    doc.y = y + rowH + 6;
  }

  // ✅ En-tête
  drawHeaderRow();

  for (const p of prospects) {
    drawRow([
      p.company ?? "",
      p.name ?? "",
      p.needType ?? "",
      p.email ?? "",
      p.phone ?? "",
      p.location ?? "",
      fmt(p.eventDate ?? null),
      p.source ?? "",
      String(p.stage ?? ""),
    ]);
  }

  doc.end();

  const pdfBuffer = await done;
  const body = new Uint8Array(pdfBuffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="prospects.pdf"',
    },
  });
}
