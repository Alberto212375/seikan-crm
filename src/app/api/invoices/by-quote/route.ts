// src/app/api/invoices/by-quote/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const invs = await prisma.invoice.findMany({
      where: { archivedAt: null, quoteId: { not: null } },
      select: { quoteId: true },
    });

    const quoteIds = Array.from(new Set(invs.map((x) => x.quoteId).filter(Boolean))) as string[];
    return NextResponse.json({ quoteIds });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
