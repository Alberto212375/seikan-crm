"use client";

/**
 * CODE COULEUR (Clients)
 * - PRO = VERT  (badge: bg-emerald-600 / ring-emerald-200)
 * - PARTICULIER = BLEU (badge: bg-blue-600 / ring-blue-200)
 */

import { useEffect, useMemo, useRef, useState } from "react";

type ClientUi = {
  id: string;

  isProfessional: boolean;
  societe: string;
  service: string;
  siret: string;

  lastName: string;
  firstName: string;

  email: string;
  telephone: string;

  street: string;
  postalCode: string;
  city: string;

  prospectedByPhone: boolean;
  prospectedByEmail: boolean;
  prospectedInPerson: boolean;

  clientDepuisLe: string; // YYYY-MM-DD
  notes: string;
};

function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button
        className="rounded-md border bg-white px-3 py-1 text-sm disabled:opacity-50"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        Précédent
      </button>
      <div className="text-sm text-neutral-600">
        Page <span className="font-medium text-neutral-900">{page}</span> / {pageCount}
      </div>
      <button
        className="rounded-md border bg-white px-3 py-1 text-sm disabled:opacity-50"
        onClick={() => onPage(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
      >
        Suivant
      </button>
    </div>
  );
}

async function apiGetClients(): Promise<ClientUi[]> {
  const r = await fetch("/api/clients", { cache: "no-store" });
  if (!r.ok) throw new Error("GET /api/clients failed");
  const j = await r.json();
  return j.clients as ClientUi[];
}

async function apiPatchClient(id: string, patch: Partial<ClientUi>) {
  const r = await fetch(`/api/clients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("PATCH /api/clients/[id] failed");
}

async function apiDeleteClient(id: string) {
  const r = await fetch(`/api/clients/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("DELETE /api/clients/[id] failed");
}

// ---- Autocomplete adresse France (api-adresse.data.gouv.fr) ----
type AdresseSuggestion = { label: string; street: string; postalCode: string; city: string };

function normalizeSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

async function fetchAdresseSuggestions(q: string): Promise<AdresseSuggestion[]> {
  const query = normalizeSpaces(q);
  if (query.length < 3) return [];
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=6&autocomplete=1`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  const features = (j?.features ?? []) as any[];
  return features
    .map((f) => {
      const p = f?.properties ?? {};
      const label = String(p.label ?? "").trim();
      const postalCode = String(p.postcode ?? "").trim();
      const city = String(p.city ?? p.citycode ?? "").trim();
      const street = String(p.name ?? label).trim();
      return { label, street, postalCode, city };
    })
    .filter((x) => x.label && x.postalCode && x.city);
}

function BadgeType({ isPro }: { isPro: boolean }) {
  const cls = isPro ? "bg-emerald-600 ring-emerald-200" : "bg-blue-600 ring-blue-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white ring-2 ${cls}`}
    >
      {isPro ? "PRO" : "PART"}
    </span>
  );
}

