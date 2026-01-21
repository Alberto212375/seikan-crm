import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";

function safeJsonNotes(s: string | null | undefined): any | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function GET() {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clients");

  ws.columns = [
    { header: "ID", key: "id", width: 26 },
    { header: "Société", key: "societe", width: 22 },
    { header: "Nom du contact", key: "contact", width: 22 },
    { header: "Service", key: "service", width: 18 },
    { header: "Email", key: "email", width: 26 },
    { header: "Téléphone", key: "telephone", width: 16 },
    { header: "Adresse", key: "adresse", width: 28 },
    { header: "Client depuis le", key: "clientDepuisLe", width: 14 },
    { header: "Notes", key: "notes", width: 50 },
    { header: "Créé le", key: "createdAt", width: 20 },
    { header: "Mis à jour le", key: "updatedAt", width: 20 },
  ];

  for (const c of clients) {
    const n = safeJsonNotes(c.notes);
    ws.addRow({
      id: c.id,
      societe: n?.societe ?? "",
      contact: n?.contact ?? c.displayName ?? "",
      service: n?.service ?? "",
      email: c.email ?? "",
      telephone: c.phone ?? "",
      adresse: n?.adresse ?? "",
      clientDepuisLe:
        n?.clientDepuisLe ?? c.createdAt.toISOString().slice(0, 10),
      notes: n?.notes ?? (typeof c.notes === "string" ? c.notes : ""),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    });
  }

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="clients.xlsx"`,
    },
  });
}
