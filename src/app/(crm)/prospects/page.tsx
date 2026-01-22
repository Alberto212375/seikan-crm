"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Methode = { physique: boolean; appel: boolean; mail: boolean };

type Prospect = {
  id: string;
  societe: string;
  contact: string; // on va stocker "NOM — PRÉNOM"
  service: string;
  email: string;
  telephone: string;
  adresse: string; // on va stocker "Rue ... 91210 Ville"
  demarcheLe: string;
  methode: Methode;

  // ⚠️ optionnel : si ton API/DB le supporte, ça persistera ; sinon c’est juste UI.
  siret?: string;
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
        Page <span className="font-medium text-neutral-900">{page}</span> /{" "}
        {pageCount}
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

async function apiGetProspects(): Promise<Prospect[]> {
  const r = await fetch("/api/prospects", { cache: "no-store" });
  if (!r.ok) throw new Error("GET /api/prospects failed");
  const j = await r.json();
  return j.prospects as Prospect[];
}

async function apiCreateProspect(): Promise<Prospect> {
  const r = await fetch("/api/prospects", { method: "POST" });
  if (!r.ok) throw new Error("POST /api/prospects failed");
  const j = await r.json();
  return j.prospect as Prospect;
}

// ✅ on assouplit le patch : si ton API ne supporte pas siret, ça ne doit pas casser la page
async function apiPatchProspect(id: string, patch: Record<string, any>) {
  try {
    const r = await fetch(`/api/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error("PATCH /api/prospects/[id] failed");
  } catch (e) {
    // On ne bloque pas l’UX
    console.error("PATCH prospect failed:", e, { id, patch });
  }
}

async function apiDeleteProspect(id: string) {
  const r = await fetch(`/api/prospects/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("DELETE /api/prospects/[id] failed");
}

async function apiConvertProspect(id: string) {
  const r = await fetch(`/api/prospects/${id}/convert`, { method: "POST" });
  if (!r.ok) throw new Error("POST /api/prospects/[id]/convert failed");
}

/** --------- helpers parsing / composition --------- */

function normalizeSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function splitContact(contact: string): { lastName: string; firstName: string } {
  const c = normalizeSpaces(contact);

  // Format déjà utilisé chez toi : "NOM — PRENOM"
  if (c.includes("—")) {
    const [a, b] = c.split("—").map((x) => normalizeSpaces(x));
    return { lastName: a ?? "", firstName: b ?? "" };
  }

  // Sinon on tente "Nom Prénom"
  const parts = c.split(" ").filter(Boolean);
  if (parts.length <= 1) return { lastName: c, firstName: "" };
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function composeContact(lastName: string, firstName: string) {
  const ln = normalizeSpaces(lastName);
  const fn = normalizeSpaces(firstName);
  if (!ln && !fn) return "";
  if (ln && fn) return `${ln.toUpperCase()} — ${fn}`;
  if (ln) return ln.toUpperCase();
  return fn;
}

function splitAdresse(adresse: string): {
  street: string;
  postalCode: string;
  city: string;
} {
  const a = normalizeSpaces(adresse);

  // cherche un CP FR 5 chiffres
  const m = a.match(/(.*)\s(\d{5})\s(.+)$/);
  if (m) {
    return {
      street: normalizeSpaces(m[1]),
      postalCode: m[2],
      city: normalizeSpaces(m[3]),
    };
  }
  return { street: a, postalCode: "", city: "" };
}

function composeAdresse(street: string, postalCode: string, city: string) {
  const s = normalizeSpaces(street);
  const cp = normalizeSpaces(postalCode);
  const v = normalizeSpaces(city);
  const tail = [cp, v].filter(Boolean).join(" ");
  return [s, tail].filter(Boolean).join(" ");
}

type AdresseSuggestion = {
  label: string;
  street: string;
  postalCode: string;
  city: string;
};

// API adresse FR (gouv) : France uniquement ✅
async function fetchAdresseSuggestions(q: string): Promise<AdresseSuggestion[]> {
  const query = normalizeSpaces(q);
  if (query.length < 3) return [];
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(
    query
  )}&limit=6&autocomplete=1`;
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
      // street : on garde plutôt le "name" s’il existe, sinon label
      const street = String(p.name ?? label).trim();

      return { label, street, postalCode, city };
    })
    .filter((x) => x.label && x.postalCode && x.city);
}

/** Row UI state (sans toucher au backend immédiatement) */
type RowDraft = {
  isPro: boolean;
  societe: string;
  service: string;
  siret: string;

  lastName: string;
  firstName: string;

  street: string;
  postalCode: string;
  city: string;
};

function initDraftFromProspect(p: Prospect): RowDraft {
  const { lastName, firstName } = splitContact(p.contact);
  const { street, postalCode, city } = splitAdresse(p.adresse);

  const isPro = Boolean(
    normalizeSpaces(p.societe) ||
      normalizeSpaces(p.service) ||
      normalizeSpaces((p as any).siret)
  );

  return {
    isPro,
    societe: p.societe ?? "",
    service: p.service ?? "",
    siret: String((p as any).siret ?? ""),

    lastName,
    firstName,

    street,
    postalCode,
    city,
  };
}

export default function ProspectsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);

  // drafts UI par id
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  const PAGE_SIZE = 8;
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await apiGetProspects();
        if (!alive) return;
        setProspects(rows);

        const nextDrafts: Record<string, RowDraft> = {};
        for (const p of rows) nextDrafts[p.id] = initDraftFromProspect(p);
        setDrafts(nextDrafts);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pageCount = Math.max(1, Math.ceil(prospects.length / PAGE_SIZE));
  const items = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return prospects.slice(start, start + PAGE_SIZE);
  }, [prospects, page]);

  if (page > pageCount) setPage(pageCount);

  function updateDraft(id: string, patch: Partial<RowDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ??
          initDraftFromProspect(prospects.find((x) => x.id === id) as any)),
        ...patch,
      },
    }));
  }

  // --------- Autocomplete adresse (par ligne) ---------
  const [openSuggestFor, setOpenSuggestFor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Record<string, AdresseSuggestion[]>
  >({});
  const debounceRef = useRef<Record<string, any>>({});

  async function onStreetChange(id: string, value: string) {
    updateDraft(id, { street: value });
    setOpenSuggestFor(id);

    if (debounceRef.current[id]) clearTimeout(debounceRef.current[id]);
    debounceRef.current[id] = setTimeout(async () => {
      const list = await fetchAdresseSuggestions(value);
      setSuggestions((prev) => ({ ...prev, [id]: list }));
    }, 220);
  }

  function selectSuggestion(id: string, s: AdresseSuggestion) {
    updateDraft(id, { street: s.street, postalCode: s.postalCode, city: s.city });
    setSuggestions((prev) => ({ ...prev, [id]: [] }));
    setOpenSuggestFor(null);

    // ✅ on pousse tout de suite en backend (adresse complète)
    const addr = composeAdresse(s.street, s.postalCode, s.city);
    setProspects((prev) =>
      prev.map((x) => (x.id === id ? { ...x, adresse: addr } : x))
    );
    void apiPatchProspect(id, { adresse: addr });
  }

  function closeSuggestions() {
    setOpenSuggestFor(null);
  }

  return (
    // ✅ BREAKOUT PLEIN ÉCRAN : utilise toute la largeur dispo, sans scrollbar horizontale
    <div
      className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 overflow-x-hidden px-6 space-y-6"
      onClick={() => closeSuggestions()}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Prospects</h1>
          <p className="mt-1 text-neutral-600">
            Suivi des leads avant conversion en clients.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/api/exports/prospects.xlsx"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Export Excel
          </a>
          <a
            href="/api/exports/prospects.pdf"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Export PDF
          </a>

          <button
            onClick={async () => {
              const created = await apiCreateProspect();
              setProspects((prev) => [created, ...prev]);
              setDrafts((prev) => ({
                ...prev,
                [created.id]: initDraftFromProspect(created),
              }));

              const nextCount = prospects.length + 1;
              const nextPageCount = Math.max(
                1,
                Math.ceil(nextCount / PAGE_SIZE)
              );
              setPage(nextPageCount);
            }}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            disabled={loading}
          >
            Nouveau prospect
          </button>
        </div>
      </div>

      <div className="w-full rounded-xl border bg-white">
  <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
    <table className="min-w-[1400px] w-full border-collapse text-[15px] md:text-sm">
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

              {/* ✅ Adresse décomposée */}
              <th className="w-[14%] px-3 py-2">Rue</th>
              <th className="w-[6%] px-3 py-2">CP</th>
              <th className="w-[10%] px-3 py-2">Ville</th>

              <th className="w-[10%] px-3 py-2">Démarché le</th>
              <th className="w-[10%] px-3 py-2">Méthode</th>
              <th className="w-[6%] px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  Chargement…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  Aucun prospect pour l’instant.
                </td>
              </tr>
            ) : (
              items.map((p) => {
                const d = drafts[p.id] ?? initDraftFromProspect(p);
                const showPro = d.isPro;

                return (
                  <tr
                    key={p.id}
                    className="border-t align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* PRO ? */}
                    <td className="px-2 py-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={d.isPro}
                          onChange={async (e) => {
                            const isPro = e.target.checked;
                            updateDraft(p.id, { isPro });

                            // si on passe en particulier : on vide societe/service/siret côté UI + backend
                            if (!isPro) {
                              updateDraft(p.id, {
                                societe: "",
                                service: "",
                                siret: "",
                              });
                              setProspects((prev) =>
                                prev.map((x) =>
                                  x.id === p.id
                                    ? {
                                        ...x,
                                        societe: "",
                                        service: "",
                                        siret: "" as any,
                                      }
                                    : x
                                )
                              );
                              await apiPatchProspect(p.id, {
                                societe: "",
                                service: "",
                                siret: "",
                              });
                            }
                          }}
                        />
                        <span className="text-xs text-neutral-700">
                          {d.isPro ? "Oui" : "Non"}
                        </span>
                      </label>
                    </td>

                    {/* SOCIÉTÉ */}
                    <td className="px-2 py-1 md:px-3 md:py-2">
                      {showPro ? (
                        <input
                          className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2 truncate"
                          value={d.societe}
                          onChange={(e) =>
                            updateDraft(p.id, { societe: e.target.value })
                          }
                          onBlur={async () => {
                            const v = d.societe;
                            setProspects((prev) =>
                              prev.map((x) =>
                                x.id === p.id ? { ...x, societe: v } : x
                              )
                            );
                            await apiPatchProspect(p.id, { societe: v });
                          }}
                        />
                      ) : (
                        <div className="select-none text-neutral-300">—</div>
                      )}
                    </td>

                    {/* SERVICE */}
                    <td className="px-2 py-1 md:px-3 md:py-2">
                      {showPro ? (
                        <input
                          className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2 truncate"
                          value={d.service}
                          onChange={(e) =>
                            updateDraft(p.id, { service: e.target.value })
                          }
                          onBlur={async () => {
                            const v = d.service;
                            setProspects((prev) =>
                              prev.map((x) =>
                                x.id === p.id ? { ...x, service: v } : x
                              )
                            );
                            await apiPatchProspect(p.id, { service: v });
                          }}
                        />
                      ) : (
                        <div className="select-none text-neutral-300">—</div>
                      )}
                    </td>

                    {/* SIRET */}
                    <td className="px-2 py-1 md:px-3 md:py-2">
                      {showPro ? (
                        <input
                          className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2 truncate"
                          placeholder="14 chiffres"
                          value={d.siret}
                          onChange={(e) =>
                            updateDraft(p.id, { siret: e.target.value })
                          }
                          onBlur={async () => {
                            const v = normalizeSpaces(d.siret);

                            // on met aussi à jour l’état local (même si l’API ne persiste pas)
                            setProspects((prev) =>
                              prev.map((x) =>
                                x.id === p.id
                                  ? ({ ...x, siret: v } as any)
                                  : x
                              )
                            );

                            // tentative backend (si supporté)
                            await apiPatchProspect(p.id, { siret: v });
                          }}
                        />
                      ) : (
                        <div className="select-none text-neutral-300">—</div>
                      )}
                    </td>

                    {/* ✅ PRÉNOM (interverti) */}
                    <td className="px-2 py-1 md:px-3 md:py-2 
">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2
 truncate"
                        value={d.firstName}
                        onChange={(e) =>
                          updateDraft(p.id, { firstName: e.target.value })
                        }
                        onBlur={async () => {
                          const contact = composeContact(
                            d.lastName,
                            d.firstName
                          );
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, contact } : x
                            )
                          );
                          await apiPatchProspect(p.id, { contact });
                        }}
                      />
                    </td>

                    {/* ✅ NOM (interverti) */}
                    <td className="px-2 py-1 md:px-3 md:py-2
">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2
 truncate"
                        value={d.lastName}
                        onChange={(e) =>
                          updateDraft(p.id, { lastName: e.target.value })
                        }
                        onBlur={async () => {
                          const contact = composeContact(
                            d.lastName,
                            d.firstName
                          );
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, contact } : x
                            )
                          );
                          await apiPatchProspect(p.id, { contact });
                        }}
                      />
                    </td>

                    {/* EMAIL */}
                    <td className="px-2 py-1 md:px-3 md:py-2
">
                      <input
                        type="email"
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2
 truncate"
                        defaultValue={p.email}
                        onBlur={async (e) => {
                          const v = e.target.value;
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, email: v } : x
                            )
                          );
                          await apiPatchProspect(p.id, { email: v });
                        }}
                      />
                    </td>

                    {/* TÉL */}
                    <td className="px-2 py-1 md:px-3 md:py-2
">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2
 truncate"
                        defaultValue={p.telephone}
                        onBlur={async (e) => {
                          const v = e.target.value;
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, telephone: v } : x
                            )
                          );
                          await apiPatchProspect(p.id, { telephone: v });
                        }}
                      />
                    </td>

                    {/* ✅ RUE (autocomplete) */}
                    <td className="px-2 py-1 md:px-3 md:py-2
">
                      <div className="relative">
                        <input
                          className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2
"
                          placeholder="Rue"
                          value={d.street}
                          onChange={(e) => void onStreetChange(p.id, e.target.value)}
                          onFocus={() => setOpenSuggestFor(p.id)}
                          onBlur={async () => {
                            const addr = composeAdresse(
                              d.street,
                              d.postalCode,
                              d.city
                            );
                            setProspects((prev) =>
                              prev.map((x) =>
                                x.id === p.id ? { ...x, adresse: addr } : x
                              )
                            );
                            await apiPatchProspect(p.id, { adresse: addr });
                          }}
                        />

                        {openSuggestFor === p.id &&
                          (suggestions[p.id]?.length ?? 0) > 0 && (
                            <div
                              className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg"
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {suggestions[p.id].map((s, idx) => (
                                <button
                                  key={`${s.label}-${idx}`}
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                                  onClick={() => selectSuggestion(p.id, s)}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          )}
                      </div>
                    </td>

                    {/* ✅ CP */}
                    <td className="px-2 py-1 md:px-3 md:py-2
">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2
"
                        placeholder="CP"
                        value={d.postalCode}
                        onChange={(e) =>
                          updateDraft(p.id, { postalCode: e.target.value })
                        }
                        onBlur={async () => {
                          const addr = composeAdresse(
                            d.street,
                            d.postalCode,
                            d.city
                          );
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, adresse: addr } : x
                            )
                          );
                          await apiPatchProspect(p.id, { adresse: addr });
                        }}
                      />
                    </td>

                    {/* ✅ VILLE */}
                    <td className="px-2 py-1 md:px-3 md:py-2
">
                      <input
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2"
                        placeholder="Ville"
                        value={d.city}
                        onChange={(e) => updateDraft(p.id, { city: e.target.value })}
                        onBlur={async () => {
                          const addr = composeAdresse(
                            d.street,
                            d.postalCode,
                            d.city
                          );
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, adresse: addr } : x
                            )
                          );
                          await apiPatchProspect(p.id, { adresse: addr });
                        }}
                      />
                    </td>

                    {/* DÉMARCHÉ LE */}
                    <td className="px-2 py-1 md:px-3 md:py-2">
                      <input
                        type="date"
                        className="w-full min-w-0 rounded border px-2 py-1 md:px-3 md:py-2 md:px-3 md:py-2"
                        defaultValue={p.demarcheLe}
                        onBlur={async (e) => {
                          const v = e.target.value;
                          setProspects((prev) =>
                            prev.map((x) =>
                              x.id === p.id ? { ...x, demarcheLe: v } : x
                            )
                          );
                          await apiPatchProspect(p.id, { demarcheLe: v });
                        }}
                      />
                    </td>

                    {/* MÉTHODE */}
                    <td className="px-2 py-1 md:px-3 md:py-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {(["physique", "appel", "mail"] as const).map((m) => (
                          <label key={m} className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              defaultChecked={p.methode[m]}
                              onChange={async (e) => {
                                const next = { ...p.methode, [m]: e.target.checked };
                                setProspects((prev) =>
                                  prev.map((x) =>
                                    x.id === p.id ? { ...x, methode: next } : x
                                  )
                                );
                                await apiPatchProspect(p.id, { methode: next });
                              }}
                            />
                            <span className="text-xs capitalize">{m}</span>
                          </label>
                        ))}
                      </div>
                    </td>

                    {/* ACTIONS */}
                    <td className="px-2 py-1 md:px-3 md:py-2">
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={async () => {
                            await apiConvertProspect(p.id);
                            setProspects((prev) => prev.filter((x) => x.id !== p.id));
                            setDrafts((prev) => {
                              const copy = { ...prev };
                              delete copy[p.id];
                              return copy;
                            });
                          }}
                          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                        >
                          Convertir
                        </button>

                        <button
                          onClick={async () => {
                            await apiDeleteProspect(p.id);
                            setProspects((prev) => prev.filter((x) => x.id !== p.id));
                            setDrafts((prev) => {
                              const copy = { ...prev };
                              delete copy[p.id];
                              return copy;
                            });
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
          </div>

        <div className="px-4 pb-4">
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}
