"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export const dynamic = "force-dynamic";

type Poster = {
  ref: string;
  label: string;
  imageSrc: string;
};

const CODE = "skgln";
const DELIVERY_TEST_LABEL = "Livraison entre le 12 et le 15 mars";
const PACKAGING_LABEL = "Emballage en pochette plastique + carton rigide";

// ✅ prix
const TEST_UNIT_EUR = 11;

// ✅ règle commande classique (livraison)
const FRANCO_CLASSIC_EUR = 180; // HT
const SHIPPING_CLASSIC_EUR = 20; // si franco non atteint

// ✅ règles quantités
const MIN_TEST = 4;
const MAX_TEST = 15;

// ✅ commande classique
const MIN_CLASSIC_TOTAL = 10;      // min 10 posters au total
const MIN_CLASSIC_PER_VISUAL = 2;  // min 2 par visuel sélectionné

const POSTERS: Poster[] = [
  { ref: "R-300001", label: "Visuel 1", imageSrc: "/posters/visuel-1.png" },
  { ref: "R-300002", label: "Visuel 2", imageSrc: "/posters/visuel-2.png" },
  { ref: "R-300003", label: "Visuel 3", imageSrc: "/posters/visuel-3.png" },
  { ref: "R-300004", label: "Visuel 4", imageSrc: "/posters/visuel-4.png" },
  { ref: "R-300005", label: "Visuel 5", imageSrc: "/posters/visuel-5.png" },
];

