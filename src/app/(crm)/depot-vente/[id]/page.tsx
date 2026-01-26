// src/app/(crm)/depot-vente/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

function fmtDateFR(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function centsToEurosStr(c: number) {
  return (c / 100).toFixed(2).replace(".", ",");
}

type Item = {
  id: string;
  ref: string;
  format: string;
  nameFR: string | null;
  qty: number;
  unitPrice: number;
};

type Detail = {
  id: string;
  number: string;
  status: string;
  client: { id: string; displayName: string; email?: string | null } | null;

  depositDate: string;
  recoveryDate: string;
  periodDays: number;

  emailSentAt?: string | null;

  items: Item[];
};

export default function DepotVenteDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const sp = useSearchParams();
  const action = sp.get("action");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [c, setC] = useState<Detail | null>(null);

  async function load() {
    const r = await fetch(`/api/consignments/${encodeURIComponent(id)}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return alert(j?.error ?? "Erreur chargement dépôt-vente");
    setC(j.consignment as Detail);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const totals = useMemo(() => {
    if (!c) return { qty: 0, value: 0 };
    const qty = c.items.reduce((s, it) => s + (it.qty || 0), 0);
    const value = c.items.reduce((s, it) => s + (it.qty || 0) * (it.unitPrice || 0), 0);
    return { qty, value };
  }, [c]);

  async function patch(body: any) {
    setSaving(true);
    try {
      const r = await fetch(`/api/consignments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error ?? "Erreur action dépôt-vente");
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  // “Signer” direct depuis query ?action=sign
  useEffect(() => {
    if (!c) return;
    if (action === "sign" && c.status !== "SIGNED") {
      void patch({ sign: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, c?.id]);

  if (loading || !c) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Chargement…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{c.number}</div>
          <div className="mt-1 text-sm text-neutral-600">
            Client : <span className="font-medium text-neutral-900">{c.client?.displayName ?? "—"}</span>
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Statut : <span className="font-medium">{c.status}</span>
            {c.emailSentAt ? <> · 📧 Envoyé le {fmtDateFR(c.emailSentAt)}</> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            className="rounded-xl border px-3 py-2 text-xs"
            href={`/api/exports/consignments/${encodeURIComponent(id)}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            PDF
          </a>

          <button
            className="rounded-xl border px-3 py-2 text-xs"
            disabled={saving}
            onClick={() => patch({ generate: true })}
          >
            {saving ? "…" : "Générer le dépôt"}
          </button>

          <button
            className="rounded-xl bg-black px-3 py-2 text-xs text-white"
            disabled={saving}
            onClick={() => patch({ sign: true })}
          >
            {saving ? "…" : "Signer"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-neutral-500">Date dépôt</div>
          <div className="mt-1 font-semibold">{fmtDateFR(c.depositDate)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-neutral-500">Date récupération</div>
          <div className="mt-1 font-semibold">{fmtDateFR(c.recoveryDate)}</div>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-neutral-500">Durée</div>
          <div className="mt-1 font-semibold">{c.periodDays} jours</div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-4 py-3 w-[140px]">Réf</th>
                <th className="px-4 py-3 w-[120px]">Format</th>
                <th className="px-4 py-3">Nom (FR)</th>
                <th className="px-4 py-3 w-[120px]">Qté</th>
                <th className="px-4 py-3 w-[160px]">PU</th>
                <th className="px-4 py-3 w-[160px]">Total</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => {
                const row = (it.qty || 0) * (it.unitPrice || 0);
                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-4 py-2 font-medium tabular-nums">{it.ref}</td>
                    <td className="px-4 py-2">{it.format}</td>
                    <td className="px-4 py-2">{it.nameFR || "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{it.qty}</td>
                    <td className="px-4 py-2 tabular-nums">{centsToEurosStr(it.unitPrice)} €</td>
                    <td className="px-4 py-2 tabular-nums">{centsToEurosStr(row)} €</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t bg-white px-4 py-3 flex items-center justify-between text-sm">
          <div className="text-neutral-600">
            Total articles : <span className="font-medium text-neutral-900">{totals.qty}</span>
          </div>
          <div className="text-neutral-600">
            Valeur totale : <span className="font-semibold text-neutral-900 tabular-nums">{centsToEurosStr(totals.value)} €</span>
          </div>
        </div>
      </div>

      <div className="text-xs text-neutral-500">
        Le PDF + l’envoi email juridique + le stockage du PDF signé arrivent dans le BLOC 2 (patch suivant).
      </div>
    </div>
  );
}
