// src/app/(crm)/commandes/page.tsx
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type PosterFormat = "30x40" | "A3" | "A2";
type FormatFilter = "ALL" | PosterFormat;

type ItemAgg = {
  format: PosterFormat;
  ref: string;
  name: string;
  totalQty: number;
  clients: Array<{ clientId: string; clientName: string; qty: number }>;
};

type ClosureAgg = {
  key: string; // YYYY-MM-DD
  items: ItemAgg[];
};

type OrdersApi = {
  closures: ClosureAgg[];
};

function fmtDateFR(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d || "—";
  return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatLabel(f: PosterFormat) {
  if (f === "30x40") return "30×40";
  return f;
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ✅ Renvoie les prochaines clôtures (1er/15) à venir, limitées à "count"
function fmtDateFRLongFromIso(iso: string) {
  const d = new Date(String(iso || "").trim() + "T00:00:00");
  if (Number.isNaN(d.getTime())) return fmtDateFR(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// ✅ clé ISO YYYY-MM-DD en UTC (stable, pas de décalage 31/28)
function toIsoDateOnlyUTC(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ✅ EXACTEMENT comme dans la rédaction de devis : uniquement les 1er du mois, sur 12 mois
// ✅ mais généré en UTC pour matcher /api/orders (et éviter les fins de mois)
function next12ClosingsFirstOfMonth(from = new Date()) {
  const baseUTC = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));

  // prochaine clôture = 1er du mois (mois courant si on est le 1er, sinon mois suivant)
  let cur = new Date(Date.UTC(baseUTC.getUTCFullYear(), baseUTC.getUTCMonth(), 1));
  if (baseUTC.getTime() > cur.getTime()) {
    cur = new Date(Date.UTC(baseUTC.getUTCFullYear(), baseUTC.getUTCMonth() + 1, 1));
  }

  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + i, 1));
    const key = toIsoDateOnlyUTC(d); // ex: 2026-03-01
    out.push({ key, label: `Clôture — ${fmtDateFRLongFromIso(key)}` });
  }
  return out;
}


