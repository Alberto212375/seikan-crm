// src/app/(crm)/depot-vente/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

export const dynamic = "force-dynamic";

type ClientOpt = { id: string; displayName: string };

type ConsignmentRow = {
  id: string;
  number: string;
  status: string;
  client: { id: string; displayName: string };
  depositDate: string;
  recoveryDate: string;
  totalQty: number;
  emailSentAt?: string | null;
};

function fmtDateFR(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function eurosToCents(s: string) {
  const v = String(s ?? "").replace(",", ".").trim();
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// même barème que tes devis posters (adapté)
function unitPriceByFormatAndTotalQty(format: string, totalQty: number) {
  const f = format.toUpperCase().replace(/\s/g, "");
  const isA2 = f === "A2";
  const base =
    totalQty >= 50 ? 12 :
    totalQty >= 25 ? 14 :
    totalQty >= 10 ? 16 :
    18;

  return (base + (isA2 ? 8 : 0)) * 100;
}

function EmailSentBadge({ sentAt }: { sentAt?: string | null }) {
  if (!sentAt) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
      📧 Envoyé le {fmtDateFR(sentAt)}
    </span>
  );
}

export default function DepotVentePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConsignmentRow[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);

  // create form (simple et efficace)
  const [clientId, setClientId] = useState("");
  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodDays, setPeriodDays] = useState("14");
  const [recoveryDate, setRecoveryDate] = useState("");

  type DraftItem = {
    ref: string;
    format: "30×40" | "A3" | "A2";
    nameFR: string;
    qty: string;
    unitPriceEuros: string;
  };

  const [items, setItems] = useState<DraftItem[]>([
    { ref: "R-000001", format: "A3", nameFR: "", qty: "10", unitPriceEuros: "18" },
  ]);

  const totalQtyAll = useMemo(() => {
    return items.reduce((s, it) => s + Math.max(0, Number(it.qty || 0)), 0);
  }, [items]);

  function recomputeDefaultPrices() {
    // par format, selon total qty de ce format
    const byFmt: Record<string, number> = {};
    for (const it of items) {
      const q = Math.max(0, Number(it.qty || 0));
      byFmt[it.format] = (byFmt[it.format] || 0) + q;
    }

    setItems((prev) =>
      prev.map((it) => {
        const totalFmt = byFmt[it.format] || 0;
        const cents = unitPriceByFormatAndTotalQty(it.format, totalFmt);
        // on remplit seulement si vide
        const hasManual = String(it.unitPriceEuros || "").trim() !== "";
        return hasManual ? it : { ...it, unitPriceEuros: String((cents / 100).toFixed(2)).replace(".", ",") };
      })
    );
  }

  useEffect(() => {
    // recoveryDate auto
    const d = new Date(depositDate + "T00:00:00");
    if (!Number.isNaN(d.getTime())) {
      const p = Math.max(1, Number(periodDays || 1));
      const x = new Date(d);
      x.setDate(x.getDate() + p);
      setRecoveryDate(x.toISOString().slice(0, 10));
    }
  }, [depositDate, periodDays]);

  async function refresh() {
    const r = await fetch("/api/consignments", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRows((j.consignments ?? []) as ConsignmentRow[]);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // list consignments
        await refresh();

        // list clients (tu as déjà /api/clients)
        const rc = await fetch("/api/clients", { cache: "no-store" });
        const jc = await rc.json().catch(() => ({}));
        const opts = (jc.clients ?? []).map((c: any) => ({
          id: c.id,
          displayName: c.displayName ?? "—",
        }));
        if (!alive) return;
        setClients(opts);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function createConsignment() {
    if (!clientId) return alert("Choisis un client.");

    const payload = {
      clientId,
      depositDate,
      periodDays: Number(periodDays || 14),
      recoveryDate,
      items: items.map((it) => ({
        ref: it.ref,
        format: it.format,
        nameFR: it.nameFR,
        qty: Math.max(1, Number(it.qty || 1)),
        unitPrice: eurosToCents(it.unitPriceEuros),
      })),
    };

    const r = await fetch("/api/consignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return alert(j?.error ?? "Erreur création dépôt-vente");

    alert(`Dépôt-vente créé ✅ (${j?.consignment?.number || ""})`);
    await refresh();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dépôt-vente</h1>
        <p className="mt-1 text-neutral-600">
          Création, génération PDF, signature et envoi client (comme devis/factures).
        </p>
      </div>

      {/* Création */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-4">
        <div className="text-sm font-medium">Créer un dépôt-vente</div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="text-neutral-600">Client</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={loading}
            >
              <option value="">— sélectionner —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="text-neutral-600">Date de dépôt (J)</span>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={depositDate}
              onChange={(e) => setDepositDate(e.target.value)}
              disabled={loading}
            />
          </label>

          <label className="text-sm">
            <span className="text-neutral-600">Durée (jours)</span>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={periodDays}
              onChange={(e) => setPeriodDays(e.target.value)}
              disabled={loading}
            />
          </label>

          <label className="text-sm md:col-span-2">
            <span className="text-neutral-600">Date de récupération</span>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={recoveryDate}
              onChange={(e) => setRecoveryDate(e.target.value)}
              disabled={loading}
            />
          </label>

          <div className="md:col-span-2 flex items-end justify-end gap-2">
            <button
              className="rounded-xl border px-4 py-2 text-sm"
              onClick={recomputeDefaultPrices}
              disabled={loading}
            >
              Appliquer prix auto
            </button>

            <button
              className="rounded-xl bg-black px-4 py-2 text-sm text-white"
              onClick={createConsignment}
              disabled={loading}
            >
              Générer le dépôt (ligne + PDF ensuite)
            </button>
          </div>
        </div>

        {/* Items */}
        <div className="rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-600">
                <tr>
                  <th className="px-4 py-3 w-[140px]">Référence</th>
                  <th className="px-4 py-3 w-[120px]">Format</th>
                  <th className="px-4 py-3">Nom (FR)</th>
                  <th className="px-4 py-3 w-[120px]">Qté</th>
                  <th className="px-4 py-3 w-[160px]">PU dépôt (€)</th>
                  <th className="px-4 py-3 w-[120px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t align-top">
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border px-3 py-2"
                        value={it.ref}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, i) => (i === idx ? { ...x, ref: v } : x)));
                        }}
                      />
                    </td>

                    <td className="px-4 py-2">
                      <select
                        className="w-full rounded-xl border px-3 py-2"
                        value={it.format}
                        onChange={(e) => {
                          const v = e.target.value as any;
                          setItems((p) => p.map((x, i) => (i === idx ? { ...x, format: v } : x)));
                        }}
                      >
                        <option value="30×40">30×40</option>
                        <option value="A3">A3</option>
                        <option value="A2">A2</option>
                      </select>
                    </td>

                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border px-3 py-2"
                        placeholder="optionnel"
                        value={it.nameFR}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, i) => (i === idx ? { ...x, nameFR: v } : x)));
                        }}
                      />
                    </td>

                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-xl border px-3 py-2"
                        value={it.qty}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, i) => (i === idx ? { ...x, qty: v } : x)));
                        }}
                      />
                    </td>

                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border px-3 py-2"
                        value={it.unitPriceEuros}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((p) => p.map((x, i) => (i === idx ? { ...x, unitPriceEuros: v } : x)));
                        }}
                      />
                    </td>

                    <td className="px-4 py-2 text-right">
                      <button
                        className="rounded-xl border px-3 py-2 text-xs"
                        onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                      >
                        Suppr
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t bg-white px-4 py-3 flex items-center justify-between">
            <div className="text-xs text-neutral-600">
              Total quantité (tous formats) : <span className="font-medium text-neutral-900">{totalQtyAll}</span>
            </div>
            <button
              className="rounded-xl border px-3 py-2 text-xs"
              onClick={() =>
                setItems((p) => [...p, { ref: "R-000000", format: "A3", nameFR: "", qty: "10", unitPriceEuros: "" }])
              }
            >
              + Ajouter une ligne
            </button>
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-4 py-3 w-[170px]">N° Dépôt</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 w-[140px]">Date dépôt</th>
                <th className="px-4 py-3 w-[160px]">Date récupération</th>
                <th className="px-4 py-3 w-[140px]">Total articles</th>
                <th className="px-4 py-3 w-[280px] text-right">Actions</th>
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
                    Aucun dépôt-vente pour l’instant.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3 font-medium tabular-nums">
                      <span>{r.number}</span>
                      <EmailSentBadge sentAt={r.emailSentAt} />
                    </td>
                    <td className="px-4 py-3">{r.client?.displayName ?? "—"}</td>
                    <td className="px-4 py-3">{fmtDateFR(r.depositDate)}</td>
                    <td className="px-4 py-3">{fmtDateFR(r.recoveryDate)}</td>
                    <td className="px-4 py-3">{r.totalQty}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="rounded-xl border px-3 py-2 text-xs"
                          onClick={() => (window.location.href = `/depot-vente/${encodeURIComponent(r.id)}`)}
                        >
                          Ouvrir
                        </button>

                        <a
                          className="rounded-xl border px-3 py-2 text-xs"
                          href={`/api/exports/consignments/${encodeURIComponent(r.id)}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PDF
                        </a>

                        <button
                          className="rounded-xl border px-3 py-2 text-xs"
                          onClick={() => (window.location.href = `/depot-vente/${encodeURIComponent(r.id)}?action=sign`)}
                        >
                          Signer
                        </button>

                        <button
  className="rounded-xl border px-3 py-2 text-xs"
  onClick={async () => {
    if (!confirm("Envoyer ce dépôt-vente au client par email ?")) return;

    const res = await fetch(
      `/api/consignments/${encodeURIComponent(r.id)}/send`,
      { method: "POST" }
    );

    const j = await res.json().catch(() => ({}));
    if (!res.ok) return alert(j?.error ?? "Erreur envoi email");

    alert("Email envoyé au client ✅");
    await refresh();
  }}
>
  {r.emailSentAt ? "Renvoyer" : "Envoyer au client"}
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
    </div>
  );
}
