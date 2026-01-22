// src/app/api/archives/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {

  try {
    // On prend les devis archivés, et on récupère la facture archivée liée s'il y en a une
    const quotes = await prisma.quote.findMany({
      where: { archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      select: {
  id: true,
  number: true,
  createdAt: true,
  archivedAt: true,
  totalHT: true,
  depositPaid: true,
  depositPaidAmount: true,

  // ✅ pour savoir PRO/PART via party.isProfessional
  metaJson: true,

  client: { select: { id: true, displayName: true } },
  invoices: {
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      totalHT: true,
      issuedAt: true,
      archivedAt: true,
    },
  },
},
    });

    return NextResponse.json({ quotes });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
