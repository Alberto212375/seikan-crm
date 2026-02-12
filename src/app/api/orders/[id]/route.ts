import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;

    await prisma.$transaction(async (tx) => {
      // 1) docs commande
      await tx.document.deleteMany({ where: { orderId: id } });

      // 2) factures auto créées depuis cette commande (SKGL_ORDER)
      const invoices = await tx.invoice.findMany({
        where: {
          metaJson: { contains: `"orderId":"${id}"` },
        },
        select: { id: true, quoteId: true },
      });

      const invoiceIds = invoices.map((x) => x.id);
      const quoteIds = Array.from(
        new Set(invoices.map((x) => x.quoteId).filter(Boolean) as string[])
      );

      if (invoiceIds.length) {
        // docs factures
        await tx.document.deleteMany({ where: { invoiceId: { in: invoiceIds } } });

        // supprime factures (items en cascade)
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }

      // 3) ✅ si des devis sont liés à ces factures, on les supprime aussi
      if (quoteIds.length) {
        // docs devis (si ta table Document a bien quoteId)
        await tx.document.deleteMany({ where: { quoteId: { in: quoteIds } } });

        // supprime devis (items en cascade)
        await tx.quote.deleteMany({ where: { id: { in: quoteIds } } });
      }

      // 4) supprime la commande (items en cascade)
      await tx.order.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("DELETE /api/orders/[id] ERROR", e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
