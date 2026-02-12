import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;

    await prisma.$transaction(async (tx) => {
      // docs devis
      await tx.document.deleteMany({ where: { quoteId: id } });

      // factures liées au devis + docs facture
      const invoices = await tx.invoice.findMany({ where: { quoteId: id }, select: { id: true } });
      const invoiceIds = invoices.map((x) => x.id);

      if (invoiceIds.length) {
        await tx.document.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } }); // items cascade
      }

      // quote items cascade
      await tx.quote.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("DELETE /api/quotes/[id] ERROR", e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
