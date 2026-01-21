import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const prospects = await prisma.prospect.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Prospects");

  ws.columns = [
    { header: "ID", key: "id", width: 26 },
    { header: "Société", key: "societe", width: 22 },
    { header: "Nom du contact", key: "contact", width: 22 },
    { header: "Service", key: "service", width: 18 },
    { header: "Email", key: "email", width: 26 },
    { header: "Téléphone", key: "telephone", width: 16 },
    { header: "Adresse", key: "adresse", width: 28 },
    { header: "Démarché le", key: "demarcheLe", width: 12 },
    { header: "Méthode", key: "methode", width: 18 },
    { header: "Stage", key: "stage", width: 12 },
    { header: "Créé le", key: "createdAt", width: 20 },
    { header: "Mis à jour le", key: "updatedAt", width: 20 },
  ];

  const fmtDateOnly = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : "";

  for (const p of prospects) {
    ws.addRow({
      id: p.id,
      societe: p.company ?? "",
      contact: p.name ?? "",
      service: p.needType ?? "",
      email: p.email ?? "",
      telephone: p.phone ?? "",
      adresse: p.location ?? "",
      demarcheLe: fmtDateOnly(p.eventDate ?? null),
      methode: p.source ?? "",
      stage: p.stage,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    });
  }

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="prospects.xlsx"`,
    },
  });
}
