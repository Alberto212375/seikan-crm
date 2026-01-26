// src/app/(crm)/depot-vente/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

export const dynamic = "force-dynamic";

/* -------------------- Types -------------------- */

type ClientUi = {
  id: string;

  // type
  isProfessional: boolean;

  // pro
  societe: string;
  service: string;
  siret: string;

  // contact
  lastName: string;
  firstName: string;

  // contact direct
  email: string;
  telephone: string;

  // adresse
  street: string;
  postalCode: string;
  city: string;

  // meta
  clientDepuisLe: string; // YYYY-MM-DD
  notes: string;
};

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

type PosterFormat = "30x40" | "A3" | "A2";

type PosterRef = {
  format: PosterFormat;
  ref: string; // R-XXXXXX
  jp: string; // (chez toi: romaji / “nom JP” affiché en colonne)
  fr: string; // traduction FR
  suffix: string; // "001".."010"
};

/* -------------------- Utils -------------------- */

function fmtDateFR(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function fmtDateFRLongIso(iso: string) {
  const dt = new Date(iso + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function eurosToCents(s: string) {
  const v = String(s ?? "").replace(",", ".").trim();
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// même barème que devis posters
function calcUnitPriceEuros(format: PosterFormat, totalUnitsInFormat: number) {
  const base =
    totalUnitsInFormat >= 50 ? 12 : totalUnitsInFormat >= 25 ? 14 : totalUnitsInFormat >= 10 ? 16 : 18;
  return format === "A2" ? base + 8 : base;
}

function buildClientDisplayName(c: ClientUi | null) {
  if (!c) return "";
  if (c.isProfessional) {
    const soc = String(c.societe || "").trim();
    return soc || "Client PRO";
  }
  const ln = String(c.lastName || "").trim();
  const fn = String(c.firstName || "").trim();
  const base = [ln, fn].filter(Boolean).join(" — ");
  return base || "Client";
}

/* -------------------- Posters refs (identiques à Devis) -------------------- */

const POSTERS: Record<PosterFormat, PosterRef[]> = {
  "30x40": [
    { format: "30x40", ref: "R-304001", jp: "Shizuka no Tsubasa", fr: "Les ailes silencieuses", suffix: "001" },
    { format: "30x40", ref: "R-304002", jp: "Tabi no Hajimari", fr: "Le début du voyage", suffix: "002" },
    { format: "30x40", ref: "R-304003", jp: "Eien no Koi", fr: "La carpe éternelle", suffix: "003" },
    { format: "30x40", ref: "R-304004", jp: "Kinu no Onna", fr: "La femme de soie", suffix: "004" },
    { format: "30x40", ref: "R-304005", jp: "Uchi no Yama", fr: "La montagne intérieure", suffix: "005" },
    // 6→10 : pas de nom
    { format: "30x40", ref: "R-304006", jp: "-", fr: "-", suffix: "006" },
    { format: "30x40", ref: "R-304007", jp: "-", fr: "-", suffix: "007" },
    { format: "30x40", ref: "R-304008", jp: "-", fr: "-", suffix: "008" },
    { format: "30x40", ref: "R-304009", jp: "-", fr: "-", suffix: "009" },
    { format: "30x40", ref: "R-304010", jp: "-", fr: "-", suffix: "010" },
  ],
  A3: [
    { format: "A3", ref: "R-330001", jp: "Shizuka no Tsubasa", fr: "Les ailes silencieuses", suffix: "001" },
    { format: "A3", ref: "R-330002", jp: "Tabi no Hajimari", fr: "Le début du voyage", suffix: "002" },
    { format: "A3", ref: "R-330003", jp: "Eien no Koi", fr: "La carpe éternelle", suffix: "003" },
    { format: "A3", ref: "R-330004", jp: "Kinu no Onna", fr: "La femme de soie", suffix: "004" },
    { format: "A3", ref: "R-330005", jp: "Uchi no Yama", fr: "La montagne intérieure", suffix: "005" },
    { format: "A3", ref: "R-330006", jp: "-", fr: "-", suffix: "006" },
    { format: "A3", ref: "R-330007", jp: "-", fr: "-", suffix: "007" },
    { format: "A3", ref: "R-330008", jp: "-", fr: "-", suffix: "008" },
    { format: "A3", ref: "R-330009", jp: "-", fr: "-", suffix: "009" },
    { format: "A3", ref: "R-330010", jp: "-", fr: "-", suffix: "010" },
  ],
  A2: [
    { format: "A2", ref: "R-420001", jp: "Shizuka no Tsubasa", fr: "Les ailes silencieuses", suffix: "001" },
    { format: "A2", ref: "R-420002", jp: "Tabi no Hajimari", fr: "Le début du voyage", suffix: "002" },
    { format: "A2", ref: "R-420003", jp: "Eien no Koi", fr: "La carpe éternelle", suffix: "003" },
    { format: "A2", ref: "R-420004", jp: "Kinu no Onna", fr: "La femme de soie", suffix: "004" },
    { format: "A2", ref: "R-420005", jp: "Uchi no Yama", fr: "La montagne intérieure", suffix: "005" },
    { format: "A2", ref: "R-420006", jp: "-", fr: "-", suffix: "006" },
    { format: "A2", ref: "R-420007", jp: "-", fr: "-", suffix: "007" },
    { format: "A2", ref: "R-420008", jp: "-", fr: "-", suffix: "008" },
    { format: "A2", ref: "R-420009", jp: "-", fr: "-", suffix: "009" },
    { format: "A2", ref: "R-420010", jp: "-", fr: "-", suffix: "010" },
  ],
};

function getPosterBy(format: PosterFormat, suffix: string) {
  return POSTERS[format].find((p) => p.suffix === suffix) ?? null;
}

function formatLabelUI(fmt: PosterFormat) {
  return fmt === "30x40" ? "30×40" : fmt;
}

function formatUiToInternal(ui: "30×40" | "A3" | "A2"): PosterFormat {
  return ui === "30×40" ? "30x40" : ui;
}
function formatInternalToUi(f: PosterFormat): "30×40" | "A3" | "A2" {
  return f === "30x40" ? "30×40" : f;
}

/* -------------------- Page -------------------- */

export default function DepotVentePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConsignmentRow[]>([]);
  const [clients, setClients] = useState<ClientUi[]>([]);

  // create form
  const [clientId, setClientId] = useState("");
  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodDays, setPeriodDays] = useState("14");
  const [recoveryDate, setRecoveryDate] = useState("");

  // snapshot (mêmes champs que Devis)
  const [snapSociete, setSnapSociete] = useState("");
  const [snapService, setSnapService] = useState("");
  const [snapSiret, setSnapSiret] = useState("");
  const [snapLastName, setSnapLastName] = useState("");
  const [snapFirstName, setSnapFirstName] = useState("");
  const [billingStreet, setBillingStreet] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");
  const [billingCity, setBillingCity] = useState("");

  type DraftItem = {
    id: string;
    format: "30×40" | "A3" | "A2";
    // sélection “produit” via suffix (001..010)
    suffix: string;

    // champs dérivés
    ref: string;
    nameJP: string;
    nameFR: string;

    qty: string;

    // prix auto (affiché)
    unitPriceEuros: string;
  };

  const [items, setItems] = useState<DraftItem[]>(() => {
    const p = getPosterBy("A3", "001");
    return [
      {
        id: crypto.randomUUID(),
        format: "A3",
        suffix: "001",
        ref: p?.ref ?? "R-330001",
        nameJP: p?.jp ?? "-",
        nameFR: p?.fr ?? "-",
        qty: "10",
        unitPriceEuros: "", // auto
      },
    ];
  });

  const validiteLabel = useMemo(() => {
    if (!recoveryDate) return "—";
    return `Jusqu’au ${fmtDateFRLongIso(recoveryDate)}`;
  }, [recoveryDate]);

  const totalQtyAll = useMemo(() => {
    return items.reduce((s, it) => s + Math.max(0, Number(it.qty || 0)), 0);
  }, [items]);

  // recoveryDate auto
  useEffect(() => {
    const d = new Date(depositDate + "T00:00:00");
    if (!Number.isNaN(d.getTime())) {
      const p = Math.max(1, Number(periodDays || 1));
      const x = new Date(d);
      x.setDate(x.getDate() + p);
      setRecoveryDate(x.toISOString().slice(0, 10));
    }
  }, [depositDate, periodDays]);

  // snapshot auto quand client change (comme Devis)
  useEffect(() => {
    if (!client) return;

    setSnapSociete(String(client.societe || "").trim());
    setSnapService(String(client.service || "").trim());
    setSnapSiret(String(client.siret || "").trim());

    setSnapLastName(String(client.lastName || "").trim().toUpperCase());
    setSnapFirstName(String(client.firstName || "").trim());

    setBillingStreet(String(client.street || "").trim());
    setBillingPostalCode(String(client.postalCode || "").trim());
    setBillingCity(String(client.city || "").trim());
  }, [client]);

  // prix auto recalculé en continu (par format, selon total qty de ce format)
  useEffect(() => {
    const totals: Record<PosterFormat, number> = { "30x40": 0, A3: 0, A2: 0 };

    for (const it of items) {
      const fmt = formatUiToInternal(it.format);
      const q = Math.max(0, Number(it.qty || 0));
      totals[fmt] += q;
    }

    setItems((prev) =>
      prev.map((it) => {
        const fmt = formatUiToInternal(it.format);
        const totalFmt = totals[fmt] || 0;
        const unit = calcUnitPriceEuros(fmt, totalFmt <= 0 ? 0 : totalFmt);
        const unitStr = String(unit.toFixed(2)).replace(".", ",");
        if (it.unitPriceEuros === unitStr) return it;
        return { ...it, unitPriceEuros: unitStr };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((x) => `${x.format}|${x.qty}`).join("||")]);

  async function refresh() {
    const r = await fetch("/api/consignments", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRows((j.consignments ?? []) as ConsignmentRow[]);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();

        const rc = await fetch("/api/clients", { cache: "no-store" });
        const jc = await rc.json().catch(() => ({}));
        if (!alive) return;
        setClients((jc.clients ?? []) as ClientUi[]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function syncItemFromSelection(item: DraftItem, nextFormatUi: DraftItem["format"], nextSuffix: string) {
    const fmt = formatUiToInternal(nextFormatUi);
    const p = getPosterBy(fmt, nextSuffix);
    return {
      ...item,
      format: nextFormatUi,
      suffix: nextSuffix,
      ref: p?.ref ?? item.ref,
      nameJP: p?.jp ?? item.nameJP,
      nameFR: p?.fr ?? item.nameFR,
    };
  }

  async function createConsignment() {
    if (!clientId) return alert("Choisis un client.");

    // garde-fous “adresse client” (comme devis)
    if (!billingStreet || !billingPostalCode || !billingCity) {
      return alert("Adresse client incomplète (Rue / CP / Ville). Corrige la fiche client.");
    }
    if (!snapLastName || !snapFirstName) {
      return alert("Renseigne Nom et Prénom (contact).");
    }
    if (client?.isProfessional && !snapSociete) {
      return alert("Client PRO : renseigne la Société.");
    }

    const payload = {
      clientId,
      depositDate,
      periodDays: Number(periodDays || 14),
      recoveryDate,

      // items (prix = auto)
      items: items.map((it) => ({
        ref: it.ref,
        format: it.format, // on garde l’affichage UI
        nameFR: it.nameFR,
        qty: Math.max(1, Number(it.qty || 1)),
        unitPrice: eurosToCents(it.unitPriceEuros),
      })),

      // ✅ optionnel : si plus tard tu veux stocker un “snapshot” complet,
      // on ne casse rien côté API actuelle (elle ignore les champs inconnus).
      clientSnapshot: {
        isProfessional: Boolean(client?.isProfessional),
        societe: snapSociete,
        service: snapService,
        siret: snapSiret,
        lastName: snapLastName,
        firstName: snapFirstName,
        billing: { street: billingStreet, postalCode: billingPostalCode, city: billingCity },
        validiteLabel,
      },
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

  const productOptions = useMemo(() => {
    // on s’appuie sur A3 (001..010) comme “catalogue”
    return POSTERS.A3.map((p) => ({
      suffix: p.suffix,
      label: `#${p.suffix} — ${p.jp} — ${p.fr}`,
    }));
  }, []);

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

        {/* Client + Validité */}
        <div className="grid gap-3 md:grid-cols-3">
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
                  {buildClientDisplayName(c)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="text-neutral-600">Validité</span>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 bg-neutral-50"
              value={validiteLabel}
              readOnly
              disabled
            />
          </label>
        </div>

        {/* Champs “comme devis” */}
        {!client ? (
          <div className="text-sm text-neutral-500">Sélectionne un client pour afficher les champs.</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {client.isProfessional ? (
                <>
                  <label className="text-sm md:col-span-2">
                    <span className="text-neutral-600">Société</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapSociete}
                      onChange={(e) => setSnapSociete(e.target.value)}
                      placeholder="Société"
                    />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Service</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapService}
                      onChange={(e) => setSnapService(e.target.value)}
                      placeholder="Service"
                    />
                  </label>

                  <label className="text-sm md:col-span-3">
                    <span className="text-neutral-600">SIRET</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapSiret}
                      onChange={(e) => setSnapSiret(e.target.value)}
                      placeholder="14 chiffres"
                    />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Nom (contact)</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapLastName}
                      onChange={(e) => setSnapLastName(e.target.value)}
                    />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Prénom (contact)</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapFirstName}
                      onChange={(e) => setSnapFirstName(e.target.value)}
                    />
                  </label>

                  <div className="hidden md:block" />
                </>
              ) : (
                <>
                  <label className="text-sm">
                    <span className="text-neutral-600">Nom</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapLastName}
                      onChange={(e) => setSnapLastName(e.target.value)}
                    />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Prénom</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapFirstName}
                      onChange={(e) => setSnapFirstName(e.target.value)}
                    />
                  </label>

                  <div className="hidden md:block" />
                </>
              )}
            </div>

            <div className="mt-2">
              <div className="text-sm font-medium">Adresse de facturation (adresse client)</div>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                <label className="text-sm md:col-span-2">
                  <span className="text-neutral-600">Rue</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-neutral-50"
                    value={billingStreet}
                    readOnly
                    disabled
                  />
                </label>
                <label className="text-sm">
                  <span className="text-neutral-600">Code postal</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-neutral-50"
                    value={billingPostalCode}
                    readOnly
                    disabled
                  />
                </label>
                <label className="text-sm md:col-span-3">
                  <span className="text-neutral-600">Ville</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-neutral-50"
                    value={billingCity}
                    readOnly
                    disabled
                  />
                </label>
              </div>
            </div>
          </>
        )}

        {/* Dates dépôt */}
        <div className="grid gap-3 md:grid-cols-4">
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
        </div>

        {/* Items */}
        <div className="rounded-2xl border overflow-hidden">
          <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-600">
                <tr>
                  <th className="px-4 py-3 w-[320px]">Article</th>
                  <th className="px-4 py-3 w-[120px]">Format</th>
                  <th className="px-4 py-3 w-[140px]">Référence</th>
                  <th className="px-4 py-3">Nom (JP)</th>
                  <th className="px-4 py-3">Nom (FR)</th>
                  <th className="px-4 py-3 w-[110px]">Qté</th>
                  <th className="px-4 py-3 w-[140px]">PU auto (€)</th>
                  <th className="px-4 py-3 w-[120px] text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id} className="border-t align-top">
                    <td className="px-4 py-2">
                      <select
                        className="w-full rounded-xl border px-3 py-2"
                        value={it.suffix}
                        onChange={(e) => {
                          const nextSuffix = e.target.value;
                          setItems((p) =>
                            p.map((x, i) =>
                              i === idx ? syncItemFromSelection(x, x.format, nextSuffix) : x
                            )
                          );
                        }}
                      >
                        {productOptions.map((o) => (
                          <option key={o.suffix} value={o.suffix}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-2">
                      <select
                        className="w-full rounded-xl border px-3 py-2"
                        value={it.format}
                        onChange={(e) => {
                          const nextFmt = e.target.value as any;
                          setItems((p) =>
                            p.map((x, i) =>
                              i === idx ? syncItemFromSelection(x, nextFmt, x.suffix) : x
                            )
                          );
                        }}
                      >
                        <option value="30×40">30×40</option>
                        <option value="A3">A3</option>
                        <option value="A2">A2</option>
                      </select>
                    </td>

                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded-xl border px-3 py-2 bg-neutral-50 tabular-nums"
                        value={it.ref}
                        readOnly
                        disabled
                      />
                    </td>

                    <td className="px-4 py-2">
                      <input className="w-full rounded-xl border px-3 py-2 bg-neutral-50" value={it.nameJP} readOnly disabled />
                    </td>

                    <td className="px-4 py-2">
                      <input className="w-full rounded-xl border px-3 py-2 bg-neutral-50" value={it.nameFR} readOnly disabled />
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
                        className="w-full rounded-xl border px-3 py-2 bg-neutral-50 tabular-nums"
                        value={it.unitPriceEuros}
                        readOnly
                        disabled
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
              Total quantité (tous formats) :{" "}
              <span className="font-medium text-neutral-900">{totalQtyAll}</span>
            </div>

            <button
              className="rounded-xl border px-3 py-2 text-xs"
              onClick={() => {
                const p = getPosterBy("A3", "001");
                setItems((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    format: "A3",
                    suffix: "001",
                    ref: p?.ref ?? "R-330001",
                    nameJP: p?.jp ?? "-",
                    nameFR: p?.fr ?? "-",
                    qty: "10",
                    unitPriceEuros: "",
                  },
                ]);
              }}
            >
              + Ajouter une ligne
            </button>
          </div>
        </div>

        {/* ✅ Bouton tout en bas de l’encart dépôt-vente */}
        <div className="pt-2 flex items-center justify-end">
          <button
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
            onClick={createConsignment}
            disabled={loading}
          >
            Générer le dépôt (ligne + PDF ensuite)
          </button>
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
                      {r.emailSentAt ? (
                        <span className="ml-2 inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                          📧 Envoyé le {fmtDateFR(r.emailSentAt)}
                        </span>
                      ) : null}
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
                          onClick={() =>
                            (window.location.href = `/depot-vente/${encodeURIComponent(r.id)}?action=sign`)
                          }
                        >
                          Signer
                        </button>

                        <button
                          className="rounded-xl border px-3 py-2 text-xs"
                          onClick={async () => {
                            if (!confirm("Envoyer ce dépôt-vente au client par email ?")) return;

                            const res = await fetch(`/api/consignments/${encodeURIComponent(r.id)}/send`, {
                              method: "POST",
                            });

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
