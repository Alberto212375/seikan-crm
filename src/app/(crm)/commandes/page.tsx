// src/app/(crm)/commandes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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
function nextClosureKeys(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // on démarre au mois courant et on avance jusqu'à avoir assez de clôtures
  for (let i = 0; i < 14 && out.length < count; i++) {
    const base = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const d1 = new Date(base.getFullYear(), base.getMonth(), 1);
    const d15 = new Date(base.getFullYear(), base.getMonth(), 15);

    [d1, d15].forEach((d) => {
      d.setHours(0, 0, 0, 0);
      if (d.getTime() >= now.getTime()) out.push(isoDateOnly(d));
    });
  }

  // tri croissant + limite
  return out.sort((a, b) => (a < b ? -1 : 1)).slice(0, count);
}

export default function CommandesPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OrdersApi>({ closures: [] });

  const [selectedClosure, setSelectedClosure] = useState<string>("");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("ALL");

  // détail: itemKey => open/closed
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/orders", { cache: "no-store" });
        const j = (await r.json()) as OrdersApi;
        if (!alive) return;

       setData({ closures: Array.isArray(j?.closures) ? j.closures : [] });

// ✅ Par défaut : dernière clôture qui a des commandes (API triée: plus récent d'abord)
const lastWithOrdersKey = (j?.closures?.[0]?.key ?? "") as string;
setSelectedClosure((prev) => prev || lastWithOrdersKey);

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
  // clés qui ont déjà des commandes (issues API)
  const existingKeys = new Set(data.closures.map((c) => c.key));

  // ✅ uniquement les 2 prochaines clôtures (même si vides)
  const futureKeys = nextClosureKeys(2);

  // merge: clôtures existantes + futures (sans doublons)
  const mergedKeys = Array.from(new Set([...data.closures.map((c) => c.key), ...futureKeys]));

  // tri décroissant (plus récent en haut)
  mergedKeys.sort((a, b) => (a < b ? 1 : -1));

  return mergedKeys.map((key) => ({
    key,
    label: `Clôture — ${fmtDateFR(key)}${existingKeys.has(key) ? "" : " (à venir)"}`,
  }));
}, [data.closures]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold">Commandes</div>
          <div className="text-sm text-neutral-600">
            Récap des commandes (devis transformés en factures), regroupées par clôture (1er / 15).
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
        <div className="overflow-x-auto">
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
                    <>
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
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[700px] text-sm">
                                <thead className="text-left">
                                  <tr className="text-neutral-600">
                                    <th className="py-2 pr-3">Client</th>
                                    <th className="py-2 pr-3 w-[120px] text-right">Qté</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {it.clients.length === 0 ? (
                                    <tr>
                                      <td colSpan={2} className="py-3 text-neutral-500">
                                        Aucun détail client.
                                      </td>
                                    </tr>
                                  ) : (
                                    it.clients.map((c) => (
                                      <tr key={c.clientId} className="border-t border-neutral-200">
                                        <td className="py-2 pr-3">{c.clientName}</td>
                                        <td className="py-2 pr-3 text-right tabular-nums font-medium">{c.qty}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
