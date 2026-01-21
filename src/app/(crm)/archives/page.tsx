// src/app/(crm)/archives/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ArchivedInvoice = {
  id: string;
  number: string;
  status: string;
  totalHT: number;
  issuedAt: string | null;
  archivedAt: string | null;
};

type ArchivedQuote = {
  id: string;
  number: string;
  createdAt: string;
  archivedAt: string | null;
  totalHT: number;

  depositPaid: boolean;
  depositPaidAmount: number;

  // ✅ pour savoir PRO/PART
  metaJson: string | null;

  client: { id: string; displayName: string } | null;

  invoices: ArchivedInvoice[];
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

// ✅ lit party.isProfessional depuis le metaJson du devis archivé
function getIsProFromQuoteMeta(metaJson: string | null): boolean {
  if (!metaJson) return false;
  try {
    const m = JSON.parse(metaJson);
    return Boolean(m?.party?.isProfessional);
  } catch {
    return false;
  }
}

export default function ArchivesPage() {
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<ArchivedQuote[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/archives", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        setQuotes((j.quotes ?? []) as ArchivedQuote[]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

    const grouped = useMemo(() => {
    const m = new Map<string, ArchivedQuote[]>();
    for (const q of quotes) {
      const key = q.client?.displayName ?? "Client inconnu";
      const arr = m.get(key) ?? [];
      arr.push(q);
      m.set(key, arr);
    }

    // ✅ tri alphabétique par nom client
    return Array.from(m.entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]), "fr", { sensitivity: "base" })
    );
  }, [quotes]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Archives</h1>
        <p className="mt-1 text-neutral-600">
          Dossiers archivés (Devis + Factures liées). Classé par client.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-neutral-500">Chargement…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-neutral-500">Aucune archive pour l’instant.</div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([clientName, clientQuotes]) => (
            <div key={clientName} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                            <div className="px-4 py-3 bg-neutral-50 border-b">
                <div className="text-sm text-neutral-600">Client</div>

                <div className="text-lg font-semibold flex items-center gap-2">
                  {clientName}
                  <TypeBadge isPro={getIsProFromQuoteMeta(clientQuotes?.[0]?.metaJson ?? null)} />
                </div>
              </div>


              <div className="divide-y">
                {clientQuotes.map((q) => {
                  const inv = (q.invoices ?? [])[0] ?? null;
                  return (
                    <div key={q.id} className="p-4 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold tabular-nums">{q.number}</div>
                          <div className="text-xs text-neutral-600">
                            Archivé le {fmtDateFR(q.archivedAt)} · Créé le {fmtDateFR(q.createdAt)}
                          </div>
                        </div>

                        <div className="text-sm tabular-nums">
                          <div className="text-neutral-500">Total devis</div>
                          <div className="font-semibold">{centsToEurosStr(q.totalHT)} €</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          className="rounded-xl border px-3 py-2 text-xs"
                          href={`/api/exports/quotes/${q.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PDF devis
                        </a>

                        {inv ? (
                          <>
                            <a
                              className="rounded-xl border px-3 py-2 text-xs"
                              href={`/api/exports/invoices/${inv.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              PDF facture ({inv.number})
                            </a>
                            <span className="text-xs text-neutral-600">
                              Facture archivée le {fmtDateFR(inv.archivedAt)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-neutral-500">Aucune facture archivée liée.</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
