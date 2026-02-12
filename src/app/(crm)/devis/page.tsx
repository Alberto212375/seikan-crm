// src/app/(crm)/devis/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

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

  // prospection
  prospectedByPhone: boolean;
  prospectedByEmail: boolean;
  prospectedInPerson: boolean;

  // meta
  clientDepuisLe: string; // YYYY-MM-DD

  // note libre
  notes: string;
};

type QuoteRow = {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  issueDate: string;
  clientName: string;
  clientService: string | null;
  metaJson: string | null;

  totalHT: number;
  depositHT: number;
  depositPaid: boolean;
  depositPaidAmount: number;
};

type QuoteMeta = {
  party?: {
    isProfessional?: boolean;
    lastName?: string;
    firstName?: string;
    societe?: string;
    service?: string;
    siret?: string;
  };

  posters?: {
  deferredPayment?: boolean;
  closingDate?: string; // ✅ utilisé pour affichage "avant le" (clôture - 2 jours)
};

  signature?: {
    signerFirstName?: string;
    signerLastName?: string;
    signerRole?: string;
    accepted?: boolean;
    signedAt?: string;
    signatureDataUrl?: string;
    context?: { ip?: string; userAgent?: string };
  };
};

function eurosToCents(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function centsToEurosStr(c: number) {
  return (c / 100).toFixed(2).replace(".", ",");
}

function computeRemainingHTCents(q: QuoteRow) {
  const paid = q.depositPaid ? Math.max(0, q.depositPaidAmount || 0) : 0;
  return Math.max(0, (q.totalHT || 0) - paid);
}
function computeRemainingTTCCents(q: QuoteRow) {
  return computeRemainingHTCents(q);
}

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function getDeferredPaymentFromMeta(metaJson: string | null): boolean {
  const meta = safeJsonParse<QuoteMeta>(metaJson) ?? {};
  return Boolean(meta?.posters?.deferredPayment);
}

function getSignatureFromMeta(metaJson: string | null) {
  const meta = safeJsonParse<QuoteMeta>(metaJson) ?? {};
  return meta?.signature ?? null;
}

function isQuoteSigned(metaJson: string | null) {
  const sig = getSignatureFromMeta(metaJson);
  return Boolean(sig?.accepted && sig?.signedAt && sig?.signatureDataUrl);
}

function fmtDateFR(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function fmtDayMonthShort(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseIsoDateOnly(s: string): Date | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

// ✅ échéance "avant le" = 2 jours avant la clôture
function computePayBeforeFromMeta(metaJson: string | null): Date | null {
  const meta = safeJsonParse<QuoteMeta>(metaJson) ?? {};
  const closingIso = String(meta?.posters?.closingDate ?? "").trim();
  const closing = closingIso ? parseIsoDateOnly(closingIso) : null;
  if (!closing) return null;
  const d = new Date(closing);
  d.setDate(d.getDate() - 2);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ✅ date "commande" = signature si dispo, sinon date émission devis (issueDate/createdAt)
function computeBalanceDueFromQuote(q: QuoteRow): Date | null {
  const meta = safeJsonParse<QuoteMeta>(q.metaJson) ?? {};
  const signedAt = meta?.signature?.signedAt ? new Date(meta.signature.signedAt) : null;
  const ref =
    signedAt && !Number.isNaN(signedAt.getTime())
      ? signedAt
      : (() => {
          const d = new Date(q.issueDate || q.createdAt);
          return Number.isNaN(d.getTime()) ? null : d;
        })();

  if (!ref) return null;
  return addDays(ref, 30);
}

function extractPartyInfo(q: QuoteRow) {
  const meta = safeJsonParse<QuoteMeta>(q.metaJson) ?? {};
  const party = meta.party ?? {};
  const isPro = Boolean(party.isProfessional) || Boolean(q.clientService);

  if (isPro) {
    return {
      isPro: true,
      societe: String(party.societe ?? q.clientName ?? "").trim(),
      service: String(party.service ?? q.clientService ?? "").trim(),
      lastName: String(party.lastName ?? "").trim(),
      firstName: String(party.firstName ?? "").trim(),
    };
  }

  const ln = String(party.lastName ?? "").trim();
  const fn = String(party.firstName ?? "").trim();

  if (ln || fn) {
    return { isPro: false, societe: "", service: "", lastName: ln, firstName: fn };
  }

  const raw = String(q.clientName ?? "").trim();
  const parts = raw
    .split(/\s*[-\u2012\u2013\u2014\u2015—]\s*/g)
    .map((x) => x.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      isPro: false,
      societe: "",
      service: "",
      lastName: parts[0] ?? "",
      firstName: parts.slice(1).join(" ") ?? "",
    };
  }

  return { isPro: false, societe: "", service: "", lastName: raw, firstName: "" };
}

function joinAddress(street: string, postalCode: string, city: string) {
  const s = String(street || "").trim();
  const cp = String(postalCode || "").trim();
  const c = String(city || "").trim();
  const parts = [s, [cp, c].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
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

/* -------------------- Posters spec -------------------- */

type PosterFormat = "30x40" | "A3" | "A2";
type PosterRef = {
  format: PosterFormat;
  ref: string; // R-XXXXXX
  name: string; // nom commercial (latin)
  fr: string; // traduction FR (ou "-" si aucune)
};

function displayPosterName(p: PosterRef) {
  // ✅ pas de japonais, uniquement latin + FR
  if (!p.name || p.name === "-" || p.fr === "-") return "-";
  return `${p.name} — ${p.fr}`;
}

const POSTERS: Record<PosterFormat, PosterRef[]> = {
  "30x40": [
    { format: "30x40", ref: "R-304001", name: "Shizuka no Tsubasa", fr: "Les ailes silencieuses" },
    { format: "30x40", ref: "R-304002", name: "Tabi no Hajimari", fr: "Le début du voyage" },
    { format: "30x40", ref: "R-304003", name: "Eien no Koi", fr: "La carpe éternelle" },
    { format: "30x40", ref: "R-304004", name: "Kinu no Onna", fr: "La femme de soie" },
    { format: "30x40", ref: "R-304005", name: "Uchi no Yama", fr: "La montagne intérieure" },
    // ✅ refs 6→10 : pas de nom
    { format: "30x40", ref: "R-304006", name: "-", fr: "-" },
    { format: "30x40", ref: "R-304007", name: "-", fr: "-" },
    { format: "30x40", ref: "R-304008", name: "-", fr: "-" },
    { format: "30x40", ref: "R-304009", name: "-", fr: "-" },
    { format: "30x40", ref: "R-304010", name: "-", fr: "-" },
  ],
  A3: [
    { format: "A3", ref: "R-330001", name: "Shizuka no Tsubasa", fr: "Les ailes silencieuses" },
    { format: "A3", ref: "R-330002", name: "Tabi no Hajimari", fr: "Le début du voyage" },
    { format: "A3", ref: "R-330003", name: "Eien no Koi", fr: "La carpe éternelle" },
    { format: "A3", ref: "R-330004", name: "Kinu no Onna", fr: "La femme de soie" },
    { format: "A3", ref: "R-330005", name: "Uchi no Yama", fr: "La montagne intérieure" },
    { format: "A3", ref: "R-330006", name: "-", fr: "-" },
    { format: "A3", ref: "R-330007", name: "-", fr: "-" },
    { format: "A3", ref: "R-330008", name: "-", fr: "-" },
    { format: "A3", ref: "R-330009", name: "-", fr: "-" },
    { format: "A3", ref: "R-330010", name: "-", fr: "-" },
  ],
  A2: [
    { format: "A2", ref: "R-420001", name: "Shizuka no Tsubasa", fr: "Les ailes silencieuses" },
    { format: "A2", ref: "R-420002", name: "Tabi no Hajimari", fr: "Le début du voyage" },
    { format: "A2", ref: "R-420003", name: "Eien no Koi", fr: "La carpe éternelle" },
    { format: "A2", ref: "R-420004", name: "Kinu no Onna", fr: "La femme de soie" },
    { format: "A2", ref: "R-420005", name: "Uchi no Yama", fr: "La montagne intérieure" },
    { format: "A2", ref: "R-420006", name: "-", fr: "-" },
    { format: "A2", ref: "R-420007", name: "-", fr: "-" },
    { format: "A2", ref: "R-420008", name: "-", fr: "-" },
    { format: "A2", ref: "R-420009", name: "-", fr: "-" },
    { format: "A2", ref: "R-420010", name: "-", fr: "-" },
  ],
};

type PaperWeight = "250g" | "135g";

function calcUnitPriceEuros(format: PosterFormat, totalUnitsInFormat: number, paper: PaperWeight) {
  const n = totalUnitsInFormat;

  // ✅ A2 : NE CHANGE PAS (on garde l’ancienne logique A2 = grille 250g + 8€, indépendante du grammage)
  if (format === "A2") {
    const base250 =
      n >= 50 ? 12 :
      n >= 25 ? 14 :
      n >= 10 ? 16 :
      18;
    return base250 + 8;
  }

    // ✅ 30×40
  if (format === "30x40") {
    if (paper === "250g") {
      // 250g 30×40 : 1–9:18 / 10–24:16 / 25–49:13 / 50+:12
      return n >= 50 ? 12 : n >= 25 ? 13 : n >= 10 ? 16 : 18;
    }
    // 135g 30×40 : 1–9:15 / 10–24:13 / 25–49:11 / 50+:10
    return n >= 50 ? 10 : n >= 25 ? 11 : n >= 10 ? 13 : 15;
  }

  // ✅ A3
  if (format === "A3") {
    if (paper === "250g") {
      // 250g A3 : 1–9:17 / 10–24:15 / 25–49:13 / 50+:12
      return n >= 50 ? 12 : n >= 25 ? 13 : n >= 10 ? 15 : 17;
    }
    // 135g A3 : 1–9:14 / 10–24:12 / 25–49:11 / 50+:10
    return n >= 50 ? 10 : n >= 25 ? 11 : n >= 10 ? 12 : 14;
  }

  // fallback (au cas où)
  return 0;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function addBusinessDays(date: Date, days: number) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 dimanche, 6 samedi
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function fmtDateFRLong(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function fmtDayMonth(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}
function fmtDay(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "numeric" });
}
function fmtMonthYear(d: Date) {
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function toIsoDateOnly(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function next12ClosingsFirstOfMonth(from = new Date()) {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);

  // prochaine clôture = 1er du mois (mois courant si on est le 1er, sinon mois suivant)
  let cur = new Date(base.getFullYear(), base.getMonth(), 1);
  if (base.getTime() > cur.getTime()) cur = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  const out: Array<{ key: string; label: string; date: Date }> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(cur.getFullYear(), cur.getMonth() + i, 1);
    out.push({ key: toIsoDateOnly(d), label: `Clôture — ${fmtDateFRLong(d)}`, date: d });
  }
  return out;
}

function computeDeliveryWindowFromClosure(closure: Date) {
  const start = addDays(closure, 11);
  const end = addDays(closure, 14);

  const s = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(start);
  const e = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(end);

  return `Livraison entre le ${s} et le ${e}`;
}

/* -------------------- Liste devis -------------------- */

function QuoteList({
  createdNumber,
  createdId,
  onCreate,
}: {
  createdNumber: string;
  createdId: string;
  onCreate: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [facturedQuoteIds, setFacturedQuoteIds] = useState<Set<string>>(new Set());

        // ✅ Signature : autorisée sur appareils tactiles (iPad inclus), sans dépendre de la largeur
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const compute = () => {
      if (typeof window === "undefined") return setIsTouch(false);

      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const touchPoints = (navigator as any)?.maxTouchPoints ?? 0;

      // iPad / tablette / PC tactile : on autorise la signature
      setIsTouch(coarse || touchPoints > 0);
    };

    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // ✅ modale signature
  const [signOpen, setSignOpen] = useState(false);
  const [signQuoteId, setSignQuoteId] = useState<string>("");
  const [signerFirstName, setSignerFirstName] = useState("");
  const [signerLastName, setSignerLastName] = useState("");
  const [signerRole, setSignerRole] = useState("Gérant");
  const [bonPourAccord, setBonPourAccord] = useState(false);
  const [signSaving, setSignSaving] = useState(false);
  


    // ✅ Empêche la page de scroller pendant la signature (iPad/Safari)
  useEffect(() => {
    if (!signOpen) return;

    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverscroll = (document.body.style as any).overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    (document.body.style as any).overscrollBehavior = "contain";

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      (document.body.style as any).overscrollBehavior = prevBodyOverscroll;
    };
  }, [signOpen]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  function openSignatureModal(q: QuoteRow) {
  const meta = safeJsonParse<QuoteMeta>(q.metaJson) ?? {};
  const party = meta.party ?? {};

  const fn = String(party.firstName ?? "").trim();
  const ln = String(party.lastName ?? "").trim();

  setSignerFirstName(fn);
  setSignerLastName(ln);
  setSignerRole("");
  setBonPourAccord(false);

  setSignQuoteId(q.id);
  setSignOpen(true);

  setTimeout(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const rect = c.getBoundingClientRect();
    c.width = Math.max(300, Math.floor(rect.width));
    c.height = 140;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, 50);
}

function clearSignature() {
  const c = canvasRef.current;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, c.width, c.height);
}

function getSignatureDataUrl(): string {
  const c = canvasRef.current;
  if (!c) return "";
  return c.toDataURL("image/png");
}

function getPos(e: any, canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();

  const t = e?.touches?.[0] || e?.changedTouches?.[0] || null;

  const clientX = t ? t.clientX : e.clientX;
  const clientY = t ? t.clientY : e.clientY;

  return { x: clientX - r.left, y: clientY - r.top };
}

function startDraw(e: any) {
  if (e?.preventDefault) e.preventDefault();

  const c = canvasRef.current;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;

  drawingRef.current = true;
  const { x, y } = getPos(e, c);
  ctx.beginPath();
  ctx.moveTo(x, y);
}


function moveDraw(e: any) {
  if (e?.preventDefault) e.preventDefault();

  if (!drawingRef.current) return;
  const c = canvasRef.current;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;

  const { x, y } = getPos(e, c);
  ctx.lineTo(x, y);
  ctx.stroke();
}

function endDraw() {
  drawingRef.current = false;
}

async function saveSignature() {
  if (!signQuoteId) return;

  const fn = String(signerFirstName || "").trim();
  const ln = String(signerLastName || "").trim();
  const role = String(signerRole || "").trim();

  if (!fn || !ln) {
    alert("Renseigne le prénom et le nom du signataire.");
    return;
  }
  if (!bonPourAccord) {
    alert("Coche la mention 'Bon pour accord' avant de valider.");
    return;
  }

  const dataUrl = getSignatureDataUrl();
  if (!dataUrl.startsWith("data:image/")) {
    alert("Signature invalide.");
    return;
  }

  setSignSaving(true);
  try {
    const r = await fetch(`/api/quotes/${encodeURIComponent(signQuoteId)}/signature`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signerFirstName: fn,
        signerLastName: ln,
        signerRole: role,
        accepted: true,
        signatureDataUrl: dataUrl,
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur enregistrement signature");
      return;
    }

    // refresh liste devis
    const rr = await fetch("/api/quotes", { cache: "no-store" });
    const jj = await rr.json();
    setQuotes((jj.quotes ?? []) as QuoteRow[]);

    setSignOpen(false);
    setSignQuoteId("");
  } finally {
    setSignSaving(false);
  }
}


  useEffect(() => {
    let alive = true;
    fetch("/api/invoices/by-quote", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setFacturedQuoteIds(new Set((j?.quoteIds ?? []) as string[]));
      })
      .catch(() => {
        if (!alive) return;
        setFacturedQuoteIds(new Set());
      });
    return () => {
      alive = false;
    };
  }, []);

 useEffect(() => {
  let alive = true;

  (async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/quotes", { cache: "no-store" });
      const j = await r.json();
      if (!alive) return;
      setQuotes((j.quotes ?? []) as QuoteRow[]);
    } finally {
      if (alive) setLoading(false);
    }
  })();

  return () => {
    alive = false;
  };
}, []);

    return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold">Devis</div>
          <div className="text-sm text-neutral-700">Tous les devis générés (PRO / Particulier).</div>
        </div>

        <button type="button" onClick={onCreate} className="rounded-xl bg-black px-4 py-2 text-sm text-white">
          Créer un devis
        </button>
      </div>

      {!!createdNumber && (
        <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-medium">
            Devis créé : <span className="tabular-nums">{createdNumber}</span>
          </div>
          {!!createdId && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="rounded-xl border px-4 py-2 text-sm"
                href={`/api/exports/quotes/${createdId}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Télécharger PDF
              </a>
              <a
                className="rounded-xl border px-4 py-2 text-sm"
                href={`/api/exports/quotes/${createdId}/csv`}
                target="_blank"
                rel="noreferrer"
              >
                Export Excel (CSV)
              </a>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full table-auto text-[13px] md:text-[15px]">
            <thead className="bg-neutral-50 text-left">
  <tr className="text-neutral-800">
                <th className="px-4 py-3 md:px-5 md:py-4 whitespace-nowrap">N°</th>
<th className="px-4 py-3 md:px-5 md:py-4 whitespace-nowrap">Date</th>
<th className="px-4 py-3 md:px-5 md:py-4 whitespace-nowrap">Type</th>
<th className="px-4 py-3 md:px-5 md:py-4">Société</th>
<th className="px-4 py-3 md:px-5 md:py-4">Service</th>
<th className="px-4 py-3 md:px-5 md:py-4">Nom</th>
<th className="px-4 py-3 md:px-5 md:py-4">Prénom</th>
<th className="px-4 py-3 md:px-5 md:py-4">Acompte</th>
<th className="px-4 py-3 md:px-5 md:py-4 whitespace-nowrap">Restant (HT / TTC)</th>
<th className="px-4 py-3 md:px-5 md:py-4 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr className="border-t">
                  <td colSpan={10} className="px-4 py-8 text-center text-neutral-500">
                    Chargement…
                  </td>
                </tr>
              ) : quotes.length === 0 ? (
                <tr className="border-t">
                  <td colSpan={10} className="px-4 py-8 text-center text-neutral-500">
                    Aucun devis pour l’instant.
                  </td>
                </tr>
              ) : (
                quotes.map((q) => {
                  const info = extractPartyInfo(q);

                  const deferredPayment = getDeferredPaymentFromMeta(q.metaJson);
                  const lockDepositUI = !deferredPayment; // ✅ si pas paiement différé => acompte figé

                  const payBeforeDate = computePayBeforeFromMeta(q.metaJson);
const payBeforeStr = payBeforeDate ? fmtDayMonthShort(payBeforeDate) : "";

const balanceDueDate = deferredPayment ? computeBalanceDueFromQuote(q) : null;
const balanceDueStr = balanceDueDate ? fmtDayMonthShort(balanceDueDate) : "";


                  return (
                    <tr
                      key={q.id}
                      className={`border-t align-top ${facturedQuoteIds.has(q.id) ? "bg-yellow-50" : ""}`}
                    >
                      <td className="px-4 py-3 md:px-5 md:py-4 font-medium tabular-nums">{q.number}</td>
                      <td className="px-4 py-3 md:px-5 md:py-4">{fmtDateFR(q.issueDate || q.createdAt)}</td>
                      <td className="px-4 py-3 md:px-5 md:py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${
                            info.isPro ? "bg-emerald-600" : "bg-blue-600"
                          }`}
                        >
                          {info.isPro ? "PRO" : "PART"}
                        </span>
                      </td>
                      <td className="px-4 py-3 md:px-5 md:py-4">{info.isPro ? info.societe || "—" : "—"}</td>
                      <td className="px-4 py-3 md:px-5 md:py-4">{info.isPro ? info.service || "—" : "—"}</td>
                      <td className="px-4 py-3 md:px-5 md:py-4">{info.lastName || "—"}</td>
                      <td className="px-4 py-3 md:px-5 md:py-4">{info.firstName || "—"}</td>

                      {/* Acompte : Payé Oui/Non + Montant */}
                      <td className="px-4 py-3 md:px-5 md:py-4">
                        <div className="flex items-center gap-2">
                          <select
                            className={`rounded-lg border px-2 py-1 md:px-3 md:py-2 text-xs ${
                              lockDepositUI ? "bg-neutral-50 text-neutral-500 cursor-not-allowed" : ""
                            }`}
                            value={q.depositPaid ? "yes" : "no"}
                            disabled={lockDepositUI}
                            title={
                              lockDepositUI
                                ? "Acompte figé : uniquement disponible si Paiement différé est activé sur le devis."
                                : ""
                            }
                            onChange={async (e) => {
                              const nextPaid = e.target.value === "yes";
                              const nextAmountEuros = centsToEurosStr(q.depositPaidAmount || q.depositHT || 0);

                              setQuotes((prev) =>
                                prev.map((x) =>
                                  x.id === q.id
                                    ? {
                                        ...x,
                                        depositPaid: nextPaid,
                                        depositPaidAmount: x.depositPaidAmount || x.depositHT || 0,
                                      }
                                    : x
                                )
                              );

                              await fetch("/api/quotes", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  id: q.id,
                                  depositPaid: nextPaid,
                                  depositPaidAmountEuros: nextAmountEuros,
                                }),
                              });
                            }}
                          >
                            <option value="no">Non</option>
                            <option value="yes">Oui</option>
                          </select>

                          <input
                            className={`w-[110px] rounded-lg border px-2 py-1 md:px-3 md:py-2 text-xs tabular-nums ${
                              lockDepositUI ? "bg-neutral-50 text-neutral-500 cursor-not-allowed" : ""
                            }`}
                            value={centsToEurosStr(q.depositPaidAmount || q.depositHT || 0)}
                            disabled={lockDepositUI}
                            onChange={(e) => {
                              if (lockDepositUI) return;
                              const nextCents = eurosToCents(e.target.value);
                              setQuotes((prev) =>
                                prev.map((x) => (x.id === q.id ? { ...x, depositPaidAmount: nextCents } : x))
                              );
                            }}
                            onBlur={async (e) => {
                              if (lockDepositUI) return;
                              await fetch("/api/quotes", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  id: q.id,
                                  depositPaid: q.depositPaid,
                                  depositPaidAmountEuros: e.target.value,
                                }),
                              });
                            }}
                          />
                          <span className="text-xs text-neutral-500">€</span>
                        </div>

                        {lockDepositUI ? (
  <div className="mt-1 text-[11px] text-neutral-500">Paiement comptant : acompte désactivé.</div>
) : (
  <div className="mt-1 text-[11px] text-neutral-500">
    {payBeforeStr ? `Acompte à verser avant le ${payBeforeStr}.` : "Acompte à verser avant la clôture."}
  </div>
)}
                      </td>

                      {/* Restant HT / TTC */}
                      <td className="px-4 py-3 md:px-5 md:py-4">
                        <div className="text-xs tabular-nums">
  <div>
    HT : <span className="font-medium">{centsToEurosStr(computeRemainingHTCents(q))} €</span>
  </div>

  <div className="text-neutral-700">
    TTC : <span className="font-medium">{centsToEurosStr(computeRemainingTTCCents(q))} €</span>
    {deferredPayment ? (
      <span className="text-neutral-500">
        {balanceDueStr ? ` — avant le ${balanceDueStr}` : ""}
      </span>
    ) : (
      <span className="text-neutral-500">
        {payBeforeStr ? ` — avant le ${payBeforeStr}` : ""}
      </span>
    )}
  </div>
