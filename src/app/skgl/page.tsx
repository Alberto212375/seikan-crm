"use client";

import { useMemo, useRef, useState } from "react";

export const dynamic = "force-dynamic";

type Poster = {
  ref: string;
  label: string;
  imageSrc: string;
};

const CODE = "skgl";
const DELIVERY_LABEL = "Livraison entre le 12 et le 15 mars";
const PACKAGING_LABEL = "Emballage en pochette plastique + carton rigide";

// ✅ règle commande classique
const FRANCO_CLASSIC_EUR = 180; // HT
const SHIPPING_CLASSIC_EUR = 20; // si franco non atteint

// ✅ règles quantités
const MIN_TEST = 2;
const MAX_TEST = 10;

const MIN_CLASSIC = 4;
const MAX_CLASSIC = 10; // ⚠️ tu n’as pas demandé de changer le max global, donc on garde 10 comme avant.

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

// ✅ prix unitaire HT en commande classique selon quantité
function classicUnitEur(totalQty: number) {
  const n = totalQty;
  if (n >= 50) return 10;
  if (n >= 20) return 11;
  if (n >= 10) return 13;
  return 14; // 1 à 9
}

export default function SkglPage() {
  const [code, setCode] = useState(CODE);
  const okCode = code.trim().toLowerCase() === CODE;

  // client fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [siret, setSiret] = useState("");
  const [email, setEmail] = useState("");

    // --- Autocomplete adresse (BAN) ---
  const [addrQuery, setAddrQuery] = useState("");
  const [addrOptions, setAddrOptions] = useState<
    Array<{ label: string; street: string; postalCode: string; city: string }>
  >([]);
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);

  async function fetchAddrOptions(q: string) {
    const query = q.trim();
    if (query.length < 4) {
      setAddrOptions([]);
      setAddrOpen(false);
      return;
    }

    setAddrLoading(true);
    try {
      const resp = await fetch(
        `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=6`
      );
      const data = await resp.json();

      const opts =
        (data?.features ?? [])
          .map((f: any) => {
            const p = f?.properties ?? {};
            const label = String(p.label ?? "").trim();
            const street = String(p.name ?? p.street ?? label ?? "").trim();
            const postalCode = String(p.postcode ?? "").trim();
            const city = String(p.city ?? "").trim();
            if (!label || !postalCode || !city) return null;
            return { label, street, postalCode, city };
          })
          .filter(Boolean) ?? [];

      setAddrOptions(opts);
      setAddrOpen(opts.length > 0);
    } catch {
      setAddrOptions([]);
      setAddrOpen(false);
    } finally {
      setAddrLoading(false);
    }
  }

  function chooseAddress(opt: {
    label: string;
    street: string;
    postalCode: string;
    city: string;
  }) {
    setAddrQuery(opt.label);
    setStreet(opt.street);
    setPostalCode(opt.postalCode);
    setCity(opt.city);
    setAddrOpen(false);
    setAddrOptions([]);
  }

  const [kind, setKind] = useState<"TEST" | "CLASSIC">("TEST");

  // qty per poster
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of POSTERS) init[p.ref] = 0;
    return init;
  });

  // bon pour accord + signature
  const [accepted, setAccepted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const [signatureDataUrl, setSignatureDataUrl] = useState<string>("");

  const totalQty = useMemo(() => {
    return Object.values(qty).reduce((s, n) => s + (Number(n) || 0), 0);
  }, [qty]);

  // ✅ prix unitaire selon type de commande
  const unitEur = useMemo(() => {
    if (kind === "TEST") return 12;
    return classicUnitEur(totalQty);
  }, [kind, totalQty]);

  const postersSubtotalEur = useMemo(() => totalQty * unitEur, [totalQty, unitEur]);

  // ✅ livraison en classique : franco 180€ HT, sinon 20€
  const shippingEur = useMemo(() => {
    if (kind === "TEST") return 0;
    if (postersSubtotalEur >= FRANCO_CLASSIC_EUR) return 0;
    return SHIPPING_CLASSIC_EUR;
  }, [kind, postersSubtotalEur]);

  const totalEur = useMemo(() => postersSubtotalEur + shippingEur, [postersSubtotalEur, shippingEur]);

  const qtyError = useMemo(() => {
    const min = kind === "TEST" ? MIN_TEST : MIN_CLASSIC;
    const max = kind === "TEST" ? MAX_TEST : MAX_CLASSIC;
    if (totalQty < min) return `Minimum ${min} posters au total.`;
    if (totalQty > max) return `Maximum ${max} posters au total.`;
    return "";
  }, [kind, totalQty]);

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

    deliveryWindowLabel: DELIVERY_LABEL,
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

    // ✅ on lit d’abord en texte (car parfois ce n’est pas du JSON)
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

      alert(`Erreur (${resp.status}) : ${msg}`);
      console.error("POST /api/public/orders FAILED", {
        status: resp.status,
        rawText,
        data,
        payloadSent: payload,
      });
      return;
    }

    alert("Commande envoyée ✅ Vous allez recevoir un email avec le PDF signé.");
  } catch (e: any) {
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
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold">Commande Posters 30×40</h1>

          {kind === "TEST" ? (
            <p className="mt-1 text-sm text-black/70">
              Commande test — Prix fixe : <span className="font-semibold">12 € HT / poster</span> — {DELIVERY_LABEL}
            </p>
          ) : (
            <div className="mt-1 space-y-2 text-sm text-black/70">
              <div>
                Commande classique — Prix HT selon quantité — Franco <span className="font-semibold">{FRANCO_CLASSIC_EUR} € HT</span> (sinon {SHIPPING_CLASSIC_EUR} €)
              </div>
              <div className="rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-xs">
                <div className="font-semibold text-black">Grille tarifaire (HT / unité)</div>
                <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-1">
                  <div>1 à 9</div>
                  <div className="text-right font-medium">14 €</div>
                  <div>10 à 19</div>
                  <div className="text-right font-medium">13 €</div>
                  <div>20 à 49</div>
                  <div className="text-right font-medium">11 €</div>
                  <div>50 et +</div>
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

                        {/* ✅ Adresse avec autocomplete + auto-remplissage CP/Ville */}
            <div className="mt-3 relative">
              <input
                className="w-full rounded-xl border border-black/15 px-4 py-3 outline-none focus:border-black/30"
                placeholder="Adresse (ex: 5 Rue de Normandie)"
                value={addrQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setAddrQuery(v);
                  // on laisse aussi street suivre la saisie libre tant que pas sélectionné
                  setStreet(v);
                  fetchAddrOptions(v);
                }}
                onFocus={() => {
                  if (addrOptions.length > 0) setAddrOpen(true);
                }}
                onBlur={() => {
                  // petit délai pour laisser le clic sur une option
                  setTimeout(() => setAddrOpen(false), 150);
                }}
              />

              {addrOpen ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
                  {addrLoading ? (
                    <div className="px-4 py-3 text-sm text-black/60">Recherche…</div>
                  ) : addrOptions.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-black/60">Aucune suggestion.</div>
                  ) : (
                    addrOptions.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        className="block w-full px-4 py-3 text-left text-sm hover:bg-black/5"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => chooseAddress(opt)}
                      >
                        <div className="font-medium text-black">{opt.label}</div>
                        <div className="text-xs text-black/60">
                          {opt.postalCode} {opt.city}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                className="rounded-xl border border-black/15 px-4 py-3"
                placeholder="Code postal"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
              <input
                className="rounded-xl border border-black/15 px-4 py-3"
                placeholder="Ville"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
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
                {kind === "TEST" ? `Min ${MIN_TEST} / Max ${MAX_TEST}` : `Min ${MIN_CLASSIC} / Max ${MAX_CLASSIC}`}
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm">
              <div className="font-medium">Emballage</div>
              <div className="text-black/70">{PACKAGING_LABEL}</div>
            </div>

            <div className="mt-4 rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-sm">
              <div className="font-medium">Livraison</div>
              <div className="text-black/70">{DELIVERY_LABEL} (non modifiable)</div>
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
                  Paiement à effectuer <span className="font-semibold">avant le 1er mars</span>, sinon la commande ne sera pas lancée.
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
                disabled={!canSubmit}
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
              : `Sélectionnez entre ${MIN_CLASSIC} et ${MAX_CLASSIC} posters au total. Format unique : 30×40.`}
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
                      max={MAX_CLASSIC} // même max que total (on garde simple)
                      value={v}
                      onChange={(e) =>
                        setQty((prev) => ({
                          ...prev,
                          [p.ref]: clampInt(e.target.value, 0, MAX_CLASSIC),
                        }))
                      }
                      className="w-24 rounded-xl border border-black/15 px-3 py-2 text-right text-sm"
                    />
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