function methodLabel(c: ClientUi) {
  const parts: string[] = [];
  if (c.prospectedByPhone) parts.push("Téléphone");
  if (c.prospectedByEmail) parts.push("Mail");
  if (c.prospectedInPerson) parts.push("Physique");
  return parts.length ? parts.join(" / ") : "—";
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientUi[]>([]);
  const [loading, setLoading] = useState(true);

  const PAGE_SIZE = 8;
  const [page, setPage] = useState(1);

  // dropdown adresse par ligne
  const [openSuggestFor, setOpenSuggestFor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, AdresseSuggestion[]>>({});
  const debounceRef = useRef<Record<string, any>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await apiGetClients();
        if (alive) setClients(rows);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pageCount = Math.max(1, Math.ceil(clients.length / PAGE_SIZE));
  const items = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return clients.slice(start, start + PAGE_SIZE);
  }, [clients, page]);

  if (page > pageCount) setPage(pageCount);

  function closeSuggestions() {
    setOpenSuggestFor(null);
  }

  async function onStreetChange(id: string, value: string) {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, street: value } : c)));
    setOpenSuggestFor(id);

    if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
    debounceRef.current[id] = setTimeout(async () => {
      const list = await fetchAdresseSuggestions(value);
      setSuggestions((prev) => ({ ...prev, [id]: list }));
    }, 220);
  }

  async function selectSuggestion(id: string, s: AdresseSuggestion) {
    setClients((prev) =>
      prev.map((c) => (c.id === id ? { ...c, street: s.street, postalCode: s.postalCode, city: s.city } : c))
    );
    setSuggestions((prev) => ({ ...prev, [id]: [] }));
    setOpenSuggestFor(null);

    await apiPatchClient(id, { street: s.street, postalCode: s.postalCode, city: s.city });
  }

  const blacked =
    "bg-neutral-900 text-neutral-200 border-neutral-800 placeholder:text-neutral-500";

  return (
    // ✅ même “breakout plein écran” que Prospects
    <div
      className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 overflow-x-hidden px-6 space-y-6"
      onClick={() => closeSuggestions()}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-neutral-600">Fiche client complète (infos récupérées depuis prospects).</p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/exports/clients.xlsx"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Export Excel
          </a>
          <a
            href="/api/exports/clients.pdf"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Export PDF
          </a>
        </div>
      </div>

      <div className="w-full overflow-x-hidden rounded-xl border bg-white">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="w-[6%] px-3 py-2">Pro</th>
              <th className="w-[12%] px-3 py-2">Société</th>
              <th className="w-[10%] px-3 py-2">Service</th>
              <th className="w-[10%] px-3 py-2">SIRET</th>

              {/* ✅ inversion affichage : Prénom puis Nom */}
              <th className="w-[10%] px-3 py-2">Prénom</th>
              <th className="w-[10%] px-3 py-2">Nom</th>

              <th className="w-[12%] px-3 py-2">Email</th>
              <th className="w-[10%] px-3 py-2">Téléphone</th>

              {/* ✅ identique à Prospects : Rue / CP / Ville */}
              <th className="w-[14%] px-3 py-2">Rue</th>
              <th className="w-[6%] px-3 py-2">CP</th>
              <th className="w-[10%] px-3 py-2">Ville</th>

              {/* ✅ Démarché le dédié (figé) */}
              <th className="w-[10%] px-3 py-2">Démarché le</th>

              {/* ✅ Méthode dédiée, figée, en mots */}
              <th className="w-[10%] px-3 py-2">Méthode</th>

              {/* on garde Notes + Actions (sans casser le reste) */}
              <th className="w-[12%] px-3 py-2">Notes</th>
              <th className="w-[6%] px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={15} className="px-4 py-6 text-center text-neutral-500">
                  Chargement…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-4 py-6 text-center text-neutral-500">
                  Aucun client pour l’instant.
                </td>
              </tr>
            ) : (
              items.map((c) => {
                const isPro = Boolean(c.isProfessional);

                return (
                  <tr key={c.id} className="border-t align-top" onClick={(e) => e.stopPropagation()}>
                    {/* Pro (FIGÉ) + badge couleur */}
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <BadgeType isPro={isPro} />
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isPro}
                            disabled
                            className="cursor-not-allowed opacity-70"
                            title="Champ figé après conversion"
                            onChange={() => {}}
                          />
                        </label>
                      </div>
                    </td>

                    {/* Société */}
                    <td className="px-2 py-1">
                      <input
                        className={`w-full min-w-0 rounded border px-2 py-1 truncate ${!isPro ? blacked : ""}`}
                        value={c.societe}
                        placeholder={!isPro ? "—" : ""}
                        disabled={!isPro}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, societe: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { societe: c.societe })}
                      />
                    </td>

                    {/* Service */}
                    <td className="px-2 py-1">
                      <input
                        className={`w-full min-w-0 rounded border px-2 py-1 truncate ${!isPro ? blacked : ""}`}
                        value={c.service}
                        placeholder={!isPro ? "—" : ""}
                        disabled={!isPro}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, service: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { service: c.service })}
                      />
                    </td>

                    {/* SIRET */}
                    <td className="px-2 py-1">
                      <input
                        className={`w-full min-w-0 rounded border px-2 py-1 truncate ${!isPro ? blacked : ""}`}
                        value={c.siret}
                        placeholder={!isPro ? "—" : "14 chiffres"}
                        disabled={!isPro}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, siret: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { siret: c.siret })}
                      />
                    </td>

                    {/* ✅ Prénom (interverti) */}
                    <td className="px-2 py-1">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 truncate"
                        value={c.firstName}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, firstName: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { firstName: c.firstName })}
                      />
                    </td>

                    {/* ✅ Nom (interverti) */}
                    <td className="px-2 py-1">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 truncate"
                        value={c.lastName}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, lastName: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { lastName: c.lastName })}
                      />
                    </td>

                    {/* Email */}
                    <td className="px-2 py-1">
                      <input
                        type="email"
                        className="w-full min-w-0 rounded border px-2 py-1 truncate"
                        value={c.email}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, email: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { email: c.email })}
                      />
                    </td>

                    {/* Téléphone */}
                    <td className="px-2 py-1">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 truncate"
                        value={c.telephone}
                        onChange={(e) =>
                          setClients((p) =>
                            p.map((x) => (x.id === c.id ? { ...x, telephone: e.target.value } : x))
                          )
                        }
                        onBlur={async () => await apiPatchClient(c.id, { telephone: c.telephone })}
                      />
                    </td>

                    {/* ✅ RUE (autocomplete) */}
                    <td className="px-2 py-1">
                      <div className="relative">
                        <input
                          className="w-full min-w-0 rounded border px-2 py-1"
                          placeholder="Rue"
                          value={c.street}
                          onChange={(e) => void onStreetChange(c.id, e.target.value)}
                          onFocus={() => setOpenSuggestFor(c.id)}
                          onBlur={async () => await apiPatchClient(c.id, { street: c.street })}
                        />

                        {openSuggestFor === c.id && (suggestions[c.id]?.length ?? 0) > 0 && (
                          <div
                            className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg"
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            {suggestions[c.id].map((s, idx) => (
                              <button
                                key={`${s.label}-${idx}`}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                                onClick={() => void selectSuggestion(c.id, s)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* ✅ CP */}
                    <td className="px-2 py-1">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1"
                        placeholder="CP"
                        value={c.postalCode}
                        onChange={(e) =>
                          setClients((p) =>
                            p.map((x) => (x.id === c.id ? { ...x, postalCode: e.target.value } : x))
                          )
                        }
                        onBlur={async () => await apiPatchClient(c.id, { postalCode: c.postalCode })}
                      />
                    </td>

                    {/* ✅ VILLE */}
                    <td className="px-2 py-1">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1"
                        placeholder="Ville"
                        value={c.city}
                        onChange={(e) => setClients((p) => p.map((x) => (x.id === c.id ? { ...x, city: e.target.value } : x)))}
                        onBlur={async () => await apiPatchClient(c.id, { city: c.city })}
                      />
                    </td>

                    {/* ✅ Démarché le (FIGÉ) */}
                    <td className="px-2 py-1">
                      <input
                        type="date"
                        className="w-full min-w-0 rounded border px-2 py-1 bg-neutral-50 text-neutral-700"
                        value={c.clientDepuisLe || ""}
                        disabled
                        readOnly
                        title="Démarché le (figé)"
                      />
                    </td>

                    {/* ✅ Méthode (FIGÉE, en mots) */}
                    <td className="px-2 py-1">
                      <div className="text-xs text-neutral-800">
                        {methodLabel(c)}
                      </div>
                      <div className="mt-1 text-[11px] text-neutral-500 select-none">
                        Méthode figée après conversion
                      </div>
                    </td>

                    {/* Notes */}
                    <td className="px-2 py-1">
                      <textarea
                        className="w-full min-w-0 min-h-[72px] resize-none rounded border px-2 py-1"
                        value={c.notes}
                        onChange={(e) =>
                          setClients((p) => p.map((x) => (x.id === c.id ? { ...x, notes: e.target.value } : x)))
                        }
                        onBlur={async () => await apiPatchClient(c.id, { notes: c.notes })}
                        placeholder="Habitudes, préférences, allergies…"
                      />
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-1">
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => {
                            window.location.href = `/devis?client=${encodeURIComponent(c.id)}`;
                          }}
                          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                        >
                          Devis
                        </button>

                        <button
                          onClick={async () => {
                            await apiDeleteClient(c.id);
                            setClients((prev) => prev.filter((x) => x.id !== c.id));
                          }}
                          className="rounded-md border px-3 py-1.5 text-xs hover:bg-neutral-50"
                        >
                          Suppr.
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="px-4 pb-4">
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}