</div>
                      </td>

                      <td className="px-4 py-3 md:px-5 md:py-4 text-right whitespace-nowrap">
  <div className="flex items-center justify-end gap-2">
                                                    {isTouch && !isQuoteSigned(q.metaJson) && (
                            <button
                              type="button"
                              className="rounded-xl border px-3 py-2 text-xs"
                              onClick={() => openSignatureModal(q)}
                              title="Signature tablette uniquement"
                            >
                              Signer
                            </button>
                          )}

                                                    {isTouch && isQuoteSigned(q.metaJson) && (
                            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 border border-emerald-200">
                              Signé
                            </div>
                          )}

                          <button
                            type="button"
                            disabled={facturedQuoteIds.has(q.id)}
                            className={`rounded-xl px-3 py-2 text-xs ${
                              facturedQuoteIds.has(q.id)
                                ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                                : "bg-black text-white"
                            }`}
                            onClick={async () => {
                              if (facturedQuoteIds.has(q.id)) return;

                              const r = await fetch("/api/invoices", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ quoteId: q.id }),
                              });
                              const j = await r.json().catch(() => ({}));
                              if (!r.ok) {
                                alert(j?.error ?? "Erreur transformation en facture");
                                return;
                              }
                              const invoiceId = String(j.invoiceId ?? "");
                              if (!invoiceId) {
                                alert("Facture introuvable (invoiceId vide)");
                                return;
                              }
                              window.location.href = `/facturation?open=${encodeURIComponent(invoiceId)}`;
                            }}
                          >
                            Transformer en facture
                          </button>

                          <a
                            className="rounded-xl border px-3 py-2 text-xs"
                            href={`/api/exports/quotes/${q.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PDF devis
                          </a>

                          <a
                            className="rounded-xl border px-3 py-2 text-xs"
                            href={`/api/exports/quotes/${q.id}/csv`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            CSV
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅✅✅ MODALE SIGNATURE — À LA FIN DU RETURN QuoteList */}
            {signOpen && isTouch && (
        <div
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overscroll-contain"
  onTouchMove={(e) => e.preventDefault()}
>
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden overscroll-contain">
            <div className="flex items-center justify-between border-b px-4 py-3 md:px-5 md:py-4">
              <div className="text-sm font-semibold">Signature du devis</div>
              <button
                type="button"
                className="rounded-lg border px-2 py-1 md:px-3 md:py-2 text-xs"
                onClick={() => {
                  setSignOpen(false);
                  setSignQuoteId("");
                }}
                disabled={signSaving}
              >
                Fermer
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="text-neutral-600">Prénom</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    value={signerFirstName}
                    onChange={(e) => setSignerFirstName(e.target.value)}
                    placeholder="Prénom du signataire"
                  />
                </label>

                <label className="text-sm">
                  <span className="text-neutral-600">Nom</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    value={signerLastName}
                    onChange={(e) => setSignerLastName(e.target.value)}
                    placeholder="Nom du signataire"
                  />
                </label>

                <label className="text-sm md:col-span-2">
                  <span className="text-neutral-600">Fonction (optionnel)</span>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    value={signerRole}
                    onChange={(e) => setSignerRole(e.target.value)}
                    placeholder="Ex : gérant, responsable achats…"
                  />
                </label>
              </div>

              <div className="rounded-2xl border p-3 bg-neutral-50">
                <div className="text-xs text-neutral-600 mb-2">Signature manuscrite</div>

                <canvas
  ref={canvasRef}
  className="w-full rounded-xl bg-white border touch-none select-none"
  style={{ height: 140, touchAction: "none" as any }}
  onMouseDown={startDraw}
  onMouseMove={moveDraw}
  onMouseUp={endDraw}
  onMouseLeave={endDraw}
  onTouchStart={startDraw}
  onTouchMove={moveDraw}
  onTouchEnd={endDraw}
/>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-2 text-xs"
                    onClick={clearSignature}
                    disabled={signSaving}
                  >
                    Effacer
                  </button>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={bonPourAccord}
                      onChange={(e) => setBonPourAccord(e.target.checked)}
                      disabled={signSaving}
                    />
                    <span className="text-neutral-700">Bon pour accord</span>
                  </label>

                  <button
                    type="button"
                    className="rounded-xl bg-black px-3 py-2 text-xs text-white disabled:opacity-60"
                    onClick={saveSignature}
                    disabled={signSaving}
                  >
                    {signSaving ? "Enregistrement…" : "Valider la signature"}
                  </button>
                </div>

                <div className="mt-2 text-[11px] text-neutral-500">
                  Signature disponible uniquement sur tablette (tactile). Date/heure seront enregistrées automatiquement.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ✅✅✅ FIN MODALE SIGNATURE */}
    </div>
    );
}


/* -------------------- Création devis (Seikan Posters) -------------------- */

function QuoteCreateForm({ clientFromUrl }: { clientFromUrl: string }) {
  const router = useRouter();

  const [clients, setClients] = useState<ClientUi[]>([]);
  const [clientId, setClientId] = useState<string>("");

  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  const [snapIsPro, setSnapIsPro] = useState<boolean>(false);
  const [snapSociete, setSnapSociete] = useState<string>("");
  const [snapService, setSnapService] = useState<string>("");
  const [snapSiret, setSnapSiret] = useState<string>("");

  const [snapLastName, setSnapLastName] = useState<string>("");
  const [snapFirstName, setSnapFirstName] = useState<string>("");

  const [billingStreet, setBillingStreet] = useState<string>("");
  const [billingPostalCode, setBillingPostalCode] = useState<string>("");
  const [billingCity, setBillingCity] = useState<string>("");

  // Posters UI state
  const [selectedFormat, setSelectedFormat] = useState<PosterFormat>("30x40");

  // ✅ NEW : type de commande (remplace "Première commande")
  const [orderType, setOrderType] = useState<"test" | "classic">("test"); // par défaut : commande test

  const [vatExempt, setVatExempt] = useState<boolean>(true);

  // ✅ Impression / Colisage
  const [paperWeight, setPaperWeight] = useState<PaperWeight>("250g"); // inchangé
  const [packaging, setPackaging] = useState<"plastic_carton" | "tube">("plastic_carton"); // par défaut : plastique+carton, sans surcoût

  // ✅ Paiement différé (acompte 50% / solde 50%) — par défaut NON
  const [deferredPayment, setDeferredPayment] = useState<boolean>(false);

  // ref -> qty (0 = non sélectionné)
  const [qtyByRef, setQtyByRef] = useState<Record<string, number>>({});

  // ✅ ordre de sélection (pour appliquer la règle “1 seule incrémentation sur la 1ère ligne sélectionnée”)
  const [selectionOrderByFmt, setSelectionOrderByFmt] = useState<Record<PosterFormat, string[]>>({
    "30x40": [],
    A3: [],
    A2: [],
  });

  // Clôture + fenêtre livraison
  const closures = useMemo(() => next12ClosingsFirstOfMonth(new Date()), []);
  const [closureKey, setClosureKey] = useState<string>(closures[0]?.key ?? "");
  const closureObj = useMemo(() => closures.find((c) => c.key === closureKey) ?? null, [closures, closureKey]);
  const deliveryWindowLabel = useMemo(() => {
    if (!closureObj) return "";
    return computeDeliveryWindowFromClosure(closureObj.date);
  }, [closureObj]);

  const validiteLabel = useMemo(() => {
    if (!closureObj) return "—";
    return `Jusqu’au ${fmtDateFRLong(closureObj.date)}`;
  }, [closureObj]);

  // ✅ Échéances affichées (homogènes avec Facture)
  const payBeforeCreateStr = useMemo(() => {
    const d = closureObj?.date ? addDays(closureObj.date, -2) : null;
    return d ? fmtDayMonthShort(d) : "";
  }, [closureObj]);

  const balanceDueCreateStr = useMemo(() => {
    const d = addDays(new Date(), 30);
    return fmtDayMonthShort(d);
  }, []);

  // Remise commerciale
  const [discountDraftPct, setDiscountDraftPct] = useState<string>("0");
  const [discountAppliedPct, setDiscountAppliedPct] = useState<number>(0);

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/clients", { cache: "no-store" });
      const j = await r.json();
      setClients(j.clients ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!clientFromUrl) return;
    if (clients.length === 0) return;
    const exists = clients.some((c) => c.id === clientFromUrl);
    if (exists) setClientId(clientFromUrl);
  }, [clientFromUrl, clients]);

  useEffect(() => {
    if (!client) return;

    setSnapIsPro(Boolean(client.isProfessional));
    setSnapSociete(String(client.societe || "").trim());
    setSnapService(String(client.service || "").trim());
    setSnapSiret(String(client.siret || "").trim());

    setSnapLastName(client.lastName || "");
    setSnapFirstName(client.firstName || "");

    setBillingStreet(client.street || "");
    setBillingPostalCode(client.postalCode || "");
    setBillingCity(client.city || "");
  }, [client]);

  function parsePercentInput(v: string): number {
    const n = Number(String(v ?? "").replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function validateDiscount() {
    const pct = parsePercentInput(discountDraftPct);
    setDiscountAppliedPct(pct);
    setDiscountDraftPct(String(pct).replace(".", ","));
  }

  function toggleRef(ref: PosterRef) {
    const fmt = ref.format;

    const isChecked = (qtyByRef[ref.ref] ?? 0) > 0;

    // refs déjà cochées dans CE format (ordre historique)
    const ordered = selectionOrderByFmt[fmt] ?? [];
    const selectedInFmt = ordered.filter((code) => (qtyByRef[code] ?? 0) > 0);

    // ✅ Décocher
    if (isChecked) {
      setQtyByRef((prev) => ({ ...prev, [ref.ref]: 0 }));
      setSelectionOrderByFmt((prev) => ({
        ...prev,
        [fmt]: (prev[fmt] ?? []).filter((x) => x !== ref.ref),
      }));
      return;
    }

    // ✅ Cocher
    const countBefore = selectedInFmt.length; // nb déjà cochés dans ce format avant d'ajouter celui-ci
    const firstSelected = selectedInFmt[0] ?? null;

    setQtyByRef((prev) => {
      const next: Record<string, number> = { ...prev };

      // ✅ NEW : min = 1 partout (commande test OU classique)
      const minQty = 1;

      // 1ère sélection => 1
      next[ref.ref] = minQty;

      // ✅ on conserve la logique "bump 1 seule fois" uniquement en commande classique
      if (orderType === "classic" && countBefore >= 1 && firstSelected) {
        const curFirst = next[firstSelected] ?? 0;
        if (curFirst === 1) next[firstSelected] = 2;
      }

      return next;
    });

    setSelectionOrderByFmt((prev) => ({
      ...prev,
      [fmt]: [...(prev[fmt] ?? []), ref.ref],
    }));
  }

  function setQty(refCode: string, qty: number) {
    const minQty = 1;

    const q0 = Number.isFinite(qty) ? Math.trunc(qty) : 0;
    const q = clampInt(q0, minQty, 9999);

    setQtyByRef((prev) => ({ ...prev, [refCode]: q }));
  }

  const selectionsByFormat = useMemo(() => {
    const map: Record<PosterFormat, Array<{ ref: PosterRef; qty: number }>> = {
      "30x40": [],
      A3: [],
      A2: [],
    };

    (Object.keys(POSTERS) as PosterFormat[]).forEach((fmt) => {
      for (const r of POSTERS[fmt]) {
        const q = qtyByRef[r.ref] ?? 0;
        if (q > 0) map[fmt].push({ ref: r, qty: q });
      }
    });

    return map;
  }, [qtyByRef]);

  const computed = useMemo(() => {
    const outLines: Array<{ format: PosterFormat; ref: string; name: string; qty: number; unitEuros: number }> = [];

    const qtyEffective: Record<string, number> = { ...qtyByRef };

    const formatTotals: Record<PosterFormat, number> = { "30x40": 0, A3: 0, A2: 0 };

    (Object.keys(selectionsByFormat) as PosterFormat[]).forEach((fmt) => {
      for (const s of selectionsByFormat[fmt]) {
        const q = Math.max(1, qtyEffective[s.ref.ref] ?? s.qty ?? 1);
        formatTotals[fmt] += q;
      }
    });

    (Object.keys(selectionsByFormat) as PosterFormat[]).forEach((fmt) => {
      const totalUnitsInFormat = formatTotals[fmt];
      if (totalUnitsInFormat <= 0) return;

      // ✅ NEW : prix 30×40 dépend du type de commande
      let unit = 0;

      if (fmt === "30x40") {
        const n = totalUnitsInFormat;
        if (orderType === "test") {
          unit = 11; // 0→50 (et même au-delà, on garde 11)
        } else {
          // classique : 10–19 =>12 / 20–39 =>11 / 40+ =>10
          unit = n >= 40 ? 10 : n >= 20 ? 11 : 12;
        }
      } else {
        // A3/A2 : on ne change rien
        unit = calcUnitPriceEuros(fmt, totalUnitsInFormat, paperWeight);
      }

      for (const s of selectionsByFormat[fmt]) {
        const q = Math.max(1, qtyEffective[s.ref.ref] ?? s.qty ?? 1);
        outLines.push({
          format: fmt,
          ref: s.ref.ref,
          name: displayPosterName(s.ref),
          qty: q,
          unitEuros: unit,
        });
      }
    });

    const postersHT = outLines.reduce((sum, l) => sum + l.qty * l.unitEuros, 0);
    const postersHTCents = Math.round(postersHT * 100);

    const discountPct = Math.max(0, Math.min(100, discountAppliedPct || 0));
    const discountAmount = discountPct > 0 ? Math.round((postersHTCents * discountPct) / 100) : 0;
    const afterDiscountHT = postersHTCents - discountAmount;

    // ✅ NEW : commande test => pas de frais de port
    const isTest = orderType === "test";

    const francoThreshold = isTest ? 0 : 18000;
    const francoCost = isTest ? 0 : afterDiscountHT >= francoThreshold ? 0 : 2000;

    const totalHT = afterDiscountHT + francoCost;

    const vatRate = vatExempt ? 0 : 0.2;
    const totalTTC = vatRate > 0 ? Math.round(totalHT * (1 + vatRate)) : totalHT;
    const vatAmount = totalTTC - totalHT;

    const depositPct = deferredPayment ? 50 : 0;
    const depositHT = Math.round((totalHT * depositPct) / 100);
    const balanceHT = totalHT - depositHT;

    // ✅ Nouvelle règle :
    // - minimum 1 poster (pas de minimum 10 par format)
    // - SAUF si la commande est "A2 uniquement" => minimum 10 posters au total en A2
    const formatErrors: Record<PosterFormat, string | null> = { "30x40": null, A3: null, A2: null };

    const selectedFormats = (Object.keys(formatTotals) as PosterFormat[]).filter((fmt) => (formatTotals[fmt] || 0) > 0);

    const isA2Only = selectedFormats.length === 1 && selectedFormats[0] === "A2";
    if (isA2Only) {
      const totalA2 = formatTotals.A2 || 0;
      if (totalA2 < 10) {
        formatErrors.A2 = "Minimum de 10 posters requis si la commande est en A2 uniquement.";
      }
    }

    const hasMinError = Boolean(formatErrors.A2);

    return {
      outLines,
      formatTotals,
      francoThreshold,
      francoCost,
      postersHTCents,
      discountPct,
      discountAmount,
      totalHT,
      totalTTC,
      vatAmount,
      vatRate,
      depositPct,
      depositHT,
      balanceHT,
      formatErrors,
      hasMinError,
      qtyEffective,
    };
  }, [selectionsByFormat, orderType, discountAppliedPct, vatExempt, qtyByRef, deferredPayment, paperWeight, packaging, selectionOrderByFmt]);

  async function createQuote() {
    if (!client) {
      alert("Sélectionne un client.");
      return;
    }

    const ln = String(snapLastName || "").trim();
    const fn = String(snapFirstName || "").trim();
    const comp = String(snapSociete || "").trim();

    if (!ln || !fn) {
      alert("Renseigne Nom et Prénom (contact).");
      return;
    }
    if (snapIsPro && !comp) {
      alert("Renseigne la Société (client PRO).");
      return;
    }

    const bill = {
      street: String(billingStreet || "").trim(),
      postalCode: String(billingPostalCode || "").trim(),
      city: String(billingCity || "").trim(),
    };
    if (!bill.street || !bill.postalCode || !bill.city) {
      alert("Adresse client incomplète (Rue/CP/Ville). Corrige la fiche client.");
      return;
    }

    if (!closureObj) {
      alert("Sélectionne une clôture de commande (1er ou 15).");
      return;
    }

    if (computed.outLines.length === 0) {
      alert("Sélectionne au moins une référence dans Posters.");
      return;
    }

    if (computed.hasMinError) {
      alert("Commande bloquée : minimum de 10 posters requis si la commande est en A2 uniquement.");
      return;
    }

    setCreating(true);

    try {
      const displayName = snapIsPro ? comp : [ln, fn].filter(Boolean).join(" — ") || "Client";

      const payload = {
        clientId: client.id,
        clientSnapshot: {
          name: displayName,
          service: snapIsPro ? String(snapService || "") : "",
          email: client.email || "",
          phone: client.telephone || "",
          address: joinAddress(bill.street, bill.postalCode, bill.city),
        },

        validDays: 1,

        // ✅ posters payload = DIRECTEMENT l'objet PostersPayload attendu par /api/quotes
        posters: {
          orderType, // "test" | "classic"
          vatExempt,
          deferredPayment,
          closingDate: closureObj.key,
          deliveryWindowLabel,
          discountAppliedPct,
          paperWeight,
          packaging,
          selectionOrderByFmt,
          selections: computed.outLines.map((l) => ({
            format: l.format,
            ref: l.ref,
            name: l.name,
            qty: l.qty,
            grammage: paperWeight,
          })),
        },

        // ✅ metaJson = sibling de posters (pas dedans)
        metaJson: JSON.stringify({
          mode: "POSTERS",
          party: {
            isProfessional: snapIsPro,
            lastName: ln,
            firstName: fn,
            societe: snapIsPro ? comp : "",
            service: snapIsPro ? String(snapService || "").trim() : "",
            siret: snapIsPro ? String(snapSiret || "").trim() : "",
          },
          billingAddress: { ...bill },
          delivery: { address: deliveryWindowLabel },

          posters: {
            orderType,
            vatExempt,
            deferredPayment,
            closingDate: closureObj.key,
            deliveryWindowLabel,
            discountAppliedPct,
            paperWeight,
            packaging,
          },
        }),
      };

      const r = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error ?? "Erreur création devis");
        return;
      }

      const createdNumber = String(j?.quoteNumber ?? j?.number ?? j?.quote?.number ?? "");
      const createdId = String(j?.quoteId ?? j?.id ?? j?.quote?.id ?? "");

      router.replace(
        `/devis?created=${encodeURIComponent(createdNumber)}&createdId=${encodeURIComponent(createdId)}`
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">Créer un devis</div>
          <div className="text-sm text-neutral-600">Module Posters — Seikan Gallery.</div>
        </div>

        <button type="button" onClick={() => router.replace("/devis")} className="rounded-xl border px-4 py-2 text-sm">
          ← Retour aux devis
        </button>
      </div>

      {/* Client */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-medium">Client</div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-sm md:col-span-2">
            <span className="text-neutral-600">Client</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">— Sélectionner —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {buildClientDisplayName(c)}
                </option>
              ))}
            </select>
            {!!clientFromUrl && (
              <div className="mt-1 text-xs text-neutral-500">
                Ouvert depuis un client (URL) : pré-remplissage automatique.
              </div>
            )}
          </label>

          <label className="text-sm">
            <span className="text-neutral-600">Validité</span>
            <input className="mt-1 w-full rounded-xl border px-3 py-2 bg-neutral-50" value={validiteLabel} readOnly disabled />
          </label>
        </div>

        {!client ? (
          <div className="mt-3 text-sm text-neutral-500">Sélectionne un client pour pré-remplir le devis.</div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {snapIsPro ? (
                <>
                  <label className="text-sm md:col-span-2">
                    <span className="text-neutral-600">Société</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapSociete}
                      onChange={(e) => setSnapSociete(e.target.value)}
                      placeholder="Nom de la société"
                    />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Service</span>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2"
                      value={snapService}
                      onChange={(e) => setSnapService(e.target.value)}
                      placeholder="Service / département"
                    />
                  </label>

                  <label className="text-sm md:col-span-3">
                    <span className="text-neutral-600">SIRET</span>
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapSiret} onChange={(e) => setSnapSiret(e.target.value)} />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Nom (contact)</span>
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapLastName} onChange={(e) => setSnapLastName(e.target.value)} />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Prénom (contact)</span>
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapFirstName} onChange={(e) => setSnapFirstName(e.target.value)} />
                  </label>

                  <div className="hidden md:block" />
                </>
              ) : (
                <>
                  <label className="text-sm">
                    <span className="text-neutral-600">Nom</span>
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapLastName} onChange={(e) => setSnapLastName(e.target.value)} />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Prénom</span>
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapFirstName} onChange={(e) => setSnapFirstName(e.target.value)} />
                  </label>

                  <div className="hidden md:block" />
                </>
              )}
            </div>

            {/* Adresse client */}
            <div className="mt-4">
              <div className="text-sm font-medium">Adresse de facturation (adresse client)</div>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                <label className="text-sm md:col-span-2">
                  <span className="text-neutral-600">Rue</span>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-neutral-50" value={billingStreet} readOnly disabled />
                </label>
                <label className="text-sm">
                  <span className="text-neutral-600">Code postal</span>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-neutral-50" value={billingPostalCode} readOnly disabled />
                </label>
                <label className="text-sm md:col-span-3">
                  <span className="text-neutral-600">Ville</span>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm bg-neutral-50" value={billingCity} readOnly disabled />
                </label>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Posters */}
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Posters</div>
            <div className="mt-1 text-xs text-neutral-500">
              Noms affichés : latin + traduction française (aucun japonais dans le devis/PDF).
            </div>
          </div>

          <label className="text-sm">
            <span className="text-neutral-600">Commande</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as "test" | "classic")}
            >
              <option value="test">Commande test</option>
              <option value="classic">Commande classique</option>
            </select>
          </label>
        </div>

        {/* ✅ Choix impression / Colisage */}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="text-neutral-600">Choix d’impression</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={paperWeight}
              onChange={(e) => setPaperWeight(e.target.value as PaperWeight)}
            >
              <option value="135g">135g</option>
              <option value="250g">250g</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="text-neutral-600">Colisage</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={packaging}
              onChange={(e) => setPackaging(e.target.value as "plastic_carton" | "tube")}
            >
              <option value="plastic_carton">Plastique transparent et carton rigide</option>
              <option value="tube">Tube</option>
            </select>
            <div className="mt-1 text-xs text-neutral-500">Aucun surcoût</div>
          </label>

          <div className="hidden md:block" />
        </div>

        {/* formats */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(["30x40", "A3", "A2"] as PosterFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setSelectedFormat(f)}
              className={`rounded-full border px-4 py-2 text-sm ${selectedFormat === f ? "bg-black text-white" : "bg-white"}`}
            >
              Poster {f === "30x40" ? "30×40" : f}
            </button>
          ))}
        </div>

        {/* refs */}
        <div className="mt-4 grid gap-2">
          {POSTERS[selectedFormat].map((r) => {
            const checked = (qtyByRef[r.ref] ?? 0) > 0;
            const current = qtyByRef[r.ref] ?? 0;

            const displayQty = checked ? Math.max(1, computed.qtyEffective?.[r.ref] ?? Math.max(1, current || 1)) : 0;

            return (
              <div key={r.ref} className="rounded-xl border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={checked} onChange={() => toggleRef(r)} />
                    <span className="font-medium tabular-nums">{r.ref}</span>
                    <span className="text-neutral-700">{displayPosterName(r)}</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">Qté</span>

                    <button
                      type="button"
                      className="h-9 w-9 rounded-lg border text-sm disabled:opacity-40"
                      disabled={!checked}
                      onClick={() => {
                        const minQty = 1;
                        const cur = checked ? displayQty : 0;
                        setQty(r.ref, Math.max(minQty, (cur || minQty) - 1));
                      }}
                      aria-label="Diminuer la quantité"
                      title="Diminuer"
                    >
                      −
                    </button>

                    <input
                      className="h-9 w-[90px] rounded-lg border px-2 text-sm tabular-nums text-center"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={checked ? String(displayQty) : ""}
                      disabled={!checked}
                      onChange={(e) => {
                        const raw = (e.target.value || "").replace(/[^\d]/g, "");
                        const n = raw ? parseInt(raw, 10) : 0;

                        if (n <= 0) return setQty(r.ref, 1);
                        setQty(r.ref, clampInt(n, 1, 9999));
                      }}
                      onBlur={() => {
                        const minQty = 1;
                        const cur = checked ? displayQty : 0;
                        setQty(r.ref, Math.max(minQty, cur || minQty));
                      }}
                    />

                    <button
                      type="button"
                      className="h-9 w-9 rounded-lg border text-sm disabled:opacity-40"
                      disabled={!checked}
                      onClick={() => {
                        const minQty = 1;
                        const cur = checked ? displayQty : 0;
                        setQty(r.ref, (cur || minQty) + 1);
                      }}
                      aria-label="Augmenter la quantité"
                      title="Augmenter"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* erreurs min 10 */}
        <div className="mt-3">
          {(computed.formatErrors["30x40"] || computed.formatErrors.A3 || computed.formatErrors.A2) && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {computed.formatErrors["30x40"] && <div>• {computed.formatErrors["30x40"]}</div>}
              {computed.formatErrors.A3 && <div>• {computed.formatErrors.A3}</div>}
              {computed.formatErrors.A2 && <div>• {computed.formatErrors.A2}</div>}
            </div>
          )}
        </div>

        {/* clôture + livraison */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-neutral-600">Clôture de commande (1er / 15)</span>
            <select className="mt-1 w-full rounded-xl border px-3 py-2" value={closureKey} onChange={(e) => setClosureKey(e.target.value)}>
              {closures.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm">
            <div className="text-neutral-600">Livraison estimée</div>
            <div className="mt-1 rounded-xl border px-3 py-2 text-sm bg-neutral-50">{deliveryWindowLabel || "—"}</div>
            <div className="mt-1 text-xs text-neutral-500">Estimation : J+11 à J+14 après la clôture.</div>
          </div>
        </div>
      </div>

      {/* Récap */}
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-medium">Récapitulatif</div>

        {/* TVA */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div>
            <div className="text-sm font-medium">TVA</div>
            <div className="text-xs text-neutral-500">Par défaut : total HT (exonération).</div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vatExempt} onChange={(e) => setVatExempt(e.target.checked)} />
            <span className="font-medium">Exonération de TVA</span>
          </label>
        </div>

        {/* Paiement */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div>
            <div className="text-sm font-medium">Paiement</div>
            <div className="text-xs text-neutral-500">
              {deferredPayment
                ? "Paiement différé activé : acompte 50% / solde 50%."
                : "Paiement comptant : acompte 0€ (tout en solde)."}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deferredPayment} onChange={(e) => setDeferredPayment(e.target.checked)} />
            <span className="font-medium">Paiement différé</span>
          </label>
        </div>

        {/* Remise commerciale */}
        <div className="mt-3 rounded-xl border p-3">
          <div className="text-sm font-medium">Remise commerciale</div>

          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              <span className="text-neutral-600">Choisir un %</span>
              <select className="mt-1 w-full rounded-xl border px-3 py-2" value={String(parsePercentInput(discountDraftPct))} onChange={(e) => setDiscountDraftPct(e.target.value)}>
                {[0, 2, 5, 7, 10, 12, 15, 20, 25, 30].map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="text-neutral-600">Ou saisir à la main (%)</span>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={discountDraftPct} onChange={(e) => setDiscountDraftPct(e.target.value)} />
            </label>

            <div className="flex items-end">
              <button type="button" onClick={validateDiscount} className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white">
                Valider la remise commerciale
              </button>
            </div>
          </div>

          <div className="mt-2 text-xs text-neutral-500">
            Remise appliquée : <span className="font-medium">{computed.discountPct}%</span>{" "}
            {computed.discountPct > 0 ? (
              <>
                (soit <span className="font-medium">{centsToEurosStr(computed.discountAmount)} €</span>)
              </>
            ) : null}
          </div>
        </div>

        {/* totaux */}
        <div className="mt-3 grid gap-2 text-sm text-neutral-700 md:grid-cols-2">
          <div className="rounded-xl border p-3">
            <div className="text-neutral-700">Total HT</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{centsToEurosStr(computed.totalHT)} €</div>
            <div className="mt-1 text-xs text-neutral-500">
              Franco :{" "}
              {orderType === "test" ? (
                <span className="font-medium">offert (commande test)</span>
              ) : computed.francoCost === 0 ? (
                <>
                  <span className="font-medium">offert</span> — seuil{" "}
                  <span className="font-medium">{centsToEurosStr(computed.francoThreshold)} €</span>.
                </>
              ) : (
                <>
                  <span className="font-medium">20 €</span> — seuil{" "}
                  <span className="font-medium">{centsToEurosStr(computed.francoThreshold)} €</span>.
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-neutral-700">Total TTC</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{centsToEurosStr(computed.totalTTC)} €</div>
            {computed.vatRate > 0 ? (
              <div className="mt-1 text-xs text-neutral-500">
                TVA (20%) : <span className="font-medium">{centsToEurosStr(computed.vatAmount)} €</span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-neutral-500">TVA non applicable (exonération).</div>
            )}
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-neutral-700">
              {deferredPayment
                ? `Acompte (${computed.depositPct}%)${payBeforeCreateStr ? ` — avant le ${payBeforeCreateStr}` : ""}`
                : `Acompte (${computed.depositPct}%)`}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{centsToEurosStr(computed.depositHT)} €</div>
            <div className="mt-1 text-xs text-neutral-500">
              {deferredPayment ? "Paiement différé : acompte 50%." : "Paiement comptant : acompte 0€ (tout en solde)."}
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <div className="text-neutral-700">
              {deferredPayment
                ? `Solde — avant le ${balanceDueCreateStr}`
                : `Montant à payer — avant le ${payBeforeCreateStr || "—"}`}
            </div>

            <div className="mt-1 text-lg font-semibold tabular-nums">
              {deferredPayment ? centsToEurosStr(computed.balanceHT) : centsToEurosStr(computed.totalTTC)} €
            </div>

            <div className="mt-1 text-xs text-neutral-500">
              {deferredPayment
                ? "Paiement différé : solde à régler sous 30 jours (date de signature, sinon date d’émission)."
                : "Paiement comptant : règlement avant clôture (J-2)."}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createQuote}
            disabled={creating || computed.hasMinError}
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {creating ? "Création..." : "Générer le devis"}
          </button>

          {computed.hasMinError && (
            <div className="text-xs text-red-700 self-center">
              Commande bloquée : minimum de 10 posters requis si la commande est en A2 uniquement.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DevisInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const clientFromUrl = searchParams.get("client") || "";
  const isNew = searchParams.get("new") === "1";

  const createdNumber = searchParams.get("created") || "";
  const createdId = searchParams.get("createdId") || "";

  const mode: "list" | "create" = clientFromUrl || isNew ? "create" : "list";

  if (mode === "list") {
    return (
      <QuoteList
        createdNumber={createdNumber}
        createdId={createdId}
        onCreate={() => router.replace("/devis?new=1")}
      />
    );
  }

  return <QuoteCreateForm clientFromUrl={clientFromUrl} />;
}

export default function DevisPage() {
  return (
    <Suspense fallback={null}>
      <DevisInner />
    </Suspense>
  );
}