export default function CommandesPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OrdersApi>({ closures: [] });

  const [selectedClosure, setSelectedClosure] = useState<string>("");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("ALL");

  // détail: itemKey => open/closed
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});

    const [deletingId, setDeletingId] = useState<string>("");

  async function refreshOrders(isAlive?: () => boolean) {
  const r = await fetch("/api/orders", { cache: "no-store" });
  const j = (await r.json()) as OrdersApi;

  if (isAlive && !isAlive()) return;

  setData({ closures: Array.isArray(j?.closures) ? j.closures : [] });

    const allowed = new Set(next12ClosingsFirstOfMonth(new Date()).map((x) => x.key));
  const lastWithOrdersKey = (j?.closures?.[0]?.key ?? "") as string;

  setSelectedClosure((prev) => {
    // si déjà choisi et valide → on garde
    if (prev && allowed.has(prev)) return prev;

    // sinon, si la dernière clôture avec commandes est valide → on la prend
    if (lastWithOrdersKey && allowed.has(lastWithOrdersKey)) return lastWithOrdersKey;

    // sinon → on prend la première clôture de la liste (comme dans devis)
    return next12ClosingsFirstOfMonth(new Date())[0]?.key ?? "";
  });

}
  useEffect(() => {
  let alive = true;

  (async () => {
    try {
      setLoading(true);
      await refreshOrders(() => alive);
    } finally {
      if (alive) setLoading(false);
    }
  })();

  return () => {
    alive = false;
  };
}, []);

  const currentClosureObj = useMemo(() => {
    return data.closures.find((c) => c.key === selectedClosure) ?? null;
  }, [data.closures, selectedClosure]);

  const filteredItems = useMemo(() => {
    const items = currentClosureObj?.items ?? [];
    if (formatFilter === "ALL") return items;
    return items.filter((i) => i.format === formatFilter);
  }, [currentClosureObj, formatFilter]);

    const closureOptions = useMemo(() => {
    // ✅ UNIQUEMENT les clôtures "devis" (1er du mois, 12 mois)
    return next12ClosingsFirstOfMonth(new Date());
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold">Commandes</div>
          <div className="text-sm text-neutral-600">
            Récap des commandes (page skgl + CRM), regroupées par clôture (ou date pour les commandes test).
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-3">
        <label className="text-sm">
          <span className="text-neutral-600">Clôture</span>
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2"
            value={selectedClosure}
            onChange={(e) => setSelectedClosure(e.target.value)}
          >
            {closureOptions.length === 0 ? (
              <option value="">—</option>
            ) : (
              closureOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-neutral-600">Format</span>
          <select
            className="mt-1 w-full rounded-xl border px-3 py-2"
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
          >
            <option value="ALL">Tous les formats</option>
            <option value="30x40">30×40</option>
            <option value="A3">A3</option>
            <option value="A2">A2</option>
          </select>
        </label>

        <div className="text-sm">
          <div className="text-neutral-600">Total lignes</div>
          <div className="mt-1 rounded-xl border px-3 py-2 bg-neutral-50">
            <span className="font-medium tabular-nums">{filteredItems.length}</span>
            <span className="text-neutral-500"> articles</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-neutral-50 text-left">
              <tr className="text-neutral-600">
                <th className="px-4 py-3 w-[110px]">Format</th>
                <th className="px-4 py-3 w-[140px]">Réf</th>
                <th className="px-4 py-3">Visuel</th>
                <th className="px-4 py-3 w-[120px] text-right">Qté totale</th>
                <th className="px-4 py-3 w-[160px] text-right">Détail</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr className="border-t">
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                    Chargement…
                  </td>
                </tr>
              ) : !currentClosureObj ? (
                <tr className="border-t">
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                    Aucune commande (aucune facture issue d’un devis) pour l’instant.
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr className="border-t">
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                    Aucun article pour cette clôture / ce format.
                  </td>
                </tr>
              ) : (
                filteredItems.map((it) => {
                  const key = `${it.format}__${it.ref}`;
                  const isOpen = Boolean(openDetails[key]);
                  return (
  <Fragment key={key}>
                      <tr key={key} className="border-t align-top">
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-black px-2 py-0.5 text-[11px] font-medium text-white">
                            {formatLabel(it.format)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium tabular-nums">{it.ref}</td>
                        <td className="px-4 py-3">{it.name || "-"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className="font-semibold">{it.totalQty}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="rounded-xl border px-3 py-2 text-xs"
                            onClick={() =>
                              setOpenDetails((prev) => ({
                                ...prev,
                                [key]: !prev[key],
                              }))
                            }
                          >
                            {isOpen ? "Masquer" : "Voir détail"}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-t bg-neutral-50">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="text-xs text-neutral-600 mb-2">Détail par client</div>
                            <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                              <table className="w-full min-w-[700px] text-sm">
                                <thead className="text-left">
  <tr className="text-neutral-600">
    <th className="py-2 pr-3">Client</th>
    <th className="py-2 pr-3 w-[120px] text-right">Qté</th>
    <th className="py-2 pr-3 w-[140px] text-right">Actions</th>
  </tr>
</thead>
                                <tbody>
                                  {it.clients.length === 0 ? (
                                    <tr>
                                      <td colSpan={3} className="py-3 text-neutral-500">
  Aucun détail client.
</td>
                                    </tr>
                                  ) : (
                                    it.clients.map((c) => (
                                      <tr key={c.clientId} className="border-t border-neutral-200">
  <td className="py-2 pr-3">{c.clientName}</td>
  <td className="py-2 pr-3 text-right tabular-nums font-medium">{c.qty}</td>

  <td className="py-2 pr-3 text-right">
    <button
      type="button"
      className="rounded-xl bg-red-600 px-3 py-2 text-xs text-white disabled:opacity-60"
      disabled={deletingId === c.clientId}
      onClick={async () => {
        if (deletingId) return;
        if (!confirm("Supprimer définitivement cette commande ?\n(Cela supprimera aussi la facture et le devis liés.)")) return;

        setDeletingId(c.clientId);
        try {
          const res = await fetch(`/api/orders/${encodeURIComponent(c.clientId)}`, { method: "DELETE" });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(j?.error || "Erreur suppression");
            return;
          }

          // refresh UI
          await refreshOrders();
        } finally {
          setDeletingId("");
        }
      }}
    >
      {deletingId === c.clientId ? "Suppression…" : "Supprimer"}
    </button>
  </td>
</tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                                        </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aide */}
      {!loading && currentClosureObj && (
        <div className="mt-4 text-xs text-neutral-500">
          NB : Cette page inclut uniquement les commandes dont le devis a été transformé en facture (Invoice liée à un Quote).
        </div>
      )}
    </div>
  );
}