function clampInt(v: any, min: number, max: number) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function euros(n: number) {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function dataUrlLooksOk(s: string) {
  return typeof s === "string" && s.startsWith("data:image/");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function fmtFR(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; // YYYY-MM
}

// 1er jour ouvré du mois (si samedi/dimanche => lundi suivant)
function firstBusinessDayOfMonth(year: number, monthIndex0: number) {
  const d = new Date(year, monthIndex0, 1);
  const day = d.getDay(); // 0 dim, 6 sam
  if (day === 6) d.setDate(d.getDate() + 2); // samedi -> lundi
  if (day === 0) d.setDate(d.getDate() + 1); // dimanche -> lundi
  return d;
}

// livraison = entre J+12 et J+15 après clôture
function deliveryWindowFromClosure(closureISO: string) {
  const base = new Date(`${closureISO}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return "";
  const d12 = new Date(base);
  d12.setUTCDate(d12.getUTCDate() + 12);
  const d15 = new Date(base);
  d15.setUTCDate(d15.getUTCDate() + 15);
  return `Livraison entre le ${fmtFR(d12)} et le ${fmtFR(d15)}`;
}

function firstBusinessDayOfMonthISO(year: number, monthIndex0: number) {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const day = d.getUTCDay(); // 0 dim, 6 sam
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2); // samedi -> lundi
  if (day === 0) d.setUTCDate(d.getUTCDate() + 1); // dimanche -> lundi
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function allowedClassicClosuresISO(now = new Date()) {
  const list: string[] = [];
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  while (list.length < 2) {
    const y = cursor.getUTCFullYear();
    const m0 = cursor.getUTCMonth();
    const mm = m0 + 1;

    // ✅ skip mars (03)
    if (mm !== 3) {
      list.push(firstBusinessDayOfMonthISO(y, m0));
    }

    cursor = new Date(Date.UTC(y, m0 + 1, 1));
  }

  return list;
}

// ===============================
// ✅ AUTOCOMPLETE ADRESSE (gouv)
// ===============================
function normalizeSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

type AdresseSuggestion = {
  label: string;
  street: string;
  postalCode: string;
  city: string;
};

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
      const city = String(p.city ?? "").trim();

      // "name" = rue + numéro souvent
      const street = String(p.name ?? label).trim();

      return { label, street, postalCode, city };
    })
    .filter((x) => x.label && x.postalCode && x.city);
}

// ✅ prix unitaire HT en commande classique selon quantité
function classicUnitEur(totalQty: number) {
  const n = totalQty;
  if (n >= 40) return 10;
  if (n >= 20) return 11;
  if (n >= 10) return 13;
  // < 10 : la commande classique n'est pas autorisée
  return 0;
}

export default function SkglPage() {
  const [code, setCode] = useState("");
  const okCode = code.trim().toLowerCase() === CODE;

  // client fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
    // ✅ Autocomplete adresse (menu déroulant)
  const [openSuggest, setOpenSuggest] = useState(false);
  const [addrSuggestions, setAddrSuggestions] = useState<AdresseSuggestion[]>([]);
  const addrDebounceRef = useRef<any>(null);

  function onStreetChange(value: string) {
    setStreet(value);
    setOpenSuggest(true);

    if (addrDebounceRef.current) clearTimeout(addrDebounceRef.current);

    addrDebounceRef.current = setTimeout(async () => {
      const list = await fetchAdresseSuggestions(value);
      setAddrSuggestions(list);
    }, 220);
  }

  function selectAddress(s: AdresseSuggestion) {
    setStreet(s.street);
    setPostalCode(s.postalCode);
    setCity(s.city);
    setAddrSuggestions([]);
    setOpenSuggest(false);
  }

  const [companyName, setCompanyName] = useState("");
  const [siret, setSiret] = useState("");
  const [email, setEmail] = useState("");

  const [kind, setKind] = useState<"TEST" | "CLASSIC">("TEST");

  // ✅ Clôture (commande classique) : seulement les 2 prochaines clôtures
// Exception : on saute mars (op spéciale), donc on propose avril + mai.
const closureOptions = useMemo(() => {
  const now = new Date();

  // ✅ on exclut les clôtures passées : si la clôture (1er jour ouvré) est <= aujourd'hui, on ne la propose pas
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const list: { key: string; label: string; closureISO: string }[] = [];
  let cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  while (list.length < 2) {
    const y = cursor.getFullYear();
    const m0 = cursor.getMonth(); // 0..11
    const mm = m0 + 1;

    // ✅ skip mars (op spéciale)
    if (mm !== 3) {
      const closure = firstBusinessDayOfMonth(y, m0); // local
      const closureDayLocal = new Date(closure.getFullYear(), closure.getMonth(), closure.getDate());

      // ✅ on ne garde que les clôtures strictement futures
      if (closureDayLocal > todayLocal) {
        const key = monthKey(cursor); // YYYY-MM
        const closureISO = `${closure.getFullYear()}-${pad2(closure.getMonth() + 1)}-${pad2(
          closure.getDate()
        )}`;
        const label = `${key} — clôture le ${fmtFR(closure)}`;
        list.push({ key, label, closureISO });
      }
    }

    cursor = new Date(y, m0 + 1, 1);
  }

  return list;
}, []);

const [classicClosureKey, setClassicClosureKey] = useState<string>("");

useEffect(() => {
  if (!classicClosureKey && closureOptions.length > 0) {
    setClassicClosureKey(closureOptions[0].key);
  }
}, [classicClosureKey, closureOptions]);

const classicClosureISO = useMemo(() => {
  const found = closureOptions.find((x) => x.key === classicClosureKey) ?? closureOptions[0];
  return found?.closureISO || "";
}, [classicClosureKey, closureOptions]);

const deliveryWindowLabel = useMemo(() => {
  if (kind === "TEST") return DELIVERY_TEST_LABEL;
  return deliveryWindowFromClosure(classicClosureISO);
}, [kind, classicClosureISO]);

  // qty per poster
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of POSTERS) init[p.ref] = 0;
    return init;
  });

  // ✅ pour afficher l'erreur en rouge seulement après "sortie" du champ
const [touched, setTouched] = useState<Record<string, boolean>>(() => {
  const init: Record<string, boolean> = {};
  for (const p of POSTERS) init[p.ref] = false;
  return init;
});

  // bon pour accord + signature
  const [accepted, setAccepted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const [signatureDataUrl, setSignatureDataUrl] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ total posters (toutes quantités additionnées)
const totalQty = useMemo(() => {
  return Object.values(qty).reduce((s, n) => s + (Number(n) || 0), 0);
}, [qty]);

// ✅ prix unitaire selon type de commande
const unitEur = useMemo(() => {
  if (kind === "TEST") return TEST_UNIT_EUR;
  return classicUnitEur(totalQty);
}, [kind, totalQty]);

  // ✅ en CLASSIC : repère les visuels sélectionnés mais < 2
const perVisualErrors = useMemo(() => {
  if (kind !== "CLASSIC") return [];
  const bad: string[] = [];
  for (const p of POSTERS) {
    const v = Number(qty[p.ref] || 0);
    if (v > 0 && v < MIN_CLASSIC_PER_VISUAL) bad.push(p.ref);
  }
  return bad;
}, [kind, qty]);

  const postersSubtotalEur = useMemo(() => totalQty * unitEur, [totalQty, unitEur]);

  // ✅ livraison en classique : franco 180€ HT, sinon 20€
  const shippingEur = useMemo(() => {
    if (kind === "TEST") return 0;
    if (postersSubtotalEur >= FRANCO_CLASSIC_EUR) return 0;
    return SHIPPING_CLASSIC_EUR;
  }, [kind, postersSubtotalEur]);

  const totalEur = useMemo(() => postersSubtotalEur + shippingEur, [postersSubtotalEur, shippingEur]);

  const qtyError = useMemo(() => {
  if (kind === "TEST") {
    if (totalQty < MIN_TEST) return `Minimum ${MIN_TEST} posters au total.`;
    if (totalQty > MAX_TEST) return `Maximum ${MAX_TEST} posters au total.`;
    return "";
  }

  // ✅ CLASSIC (illimité)
  if (totalQty < MIN_CLASSIC_TOTAL) {
    return `Minimum ${MIN_CLASSIC_TOTAL} posters au total (commande classique).`;
  }
  if (perVisualErrors.length > 0) {
    return `Merci de sélectionner au moins ${MIN_CLASSIC_PER_VISUAL} posters par visuel.`;
  }
  if (!classicClosureISO) {
    return `Merci de choisir une clôture de commande.`;
  }
  return "";
}, [kind, totalQty, perVisualErrors, classicClosureISO]);

  const canSubmit = useMemo(() => {
    if (!okCode) return false;
    if (!firstName.trim() || !lastName.trim()) return false;
    if (!street.trim() || !postalCode.trim() || !city.trim()) return false;
    if (!email.trim()) return false;
    if (qtyError) return false;
    if (!accepted) return false;
    if (!dataUrlLooksOk(signatureDataUrl)) return false;
    return true;
  }, [okCode, firstName, lastName, street, postalCode, city, email, qtyError, accepted, signatureDataUrl]);

  function getCtx() {
    const c = canvasRef.current;
    if (!c) return null;
    return c.getContext("2d");
  }

  function resizeCanvasIfNeeded() {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (c.width === w && c.height === h) return;

    const ctx = c.getContext("2d");
    c.width = w;
    c.height = h;
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
  }

  function canvasPoint(e: any) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e: any) {
    if (!canvasRef.current) return;
    resizeCanvasIfNeeded();
    drawing.current = true;
    lastPt.current = canvasPoint(e);
  }

  function moveDraw(e: any) {
    if (!drawing.current) return;
    const ctx = getCtx();
    if (!ctx || !canvasRef.current) return;

    e.preventDefault?.();

    const pt = canvasPoint(e);
    const prev = lastPt.current;
    if (!prev) {
      lastPt.current = pt;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();

    lastPt.current = pt;
  }

  function endDraw() {
    if (!drawing.current) return;
    drawing.current = false;
    lastPt.current = null;

    const c = canvasRef.current;
    if (!c) return;

    const url = c.toDataURL("image/png");
    setSignatureDataUrl(url);
  }

  function clearSignature() {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setSignatureDataUrl("");
  }

    async function submit() {
    if (!canSubmit) return;
    setIsSubmitting(true);

    // ✅ items posters avec PU calculé selon TEST/CLASSIC
    const unitPriceCents = Math.round(unitEur * 100);

    const posterItems = POSTERS.map((p, idx) => ({
      ref: p.ref,
      label: p.label,
      qty: Number(qty[p.ref] || 0),
      unitPriceCents,
      sort: idx,
    })).filter((x) => x.qty > 0);

    // ✅ ligne livraison seulement si CLASSIC (avec 0 ou 20)
    const shippingItem =
      kind === "CLASSIC"
        ? [
            {
              ref: "LIVRAISON",
              label:
                shippingEur === 0
                  ? `Livraison offerte (Franco supérieur à ${FRANCO_CLASSIC_EUR}€ HT)`
                  : `Frais de livraison (Franco supérieur à ${FRANCO_CLASSIC_EUR}€ HT)`,
              qty: 1,
              unitPriceCents: Math.round(shippingEur * 100),
              sort: 9998,
            },
          ]
        : [];

    const items = [...posterItems, ...shippingItem];

    const payload = {
      code: CODE,
      kind,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      companyName: companyName.trim() || null,
      siret: siret.trim() || null,
      street: street.trim(),
      postalCode: postalCode.trim(),
      city: city.trim(),

      closureMonthKey: kind === "CLASSIC" ? classicClosureKey : null,
closureDateISO: kind === "CLASSIC" ? classicClosureISO : null,

deliveryWindowLabel,
packagingLabel: PACKAGING_LABEL,
      // ✅ total HT incluant livraison si classique
      totalCents: Math.round(totalEur * 100),

      pricing: {
        postersUnitEur: unitEur,
        postersSubtotalEur,
        francoClassicEur: FRANCO_CLASSIC_EUR,
        shippingEur,
        totalEur,
      },

      items,

      signature: {
        accepted: true,
        signerFirstName: firstName.trim(),
        signerLastName: lastName.trim(),
        signerRole: "Client",
        signedAt: new Date().toISOString(),
        signatureDataUrl,
      },
    };

    let resp: Response | null = null;
    let rawText = "";
    let data: any = null;

    try {
      resp = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      rawText = await resp.text();
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      if (!resp.ok) {
        const msg =
          (data && (data.error || data.message)) ||
          rawText ||
          "Erreur inconnue (réponse vide).";

        setIsSubmitting(false);
        alert(`Erreur (${resp.status}) : ${msg}`);
        console.error("POST /api/public/orders FAILED", {
          status: resp.status,
          rawText,
          data,
          payloadSent: payload,
        });
        return;
      }

      setIsSubmitting(false);
      alert("Commande envoyée ✅ Vous allez recevoir un email avec le PDF signé.");
    } catch (e: any) {
      setIsSubmitting(false);
      alert(`Erreur réseau : ${e?.message || "inconnue"}`);
      console.error("POST /api/public/orders NETWORK ERROR", e);
    }
  }


  if (!okCode) {
    return (
      <div className="min-h-screen bg-[#F9F9FA] px-4 py-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Accès</h1>
          <p className="mt-2 text-sm text-black/70">Entrez votre code d’accès.</p>
          <input
            className="mt-4 w-full rounded-xl border border-black/15 px-4 py-3 outline-none focus:border-black/30"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code"
          />
          <p className="mt-3 text-sm text-red-700">Accès refusé (code invalide).</p>
        </div>
      </div>
    );
  }

  return (
  <div className="min-h-screen bg-[#F9F9FA] px-4 py-10">
    {isSubmitting && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm">
        <div className="rounded-2xl border border-black/10 bg-white px-8 py-6 shadow-lg">
          <div className="text-lg font-semibold text-black">Envoi en cours…</div>
          <div className="mt-2 text-sm text-black/60">Merci de patienter quelques secondes</div>
        </div>
      </div>
    )}

    <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Commande Posters 30×40</h1>

          {kind === "TEST" ? (
            <p className="mt-1 text-sm text-black/70">
              Commande test — Prix fixe : <span className="font-semibold">{TEST_UNIT_EUR} € HT / poster</span> — {deliveryWindowLabel}
            </p>
          ) : (
            <div className="mt-1 space-y-2 text-sm text-black/70">
              <div>
                Commande classique — Prix HT selon quantité — Franco <span className="font-semibold">{FRANCO_CLASSIC_EUR} € HT</span> (sinon {SHIPPING_CLASSIC_EUR} €)
              </div>
              <div className="rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-xs">
                <div className="font-semibold text-black">Grille tarifaire (HT / unité)</div>
                <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-1">
  <div>10 à 19</div>
  <div className="text-right font-medium">13 €</div>
  <div>20 à 39</div>
  <div className="text-right font-medium">11 €</div>
  <div>40 et +</div>
  <div className="text-right font-medium">10 €</div>
</div>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Informations client</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input className="rounded-xl border border-black/15 px-4 py-3" placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input className="rounded-xl border border-black/15 px-4 py-3" placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="rounded-xl border border-black/15 px-4 py-3" placeholder="Société" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              <input className="rounded-xl border border-black/15 px-4 py-3" placeholder="SIRET" value={siret} onChange={(e) => setSiret(e.target.value)} />
            </div>

            <div className="mt-3">
              <input className="w-full rounded-xl border border-black/15 px-4 py-3" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="mt-3">
  <div className="relative">
    <input
      className="w-full rounded-xl border border-black/15 px-4 py-3"
      placeholder="Rue"
      value={street}
      onChange={(e) => onStreetChange(e.target.value)}
      onFocus={() => setOpenSuggest(true)}
      onBlur={() => setTimeout(() => setOpenSuggest(false), 120)}
    />

    {openSuggest && addrSuggestions.length > 0 && (
      <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg">
        {addrSuggestions.map((s, idx) => (
          <button
            key={`${s.label}-${idx}`}
            type="button"
            className="block w-full px-4 py-3 text-left text-sm hover:bg-neutral-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectAddress(s)}
          >
            {s.label}
          </button>
        ))}
      </div>
    )}
  </div>
</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input className="rounded-xl border border-black/15 px-4 py-3" placeholder="Code postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              <input className="rounded-xl border border-black/15 px-4 py-3" placeholder="Ville" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>

            <div className="mt-5">
              <label className="text-sm font-medium">Type de commande</label>
              <select
                className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3"
                value={kind}
                onChange={(e) => setKind(e.target.value as any)}
              >
                <option value="TEST">Commande test</option>
                <option value="CLASSIC">Commande classique</option>
              </select>
              <div className="mt-2 text-xs text-black/60">
                {kind === "TEST"
  ? `Min ${MIN_TEST} / Max ${MAX_TEST}`
  : `Min ${MIN_CLASSIC_TOTAL} posters au total — min ${MIN_CLASSIC_PER_VISUAL} par visuel — pas de maximum`}
              </div>
                        </div>

            {kind === "CLASSIC" ? (
              <div className="mt-4 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm">
                <div className="font-medium">Clôture de commande</div>

                <select
                  className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3"
                  value={classicClosureKey}
                  onChange={(e) => setClassicClosureKey(e.target.value)}
                >
                  {closureOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <div className="mt-2 text-xs text-black/60">
                  Livraison calculée automatiquement :{" "}
                  <span className="font-medium">{deliveryWindowLabel}</span>
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm">
              <div className="font-medium">Emballage</div>
              <div className="text-black/70">{PACKAGING_LABEL}</div>
            </div>

            <div className="mt-4 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm">
              <div className="font-medium">Livraison</div>
              <div className="text-black/70">{deliveryWindowLabel} (non modifiable)</div>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Récapitulatif</h2>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Total posters</span>
                <span className="font-semibold">{totalQty}</span>
              </div>

              <div className="flex items-center justify-between">
                <span>Prix unitaire (HT)</span>
                <span className="font-semibold">{euros(unitEur)}</span>
              </div>

              <div className="flex items-center justify-between">
                <span>Sous-total posters (HT)</span>
                <span className="font-semibold">{euros(postersSubtotalEur)}</span>
              </div>

              {kind === "CLASSIC" ? (
                <div className="flex items-center justify-between">
                  <span>Livraison (HT)</span>
                  <span className="font-semibold">{euros(shippingEur)}</span>
                </div>
              ) : null}

              <div className="h-px bg-black/10" />

              <div className="flex items-center justify-between text-base">
                <span className="font-semibold">Total (HT)</span>
                <span className="font-semibold">{euros(totalEur)}</span>
              </div>

              {qtyError ? <div className="mt-3 text-sm text-red-700">{qtyError}</div> : null}

              {kind === "CLASSIC" ? (
                <div className="mt-4 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-xs text-black/70">
                  Franco : {FRANCO_CLASSIC_EUR}€ HT —{" "}
                  {shippingEur === 0 ? (
                    <span className="font-semibold text-black">livraison offerte</span>
                  ) : (
                    <span className="font-semibold text-black">+{SHIPPING_CLASSIC_EUR}€</span>
                  )}
                </div>
              ) : null}

              <div className="mt-5 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm">
  <div className="font-medium">Paiement</div>
  <div className="text-black/70">
    Paiement à effectuer{" "}
    <span className="font-semibold">
      {kind === "TEST"
        ? "avant le 1er mars"
        : classicClosureISO
        ? `avant le ${fmtFR(new Date(`${classicClosureISO}T00:00:00.000Z`))}`
        : "avant la clôture sélectionnée"}
    </span>
    , sinon la commande ne sera pas lancée.
  </div>
</div>

              <label className="mt-5 flex items-center gap-3 text-sm">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span className="font-medium">Bon pour accord</span>
              </label>

              <div className="mt-4">
                <div className="text-sm font-medium">Signature</div>
                <div className="mt-2 rounded-xl border border-black/15 bg-white p-3">
                  <canvas
                    ref={canvasRef}
                    className="h-40 w-full rounded-lg border border-black/10 bg-white touch-none"
                    onMouseDown={startDraw}
                    onMouseMove={moveDraw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    onTouchStart={startDraw}
                    onTouchMove={moveDraw}
                    onTouchEnd={endDraw}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button type="button" className="rounded-xl border border-black/15 px-4 py-2 text-sm" onClick={clearSignature}>
                      Effacer
                    </button>
                    <div className="text-xs text-black/60">{signatureDataUrl ? "Signature enregistrée ✓" : "Signez au doigt / souris / trackpad"}</div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isSubmitting || !canSubmit}
                onClick={submit}
                className={`mt-5 w-full rounded-2xl px-5 py-3 text-sm font-semibold shadow-sm ${
                  canSubmit ? "bg-black text-white" : "bg-black/20 text-black/40"
                }`}
              >
                Envoyer la commande
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Visuels</h2>
          <p className="mt-1 text-sm text-black/70">
            {kind === "TEST"
  ? `Sélectionnez entre ${MIN_TEST} et ${MAX_TEST} posters au total. Format unique : 30×40.`
  : `Sélectionnez au moins ${MIN_CLASSIC_TOTAL} posters au total, avec minimum ${MIN_CLASSIC_PER_VISUAL} par visuel sélectionné. Pas de maximum. Format unique : 30×40.`}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {POSTERS.map((p) => {
              const v = Number(qty[p.ref] || 0);
              return (
                <div key={p.ref} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold">{p.ref}</div>
                  <div className="text-xs text-black/60">{p.label}</div>

                  <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-black/5">
                    <img
  src={p.imageSrc}
  alt={p.label}
  className="h-44 w-full object-contain object-center"
/>

                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-sm text-black/70">Quantité</div>
                    <input
  type="number"
  min={0}
  value={v}
  onChange={(e) => {
    const raw = Math.trunc(Number(e.target.value));
    const n = Number.isFinite(raw) ? raw : 0;

    setQty((prev) => {
      const prevVal = Number(prev[p.ref] || 0);

      // ✅ TEST : clamp 0..MAX_TEST
      if (kind === "TEST") {
        return { ...prev, [p.ref]: clampInt(n, 0, MAX_TEST) };
      }

      // ✅ CLASSIC : illimité
      // si on "active" un visuel (0 -> >0), on met 2 automatiquement
      if (prevVal === 0 && n > 0) {
        return { ...prev, [p.ref]: Math.max(MIN_CLASSIC_PER_VISUAL, n) };
      }

      // sinon : l'utilisateur tape ce qu'il veut (>=0)
      return { ...prev, [p.ref]: Math.max(0, n) };
    });
  }}
  onBlur={() => {
    if (kind === "CLASSIC") {
      setTouched((prev) => ({ ...prev, [p.ref]: true }));
    }
  }}
  className={`w-24 rounded-xl border px-3 py-2 text-right text-sm ${
    kind === "CLASSIC" && touched[p.ref] && v > 0 && v < MIN_CLASSIC_PER_VISUAL
      ? "border-red-500 text-red-700"
      : "border-black/15"
  }`}
/>
{kind === "CLASSIC" && touched[p.ref] && v > 0 && v < MIN_CLASSIC_PER_VISUAL ? (
  <div className="mt-1 text-xs text-red-700">
    Merci de sélectionner plus de {MIN_CLASSIC_PER_VISUAL} posters par visuel.
  </div>
) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 text-xs text-black/50">Astuce : si tu veux un rendu premium identique CRM, on peut reprendre tes composants UI plus tard.</div>
        </div>
      </div>
    </div>
  );
}
