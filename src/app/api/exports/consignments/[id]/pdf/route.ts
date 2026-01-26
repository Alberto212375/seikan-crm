// src/app/api/exports/consignments/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pdfkitMod = require("pdfkit");
const PdfDoc = pdfkitMod?.default ?? pdfkitMod;

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

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  const url = new URL(req.url);
  const wantSigned = url.searchParams.get("signed") === "1";

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

  const isSigned = (c.status === "SIGNED") || (wantSigned && Boolean(c.signedAt));

  const totalQty = (c.items ?? []).reduce(
  (s: number, it: { qty: number | null }) => s + (it.qty || 0),
  0
);

const totalValue = (c.items ?? []).reduce(
  (s: number, it: { qty: number | null; unitPrice: number | null }) =>
    s + (it.qty || 0) * (it.unitPrice || 0),
  0
);

  const doc = new PdfDoc({
    size: "A4",
    margin: 48,
    info: { Title: `Depot-vente ${c.number}` },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // --- Header
  doc.font("Helvetica-Bold").fontSize(18).text("SEIKAN GALLERY", { align: "left" });
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(10).fillColor("#444444").text("5 Rue de Normandie — 91210 Draveil");
  doc.text("SIRET 90051575000025 — seikan.gallery@gmail.com — 06 10 38 02 08");
  doc.fillColor("#000000");

  doc.moveDown(1.0);
  doc.font("Helvetica-Bold").fontSize(16).text("Contrat de dépôt-vente", { align: "left" });
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(11).text(`Référence : ${c.number}`);
  doc.text(`Date de dépôt : ${fmtDateFR(c.depositDate)}`);
  doc.text(`Date de récupération : ${fmtDateFR(c.recoveryDate)} (durée : ${c.periodDays} jours)`);

  if (isSigned) {
    doc.moveDown(0.25);
    doc.font("Helvetica-Bold").fontSize(11).text(`Statut : SIGNÉ le ${fmtDateFR(c.signedAt || new Date())}`);
  }

  doc.moveDown(1.0);

  // --- Client block
  doc.font("Helvetica-Bold").fontSize(12).text("Dépositaire (Client)");
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(11).text(c.clientName || c.client?.displayName || "—");
  if (c.clientEmail) doc.text(c.clientEmail);
  if (c.clientPhone) doc.text(c.clientPhone);
  if (c.clientAddress) doc.text(c.clientAddress);

  doc.moveDown(1.0);

  // --- Items table
  doc.font("Helvetica-Bold").fontSize(12).text("Articles déposés");
  doc.moveDown(0.5);

  const startX = doc.x;
  const startY = doc.y;

  const col = {
    ref: startX,
    fmt: startX + 95,
    name: startX + 165,
    qty: startX + 380,
    pu: startX + 430,
    total: startX + 505,
  };

  // header row
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Référence", col.ref, startY);
  doc.text("Format", col.fmt, startY);
  doc.text("Nom (FR)", col.name, startY);
  doc.text("Qté", col.qty, startY, { width: 40, align: "right" });
  doc.text("PU (€)", col.pu, startY, { width: 60, align: "right" });
  doc.text("Total (€)", col.total, startY, { width: 70, align: "right" });

  doc.moveTo(startX, startY + 14).lineTo(startX + 520, startY + 14).strokeColor("#dddddd").stroke();
  doc.strokeColor("#000000");

  let y = startY + 22;
  doc.font("Helvetica").fontSize(10);

  for (const it of (c.items ?? []) as Array<{ ref: string | null; format: string | null; nameFR: string | null; qty: number | null; unitPrice: number | null }>) {
    const rowTotal = (it.qty || 0) * (it.unitPrice || 0);

    // saut page si besoin
    if (y > 720) {
      doc.addPage();
      y = 72;
    }

    doc.text(it.ref || "—", col.ref, y);
    doc.text(it.format || "—", col.fmt, y);
    doc.text(it.nameFR || "—", col.name, y, { width: 200 });
    doc.text(String(it.qty || 0), col.qty, y, { width: 40, align: "right" });
    doc.text(centsToEurosStr(it.unitPrice || 0), col.pu, y, { width: 60, align: "right" });
    doc.text(centsToEurosStr(rowTotal), col.total, y, { width: 70, align: "right" });

    y += 18;
  }

  doc.moveDown(1.0);
  doc.y = Math.max(doc.y, y + 10);

  doc.font("Helvetica-Bold").fontSize(11).text(`Total articles : ${totalQty}`);
  doc.text(`Valeur totale (au prix dépôt) : ${centsToEurosStr(totalValue)} €`);
  doc.moveDown(1.0);

  // --- Legal clauses
  doc.font("Helvetica-Bold").fontSize(12).text("Conditions et obligations");
  doc.moveDown(0.4);

  doc.font("Helvetica").fontSize(10).fillColor("#111111");

  const clauses = [
    "1) Objet : le présent contrat encadre la mise à disposition des articles listés ci-dessus par SEIKAN GALLERY (le Déposant) au Client (le Dépositaire) pour une durée déterminée.",
    "2) Durée : les articles sont confiés du jour du dépôt jusqu’à la date de récupération indiquée. À l’issue de cette période, le Dépositaire s’engage à restituer l’intégralité des articles invendus, sans frais.",
    "3) Conservation : le Dépositaire doit conserver les articles dans des conditions normales, éviter toute détérioration, perte ou vol, et prendre toute mesure raisonnable de protection.",
    "4) Détérioration / perte : tout article restitué abîmé, détérioré, manquant ou perdu sera dû au Déposant par le Dépositaire, au prix unitaire dépôt indiqué dans le tableau.",
    "5) Invendus : les articles non vendus et restitués dans leur état d’origine sont repris par le Déposant sans frais pour le Dépositaire.",
    "6) Prix : le prix unitaire dépôt est indiqué par article. Ce prix sert de base en cas de perte/dégradation et/ou pour le règlement des articles non restitués.",
    "7) Signature : la signature du Dépositaire vaut acceptation pleine et entière des présentes conditions.",
  ];

  for (const line of clauses) {
    doc.text(line, { width: 520, align: "justify" });
    doc.moveDown(0.35);
  }

  doc.fillColor("#000000");
  doc.moveDown(1.0);

  // --- Signature area
  const sigY = doc.y;
  if (sigY > 680) doc.addPage();

  doc.font("Helvetica-Bold").fontSize(11).text("Signatures", { align: "left" });
  doc.moveDown(0.5);

  const leftX = doc.x;
  const boxW = 250;
  const boxH = 90;

  // Déposant
  doc.font("Helvetica").fontSize(10).text("Le Déposant (SEIKAN GALLERY)", leftX, doc.y);
  doc.rect(leftX, doc.y + 12, boxW, boxH).strokeColor("#999999").stroke();
  doc.strokeColor("#000000");
  doc.text("Nom : Xavier CUZIN", leftX, doc.y + 12 + boxH + 6);

  // Dépositaire
  const rightX = leftX + 270;
  doc.text("Le Dépositaire (Client)", rightX, sigY + 16);
  doc.rect(rightX, sigY + 28, boxW, boxH).strokeColor("#999999").stroke();
  doc.strokeColor("#000000");
  doc.text(`Nom : ${c.clientName || c.client?.displayName || "—"}`, rightX, sigY + 28 + boxH + 6);

  if (isSigned) {
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(10).text(
      `Document signé le ${fmtDateFR(c.signedAt || new Date())}`,
      { align: "left" }
    );
  }

  // Footer
  doc.on("pageAdded", () => {});
  const addFooter = () => {
    const bottom = doc.page.height - 40;
    doc.font("Helvetica").fontSize(9).fillColor("#666666");
    doc.text("SEIKAN GALLERY", 48, bottom, { align: "left" });
    doc.text(`Contrat dépôt-vente ${c.number}`, 48, bottom, { align: "right" });
    doc.fillColor("#000000");
  };
  addFooter();
  doc.on("pageAdded", addFooter);

  doc.end();

  const pdfBuffer = await done;
const body = new Uint8Array(pdfBuffer);

return new NextResponse(body, {
  status: 200,
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="Depot-vente-${c.number}${isSigned ? "-SIGNE" : ""}.pdf"`,
    "Cache-Control": "no-store",
  },
});
}
