import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function centsToEurosNumber(c: number): string {
  return (c / 100).toFixed(2).replace(".", ",");
}

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

type QuoteMeta = {
  outsideStandardPct?: boolean;
  discountAppliedPct?: number;
  persons?: number;
  multiPoints?: number;
  prestaChoices?: string[];
  optionsApplyToLineId?: string;
  delivery?: { address?: string; date?: string };
};

function toInt(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { items: true },
  });

  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = safeJsonParse<QuoteMeta>((quote as any).metaJson) ?? {};
  const discountPct = Math.max(0, Math.min(100, Number(meta.discountAppliedPct ?? 0) || 0));

  // Items DB (cents)
  const rawItems = (quote.items ?? []).map((it: any) => ({
    label: String(it.label ?? ""),
    qty: Math.max(1, Number(it.qty ?? 1)),
    unit: Math.max(0, Number(it.unitPrice ?? 0)), // cents
  }));

  // Si l'UI avait ajouté une ligne "Créneau..." à 0, on l'ignore en calcul et on la reconstruit proprement
  const hasPlaceholderOutside = rawItems.some(
    (x) => x.label.trim() === "Créneau hors standard (+10%)"
  );

  const itemsWithoutPlaceholder = rawItems.filter(
    (x) => x.label.trim() !== "Créneau hors standard (+10%)"
  );

  const subtotalHT = itemsWithoutPlaceholder.reduce((s, x) => s + Math.round(x.qty * x.unit), 0);

  const outsideEnabled = Boolean(meta.outsideStandardPct) || hasPlaceholderOutside;
  const outsideSurcharge = outsideEnabled ? Math.round(subtotalHT * 0.1) : 0;

  const beforeDiscount = subtotalHT + outsideSurcharge;
  const discountAmount = discountPct > 0 ? Math.round((beforeDiscount * discountPct) / 100) : 0;

  const totalHTRebuilt = beforeDiscount - discountAmount;

  const depositPct = toInt((quote as any).depositPct ?? 35, 35);
  const depositHT = Math.round((totalHTRebuilt * depositPct) / 100);
  const balanceHT = totalHTRebuilt - depositHT;

  const lines: string[] = [];

  lines.push(["DEVIS", (quote as any).number ?? ""].join(";"));
  lines.push(["Client", (quote as any).clientName ?? ""].join(";"));
  lines.push(["Adresse", (quote as any).clientAddress ?? ""].join(";"));

  if (meta.delivery?.address || meta.delivery?.date) {
    lines.push(["Livraison", `${meta.delivery?.date ?? ""} ${meta.delivery?.address ?? ""}`.trim()].join(";"));
  }

  lines.push("");
  lines.push(["Désignation", "Quantité", "Prix U HT", "Montant HT"].join(";"));

  // Lignes principales (items DB)
  for (const it of itemsWithoutPlaceholder) {
    const amount = Math.round(it.qty * it.unit);
    lines.push(
      [it.label, String(it.qty).replace(".", ","), centsToEurosNumber(it.unit), centsToEurosNumber(amount)].join(";")
    );
  }

  // Ligne créneau hors standard (+10%) recalculée
  if (outsideSurcharge > 0) {
    lines.push(["Créneau hors standard (+10% HT)", "1", centsToEurosNumber(outsideSurcharge), centsToEurosNumber(outsideSurcharge)].join(";"));
  }

  // Ligne remise commerciale (affichée clairement)
  if (discountAmount > 0) {
    lines.push([`Remise commerciale (${String(discountPct).replace(".", ",")}%)`, "1", `-${centsToEurosNumber(discountAmount)}`, `-${centsToEurosNumber(discountAmount)}`].join(";"));
  }

  lines.push("");
  lines.push(["SOUS_TOTAL_HT", "", "", centsToEurosNumber(subtotalHT)].join(";"));
  if (outsideSurcharge > 0) lines.push(["SURCHARGE_HORS_STANDARD", "", "", centsToEurosNumber(outsideSurcharge)].join(";"));
  if (discountAmount > 0) lines.push(["REMISE_COMMERCIALE", "", "", `-${centsToEurosNumber(discountAmount)}`].join(";"));
  lines.push(["TOTAL_HT", "", "", centsToEurosNumber(totalHTRebuilt)].join(";"));
  lines.push([`ARRHES_${depositPct}%`, "", "", centsToEurosNumber(depositHT)].join(";"));
  lines.push(["SOLDE", "", "", centsToEurosNumber(balanceHT)].join(";"));

  // BOM UTF-8 pour Excel
  const csv = "\ufeff" + lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Devis_${(quote as any).number ?? "DEVIS"}.csv"`,
    },
  });
}
