// src/app/(crm)/factures/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type InvoiceListRow = {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  issuedAt: string | null;
  currency: string;
  totalHT: number;

  depositPaid: boolean;
  depositPaidAmount: number;

  // ✅ pour afficher PRO/PART dans la liste
  isProfessional: boolean;

  client: { id: string; displayName: string };
  quote: { id: string; number: string } | null;
};

type InvoiceItem = {
  id: string;
  label: string;
  qty: number;
  unitPrice: number;
  sort: number;
};

type InvoiceDetail = {
  id: string;
  number: string;
  status: string;
  issuedAt: string | null;
  currency: string;

  totalHT: number;
  depositPct: number;
  depositHT: number;
  depositPaid: boolean;
  depositPaidAmount: number;

  metaJson: string | null;

  items: InvoiceItem[];
  client: { id: string; displayName: string };
  quote: { id: string; number: string } | null;
};

function centsToEurosStr(c: number) {
  return (c / 100).toFixed(2).replace(".", ",");
}
function fmtDateFR(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

type InvoiceMeta = Partial<{
  discountMode: "PCT" | "EUR" | null;
  discountPct: number;
  discountEuros: number;
  penalty40: boolean;
  penaltyExtraEuros: number;
}>;

function safeMeta(s: string | null): InvoiceMeta {
  if (!s) return {};
  try {
    return JSON.parse(s) as InvoiceMeta;
  } catch {
    return {};
  }
}

// ✅ lit le PRO/PART depuis metaJson.invoice -> fromQuoteMetaJson -> party.isProfessional
function getIsProFromInvoiceMeta(metaJson: string | null): boolean {
  const invMeta: any = safeMeta(metaJson) as any;
  const fromQuoteMetaJson = invMeta?.fromQuoteMetaJson ?? null;
  if (!fromQuoteMetaJson) return false;

  try {
    const quoteMeta = JSON.parse(fromQuoteMetaJson);
    return Boolean(quoteMeta?.party?.isProfessional);
  } catch {
    return false;
  }
}

function TypeBadge({ isPro }: { isPro: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${
        isPro ? "bg-emerald-600" : "bg-blue-600"
      }`}
    >
      {isPro ? "PRO" : "PART"}
    </span>
  );
}

export default function FacturationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open") || "";

  const detailRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InvoiceListRow[]>([]);

  const [detailLoading, setDetailLoading] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);

  // UI remise
  const [discountMode, setDiscountMode] = useState<"PCT" | "EUR">("PCT");
  const [discountPct, setDiscountPct] = useState<string>("0");
  const [discountEuros, setDiscountEuros] = useState<string>("0");

  // UI pénalité
  const [penalty40, setPenalty40] = useState<boolean>(false);
  const [penaltyExtra, setPenaltyExtra] = useState<string>("0");

  async function refreshIssuedList() {
    const r = await fetch("/api/invoices", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRows((j.invoices ?? []) as InvoiceListRow[]);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/invoices", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setRows((j.invoices ?? []) as InvoiceListRow[]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function loadInvoice(id: string) {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/invoices/${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error ?? "Erreur chargement facture");
        return;
      }
      const inv = j.invoice as InvoiceDetail;
      setInvoice(inv);

      // hydrate UI depuis metaJson
      const meta = safeMeta(inv.metaJson);
      const mMode = (meta.discountMode ?? "PCT") as "PCT" | "EUR";
      setDiscountMode(mMode);
      setDiscountPct(String(meta.discountPct ?? 0).replace(".", ","));
      setDiscountEuros(String(meta.discountEuros ?? 0).replace(".", ","));

      setPenalty40(Boolean(meta.penalty40 ?? false));
      setPenaltyExtra(String(meta.penaltyExtraEuros ?? 0).replace(".", ","));

      // ✅ scroll vers le détail quand on ouvre
      setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!openId) {
      setInvoice(null);
      return;
    }
    void loadInvoice(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const restToPayHT = useMemo(() => {
    if (!invoice) return 0;
    return invoice.depositPaid ? Math.max(0, invoice.totalHT - (invoice.depositPaidAmount || 0)) : invoice.totalHT;
  }, [invoice]);

  async function updateItem(itemId: string, patch: { label?: string; qty?: number; unitPriceEuros?: string }) {
    if (!invoice) return;
    const r = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updateItem: {
          itemId,
          label: patch.label,
          qty: patch.qty,
          unitPriceEuros: patch.unitPriceEuros,
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur édition ligne");
      return;
    }
    await loadInvoice(invoice.id);
  }
    async function removeItem(itemId: string) {
    if (!invoice) return;
    if (!confirm("Supprimer cette ligne de facture ?")) return;

    const r = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        removeItem: { itemId },
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur suppression ligne");
      return;
    }

    await loadInvoice(invoice.id);
  }

  async function applyDiscount() {
    if (!invoice) return;
    const r = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applyDiscount: true,
        discountMode,
        discountPct,
        discountEuros,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur application remise");
      return;
    }
    await loadInvoice(invoice.id);
  }

  async function applyPenalty() {
    if (!invoice) return;
    const r = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applyPenalty: true,
        penalty40,
        penaltyExtraEuros: penaltyExtra,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur application pénalité");
      return;
    }
    await loadInvoice(invoice.id);
  }

  // ✅ Générer PDF = émettre + ouvrir PDF + refresh liste
  async function generatePdf() {
    if (!invoice) return;

    const r = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generatePdf: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur génération PDF");
      return;
    }

    await refreshIssuedList();
    await loadInvoice(invoice.id);

    window.open(`/api/exports/invoices/${invoice.id}/pdf`, "_blank");
  }

  async function archiveFromRow(invoiceId: string) {
    if (!confirm("Archiver cette facture + le devis lié ?")) return;

    const r = await fetch(`/api/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur archivage");
      return;
    }

    await refreshIssuedList();

    // si on avait cette facture ouverte, on ferme
    if (openId === invoiceId) router.push("/facturation");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Facturation</h1>
          <p className="mt-1 text-neutral-600">
            Liste des factures émises + détail (brouillon) + remise + pénalité + génération PDF.
          </p>
        </div>
      </div>

      {/* LISTE (factures émises uniquement) */}
      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
  <tr>
    <th className="px-4 py-3 w-[180px]">N° Facture</th>
    <th className="px-4 py-3 w-[120px]">Date</th>
    <th className="px-4 py-3 w-[80px]">Type</th>
    <th className="px-4 py-3">Client</th>
    <th className="px-4 py-3 w-[160px]">Total facture</th>
    <th className="px-4 py-3 w-[320px] text-right">Actions</th>
  </tr>
</thead>
            <tbody>
              {loading ? (
                <tr className="border-t">
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    Chargement…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr className="border-t">
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    Aucune facture émise pour l’instant.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
  <tr key={r.id} className="border-t">
    <td className="px-4 py-3 font-medium tabular-nums">{r.number}</td>
    <td className="px-4 py-3">{fmtDateFR(r.issuedAt ?? r.createdAt)}</td>

    {/* ✅ Type PRO / PART */}
    <td className="px-4 py-3">
      <TypeBadge isPro={Boolean(r.isProfessional)} />
    </td>

    <td className="px-4 py-3">{r.client?.displayName ?? "—"}</td>
    <td className="px-4 py-3 tabular-nums">{centsToEurosStr(r.totalHT)} €</td>

    <td className="px-4 py-3">
      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-xl border px-3 py-2 text-xs"
          onClick={() => router.push(`/facturation?open=${encodeURIComponent(r.id)}`)}
        >
          Ouvrir
        </button>
        <a
          className="rounded-xl border px-3 py-2 text-xs"
          href={`/api/exports/invoices/${r.id}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          PDF
        </a>
        <button className="rounded-xl border px-3 py-2 text-xs" onClick={() => archiveFromRow(r.id)}>
          Archiver
        </button>
      </div>
    </td>
  </tr>
))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAIL (brouillon/édition) */}
      {openId && (
        <div ref={detailRef} className="rounded-2xl border bg-white p-4 shadow-sm">
          {detailLoading || !invoice ? (
            <div className="text-sm text-neutral-500">Chargement facture…</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold tabular-nums">{invoice.number}</div>
                  <div className="mt-1 text-sm text-neutral-600">
                    Client : <span className="font-medium text-neutral-900">{invoice.client?.displayName ?? "—"}</span>{" "}
<TypeBadge isPro={getIsProFromInvoiceMeta(invoice.metaJson)} />
                    {invoice.quote?.number ? (
                      <>
                        {" "}
                        · Devis lié : <span className="font-medium text-neutral-900 tabular-nums">{invoice.quote.number}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Statut : <span className="font-medium">{invoice.status}</span>{" "}
                    {invoice.issuedAt ? <>· Émise le {fmtDateFR(invoice.issuedAt)}</> : <>· Brouillon (non émise)</>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button className="rounded-xl border px-3 py-2 text-xs" onClick={() => router.push("/facturation")}>
                    Fermer
                  </button>
                </div>
              </div>

              {/* Totaux */}
              <div className="grid gap-2 md:grid-cols-3 text-sm">
                <div className="rounded-xl border p-3">
                  <div className="text-neutral-500">Total facture</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{centsToEurosStr(invoice.totalHT)} €</div>
                </div>

                <div className="rounded-xl border p-3">
                  <div className="text-neutral-500">Arrhes (info devis)</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {centsToEurosStr(invoice.depositPaidAmount || invoice.depositHT)} €
                  </div>
                  <div className="mt-2 text-xs">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-white ${
                        invoice.depositPaid ? "bg-emerald-600" : "bg-neutral-500"
                      }`}
                    >
                      {invoice.depositPaid ? "Arrhes versées" : "Arrhes non versées"}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border p-3">
                  <div className="text-neutral-500">Reste à payer</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{centsToEurosStr(restToPayHT)} €</div>
                </div>
              </div>

              {/* ✅ Pénalité : uniquement si arrhes NON versées */}
              {!invoice.depositPaid && (
                <div className="rounded-2xl border p-4">
                  <div className="text-sm font-medium">Pénalité retard de paiement</div>
                  <div className="mt-2 text-xs text-neutral-600">
                    (L.441-10 / D.441-5) — tu peux appliquer 40€ + un montant libre en complément.
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm md:col-span-1">
                      <input type="checkbox" checked={penalty40} onChange={(e) => setPenalty40(e.target.checked)} />
                      <span>Appliquer 40 €</span>
                    </label>

                    <label className="text-sm md:col-span-1">
                      <span className="text-neutral-600">Complément libre (€)</span>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                        value={penaltyExtra}
                        onChange={(e) => setPenaltyExtra(e.target.value)}
                        placeholder="0"
                      />
                    </label>

                    <div className="flex items-end md:col-span-1">
                      <button className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white" onClick={applyPenalty}>
                        Appliquer la pénalité
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ✅ Remise commerciale : % OU € */}
              <div className="rounded-2xl border p-4">
                <div className="text-sm font-medium">Remise commerciale</div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-sm">
                    <span className="text-neutral-600">Mode</span>
                    <select
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={discountMode}
                      onChange={(e) => setDiscountMode(e.target.value as any)}
                    >
                      <option value="PCT">En %</option>
                      <option value="EUR">En €</option>
                    </select>
                  </label>

                  {discountMode === "PCT" ? (
                    <label className="text-sm">
                      <span className="text-neutral-600">Pourcentage</span>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                        value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        placeholder="Ex: 7,5"
                      />
                    </label>
                  ) : (
                    <label className="text-sm">
                      <span className="text-neutral-600">Montant (€)</span>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                        value={discountEuros}
                        onChange={(e) => setDiscountEuros(e.target.value)}
                        placeholder="Ex: 15"
                      />
                    </label>
                  )}

                  <div className="flex items-end">
                    <button className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white" onClick={applyDiscount}>
                      Appliquer la remise
                    </button>
                  </div>
                </div>
              </div>

              {/* Lignes */}
              <div className="rounded-2xl border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="bg-neutral-50 text-left text-neutral-600">
  <tr>
    <th className="px-4 py-3">Désignation</th>
    <th className="px-4 py-3 w-[120px]">Qté</th>
    <th className="px-4 py-3 w-[160px]">PU HT</th>
    <th className="px-4 py-3 w-[160px]">Total</th>
    <th className="px-4 py-3 w-[120px] text-right">Actions</th>
  </tr>
</thead>
                    <tbody>
                      {invoice.items
                        .slice()
                        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
                        .map((it) => {
                          const rowTotal = Math.round((it.qty ?? 0) * (it.unitPrice ?? 0));
                          return (
                            <tr key={it.id} className="border-t align-top">
                              <td className="px-4 py-2">
                                <input
                                  className="w-full rounded-xl border px-3 py-2"
                                  defaultValue={it.label}
                                  onBlur={(e) => updateItem(it.id, { label: e.target.value })}
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  className="w-full rounded-xl border px-3 py-2"
                                  type="number"
                                  min={0}
                                  defaultValue={String(it.qty ?? 0)}
                                  onBlur={(e) => updateItem(it.id, { qty: Math.max(0, Number(e.target.value || 0)) })}
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  className="w-full rounded-xl border px-3 py-2"
                                  defaultValue={centsToEurosStr(it.unitPrice ?? 0)}
                                  onBlur={(e) => updateItem(it.id, { unitPriceEuros: e.target.value })}
                                />
                              </td>
                              <td className="px-4 py-2 tabular-nums">{centsToEurosStr(rowTotal)} €</td>

<td className="px-4 py-2 text-right">
  <button
    type="button"
    className="rounded-xl border px-3 py-2 text-xs"
    onClick={() => removeItem(it.id)}
  >
    Suppr
  </button>
</td>
</tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ✅ Générer le PDF (à la place d’Archiver) */}
              <div className="flex justify-end">
                <button className="rounded-xl bg-black px-4 py-2 text-sm text-white" onClick={generatePdf}>
                  Générer le PDF
                </button>
              </div>

              <div className="text-xs text-neutral-500">
                “Générer le PDF” = la facture passe en “ISSUED” et apparaît dans la liste en haut. L’archivage se fait depuis la ligne de la liste.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
