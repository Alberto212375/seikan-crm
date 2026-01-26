// src/app/(crm)/depot-vente/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

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
        className="rounded-xl border px-3 py-2 text-xs disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onPage(1)}
      >
        ««
      </button>

      <button
        className="rounded-xl border px-3 py-2 text-xs disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        «
      </button>

      <div className="px-2 text-xs text-neutral-600 tabular-nums">
        Page <span className="font-medium">{page}</span> / <span className="font-medium">{pageCount}</span>
      </div>

      <button
        className="rounded-xl border px-3 py-2 text-xs disabled:opacity-40"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        »
      </button>

      <button
        className="rounded-xl border px-3 py-2 text-xs disabled:opacity-40"
        disabled={page >= pageCount}
        onClick={() => onPage(pageCount)}
      >
        »»
      </button>
    </div>
  );
}

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

  // ✅ IMPORTANT : requis pour afficher "Signé" / bouton signer / badge
  metaJson?: string | null;
};

type ConsignmentMeta = {
  party?: {
    isProfessional?: boolean;
    societe?: string;
    service?: string;
    siret?: string;
    lastName?: string;
    firstName?: string;
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

type PosterFormat = "30x40" | "A3" | "A2";

type PosterRef = {
  format: PosterFormat;
  ref: string; // R-XXXXXX
  jp: string; // (romaji / affiché en colonne)
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

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function getSignatureFromMeta(metaJson: string | null | undefined) {
  const meta = safeJsonParse<ConsignmentMeta>(metaJson) ?? {};
  return meta.signature ?? null;
}

function isConsignmentSigned(metaJson: string | null | undefined) {
  const sig = getSignatureFromMeta(metaJson);
  // ✅ même logique que la page détail (et devis) : signedAt est optionnel
  return Boolean(sig?.accepted && sig?.signatureDataUrl);
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

function formatUiToInternal(ui: "30×40" | "A3" | "A2"): PosterFormat {
  return ui === "30×40" ? "30x40" : ui;
}

/* -------------------- Page wrapper -------------------- */

export default function DepotVentePage() {
  return (
    <Suspense fallback={null}>
      <DepotVenteInner />
    </Suspense>
  );
}

function DepotVenteInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const isNew = sp.get("new") === "1";
  const openId = sp.get("open") || "";

  const pageParam = sp.get("page") || "1";
  const page = Math.max(1, Math.floor(Number(pageParam) || 1));

  const createdNumber = sp.get("created") || "";
  const createdId = sp.get("createdId") || "";

  const mode: "list" | "create" = isNew ? "create" : "list";

  if (mode === "create") {
    return <DepotCreateForm onBack={() => router.replace("/depot-vente")} />;
  }

    return (
    <DepotList
      openId={openId}
      page={page}
      createdNumber={createdNumber}
      createdId={createdId}
      onCreate={() => router.replace("/depot-vente?new=1")}
      onOpen={(id) => {
        const qs = new URLSearchParams();
        if (id) qs.set("open", id);
        if (page > 1) qs.set("page", String(page));
        const url = qs.toString() ? `/depot-vente?${qs.toString()}` : "/depot-vente";
        router.replace(url);
      }}
      onPage={(p) => {
        const next = Math.max(1, p);
        const qs = new URLSearchParams();
        if (openId) qs.set("open", openId);
        if (next > 1) qs.set("page", String(next));
        const url = qs.toString() ? `/depot-vente?${qs.toString()}` : "/depot-vente";
        router.replace(url);
      }}
    />
  );
}

/* -------------------- Liste (comme Devis) -------------------- */

function DepotList({
  openId,
  page,
  createdNumber,
  createdId,
  onCreate,
  onOpen,
  onPage,
}: {
  openId: string;
  page: number;
  createdNumber: string;
  createdId: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onPage: (p: number) => void;
}) {

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConsignmentRow[]>([]);

    // pagination (même esprit que Devis)
  const PAGE_SIZE = 20;

  const pageCount = useMemo(() => {
    return Math.max(1, Math.ceil((rows?.length ?? 0) / PAGE_SIZE));
  }, [rows]);

  const safePage = Math.min(Math.max(1, page || 1), pageCount);

  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return (rows ?? []).slice(start, start + PAGE_SIZE);
  }, [rows, safePage]);

  const [openLoading, setOpenLoading] = useState(false);
  const [openDetail, setOpenDetail] = useState<any | null>(null);

  // ✅ Signature : autorisée sur appareils tactiles (iPad inclus)
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const compute = () => {
      if (typeof window === "undefined") return setIsTouch(false);
      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const touchPoints = (navigator as any)?.maxTouchPoints ?? 0;
      setIsTouch(coarse || touchPoints > 0);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

    // ✅ Mémo dernier signataire (comme devis)
  const SIGNER_STORAGE_KEY = "sg_last_signer_v1";

  function loadLastSigner(): { firstName: string; lastName: string; role: string } | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(SIGNER_STORAGE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      return {
        firstName: String(j?.firstName ?? "").trim(),
        lastName: String(j?.lastName ?? "").trim(),
        role: String(j?.role ?? "").trim(),
      };
    } catch {
      return null;
    }
  }

  function saveLastSigner(firstName: string, lastName: string, role: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SIGNER_STORAGE_KEY,
        JSON.stringify({
          firstName: String(firstName ?? "").trim(),
          lastName: String(lastName ?? "").trim(),
          role: String(role ?? "").trim(),
        })
      );
    } catch {
      // ignore
    }
  }

  async function refresh() {
    const r = await fetch("/api/consignments", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRows((j.consignments ?? []) as ConsignmentRow[]);
  }

  async function loadOpen(id: string) {
    if (!id) {
      setOpenDetail(null);
      return;
    }
    setOpenLoading(true);
    try {
      const r = await fetch(`/api/consignments/${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j?.error ?? "Erreur chargement dépôt-vente");
        setOpenDetail(null);
        return;
      }
      setOpenDetail(j.consignment ?? null);
    } finally {
      setOpenLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loadOpen(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // ✅ modale signature (copie Devis)
  const [signOpen, setSignOpen] = useState(false);
  const [signConsignmentId, setSignConsignmentId] = useState<string>("");
  const [signerFirstName, setSignerFirstName] = useState("");
  const [signerLastName, setSignerLastName] = useState("");
  const [signerRole, setSignerRole] = useState("Gérant");
  const [bonPourAccord, setBonPourAccord] = useState(false);
  const [signSaving, setSignSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

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

    function openSignatureModal(row: ConsignmentRow) {
    // on ne peut signer que tablette + pas déjà signé
    if (!isTouch) return;
    if (isConsignmentSigned(row.metaJson)) return;

        const meta = safeJsonParse<ConsignmentMeta>(row.metaJson ?? null) ?? {};
    const party = meta.party ?? {};

    const partyFn = String(party.firstName ?? "").trim();
    const partyLn = String(party.lastName ?? "").trim();

    // fallback si pas de party (anciens dépôts) => dernier signataire mémorisé
    const last = loadLastSigner();

    setSignerFirstName(partyFn || last?.firstName || "");
    setSignerLastName(partyLn || last?.lastName || "");
    setSignerRole(last?.role || "Gérant");
    setBonPourAccord(false);

    setSignConsignmentId(row.id);
    setSignOpen(true);

    setTimeout(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;

      const rect = c.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      const cssW = Math.max(300, Math.floor(rect.width));
      const cssH = 140;

      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);

      // 1 unité canvas = 1 pixel CSS
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, cssW, cssH);

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

    // Remplit correctement en repère "device" sans dépendre du transform DPR
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  }

  function getSignatureDataUrl(): string {
    const c = canvasRef.current;
    if (!c) return "";
        // sécurité : si canvas pas initialisé correctement
    const rect = c.getBoundingClientRect();
    if (!rect.width) return "";
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
    if (!signConsignmentId) return;

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

    // ✅ mémorise pour les prochaines signatures
    saveLastSigner(fn, ln, role);

    setSignSaving(true);
    try {
      const r = await fetch(`/api/consignments/${encodeURIComponent(signConsignmentId)}/signature`, {
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

      await refresh();
      if (openId) await loadOpen(openId);

      setSignOpen(false);
      setSignConsignmentId("");

      // ✅ comme tu veux : signer => PDF direct
      window.open(`/api/exports/consignments/${encodeURIComponent(signConsignmentId)}/pdf`, "_blank");
    } finally {
      setSignSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold">Dépôt-vente</div>
          <div className="text-sm text-neutral-700">
            Liste des dépôts (dépôt, récupération, quantité) — PDF + signature (comme devis).
          </div>
        </div>

        <button type="button" onClick={onCreate} className="rounded-xl bg-black px-4 py-2 text-sm text-white">
          Créer un dépôt-vente
        </button>
      </div>

      {!!createdNumber && (
        <div className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-medium">
            Dépôt-vente créé : <span className="tabular-nums">{createdNumber}</span>
          </div>
          {!!createdId && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="rounded-xl border px-4 py-2 text-sm"
                href={`/api/exports/consignments/${createdId}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                Télécharger PDF
              </a>
              <a className="rounded-xl border px-4 py-2 text-sm" href={`/depot-vente?open=${createdId}`}>
                Ouvrir détail
              </a>
            </div>
          )}
        </div>
      )}

      <div className={`grid gap-6 ${openId ? "lg:grid-cols-[1fr_420px]" : ""}`}>
        {/* LISTE */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
            <table className="w-full min-w-[1100px] text-[13px] md:text-[15px]">
              <thead className="bg-neutral-50 text-left">
                <tr className="text-neutral-800">
                  <th className="px-4 py-3 md:px-5 md:py-4 w-[170px]">N° Dépôt</th>
                  <th className="px-4 py-3 md:px-5 md:py-4">Client</th>
                  <th className="px-4 py-3 md:px-5 md:py-4 w-[140px]">Date dépôt</th>
                  <th className="px-4 py-3 md:px-5 md:py-4 w-[160px]">Date récupération</th>
                  <th className="px-4 py-3 md:px-5 md:py-4 w-[140px]">Total articles</th>
                  <th className="px-4 py-3 md:px-5 md:py-4 w-[320px] text-right">Actions</th>
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
                  pagedRows.map((r) => {
                    const signed = isConsignmentSigned(r.metaJson);
                                        return (
                      <tr key={r.id} className={`border-t ${signed ? "bg-yellow-50" : ""}`}>
                        <td className="px-4 py-3 md:px-5 md:py-4 font-medium tabular-nums">
                          <span>{r.number}</span>

                          {r.emailSentAt ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                              📧 Envoyé le {fmtDateFR(r.emailSentAt)}
                            </span>
                          ) : null}

                          {signed ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">
                              ✍️ Signé
                            </span>
                          ) : null}
                        </td>

                        <td className="px-4 py-3 md:px-5 md:py-4">{r.client?.displayName ?? "—"}</td>
                        <td className="px-4 py-3 md:px-5 md:py-4">{fmtDateFR(r.depositDate)}</td>
                        <td className="px-4 py-3 md:px-5 md:py-4">{fmtDateFR(r.recoveryDate)}</td>
                        <td className="px-4 py-3 md:px-5 md:py-4">{r.totalQty}</td>

                        <td className="px-4 py-3 md:px-5 md:py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button className="rounded-xl border px-3 py-2 text-xs" onClick={() => onOpen(r.id)}>
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

                            {isTouch && !signed ? (
                              <button
                                type="button"
                                className="rounded-xl border px-3 py-2 text-xs"
                                onClick={() => openSignatureModal(r)}
                                title="Signature tablette uniquement"
                              >
                                Signer
                              </button>
                            ) : null}

                            {isTouch && signed ? (
                              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 border border-emerald-200">
                                Signé
                              </div>
                            ) : null}

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
                                if (openId) await loadOpen(openId);
                              }}
                            >
                              {r.emailSentAt ? "Renvoyer" : "Envoyer au client"}
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

          <div className="border-t bg-white px-4 py-3">
            <Pagination page={safePage} pageCount={pageCount} onPage={onPage} />
          </div>
        </div>

        {/* PANNEAU DETAIL (via ?open=) */}
        {openId ? (
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden h-fit sticky top-6">
            <div className="border-b px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-medium">Détail dépôt-vente</div>
              <button className="rounded-xl border px-3 py-2 text-xs" onClick={() => onOpen("")}>
                Fermer
              </button>
            </div>

            <div className="p-4 space-y-3">
              {openLoading ? (
                <div className="text-sm text-neutral-500">Chargement…</div>
              ) : !openDetail ? (
                <div className="text-sm text-neutral-500">Aucun détail.</div>
              ) : (
                <>
                  <div>
                    <div className="text-xl font-semibold tabular-nums">{openDetail.number}</div>
                    <div className="mt-1 text-sm text-neutral-600">
                      Client :{" "}
                      <span className="font-medium text-neutral-900">{openDetail.client?.displayName ?? "—"}</span>
                    </div>

                    <div className="mt-1 text-xs text-neutral-500">
                      Statut : <span className="font-medium">{openDetail.status}</span>
                      {openDetail.emailSentAt ? <> · 📧 Envoyé le {fmtDateFR(openDetail.emailSentAt)}</> : null}
                      {isConsignmentSigned(openDetail?.metaJson ?? null) ? <> · ✍️ Signé</> : null}
                    </div>
                  </div>

                  <div className="grid gap-2 text-sm">
                    <div className="rounded-xl border bg-neutral-50 px-3 py-2">
                      Dépôt : <span className="font-medium">{fmtDateFR(openDetail.depositDate)}</span>
                    </div>
                    <div className="rounded-xl border bg-neutral-50 px-3 py-2">
                      Récupération : <span className="font-medium">{fmtDateFR(openDetail.recoveryDate)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
  <a className="rounded-xl border px-3 py-2 text-xs" href={`/depot-vente/${encodeURIComponent(openDetail.id)}`}>
    Page complète
  </a>

  <a
    className="rounded-xl border px-3 py-2 text-xs"
    href={`/api/exports/consignments/${encodeURIComponent(openDetail.id)}/pdf`}
    target="_blank"
    rel="noreferrer"
  >
    PDF
  </a>

  {isTouch && !isConsignmentSigned(openDetail?.metaJson ?? null) ? (
    <button
      type="button"
      className="rounded-xl border px-3 py-2 text-xs"
      onClick={() =>
        openSignatureModal({
          id: openDetail.id,
          metaJson: openDetail?.metaJson ?? null,
        } as any)
      }
      title="Signature tablette uniquement"
    >
      Signer
    </button>
  ) : null}

  {isTouch && isConsignmentSigned(openDetail?.metaJson ?? null) ? (
    <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 border border-emerald-200">
      Signé
    </div>
  ) : null}

  <button
    className="rounded-xl border px-3 py-2 text-xs"
    onClick={async () => {
      if (!confirm("Envoyer ce dépôt-vente au client par email ?")) return;
      const res = await fetch(`/api/consignments/${encodeURIComponent(openDetail.id)}/send`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return alert(j?.error ?? "Erreur envoi email");
      alert("Email envoyé au client ✅");
      await refresh();
      await loadOpen(openDetail.id);
    }}
  >
    {openDetail.emailSentAt ? "Renvoyer" : "Envoyer au client"}
  </button>
</div>

                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* ✅✅✅ MODALE SIGNATURE — comme devis */}
      {signOpen && isTouch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overscroll-contain"
          onTouchMove={(e) => e.preventDefault()}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden overscroll-contain">
            <div className="flex items-center justify-between border-b px-4 py-3 md:px-5 md:py-4">
              <div className="text-sm font-semibold">Signature du dépôt-vente</div>
              <button
                type="button"
                className="rounded-lg border px-2 py-1 md:px-3 md:py-2 text-xs"
                onClick={() => {
                  setSignOpen(false);
                  setSignConsignmentId("");
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
                    placeholder="Ex : gérant, responsable…"
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

/* -------------------- Création (comme Devis = page dédiée via ?new=1) -------------------- */

function DepotCreateForm({ onBack }: { onBack: () => void }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
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
    suffix: string; // 001..010

    ref: string;
    nameJP: string;
    nameFR: string;

    qty: string;
    unitPriceEuros: string; // auto
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
        unitPriceEuros: "",
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
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

      items: items.map((it) => ({
        ref: it.ref,
        format: it.format, // UI format
        nameFR: it.nameFR,
        qty: Math.max(1, Number(it.qty || 1)),
        unitPrice: eurosToCents(it.unitPriceEuros),
      })),

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

    const c = j?.consignment ?? null;
    const createdNumber = encodeURIComponent(String(c?.number ?? ""));
    const createdId = encodeURIComponent(String(c?.id ?? ""));

    router.replace(`/depot-vente?created=${createdNumber}&createdId=${createdId}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">Créer un dépôt-vente</div>
          <div className="text-sm text-neutral-600">Dépôt / récupération / lignes d’articles (même UX que devis).</div>
        </div>

        <button type="button" onClick={onBack} className="rounded-xl border px-4 py-2 text-sm">
          ← Retour à la liste
        </button>
      </div>

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
            <input className="mt-1 w-full rounded-xl border px-3 py-2 bg-neutral-50" value={validiteLabel} readOnly disabled />
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
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapSociete} onChange={(e) => setSnapSociete(e.target.value)} />
                  </label>

                  <label className="text-sm">
                    <span className="text-neutral-600">Service</span>
                    <input className="mt-1 w-full rounded-xl border px-3 py-2" value={snapService} onChange={(e) => setSnapService(e.target.value)} />
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

            <div className="mt-2">
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

        {/* Dates dépôt */}
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">
            <span className="text-neutral-600">Date de dépôt (J)</span>
            <input type="date" className="mt-1 w-full rounded-xl border px-3 py-2" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} disabled={loading} />
          </label>

          <label className="text-sm">
            <span className="text-neutral-600">Durée (jours)</span>
            <input className="mt-1 w-full rounded-xl border px-3 py-2" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} disabled={loading} />
          </label>

          <label className="text-sm md:col-span-2">
            <span className="text-neutral-600">Date de récupération</span>
            <input type="date" className="mt-1 w-full rounded-xl border px-3 py-2" value={recoveryDate} onChange={(e) => setRecoveryDate(e.target.value)} disabled={loading} />
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
                          setItems((p) => p.map((x, i) => (i === idx ? syncItemFromSelection(x, x.format, nextSuffix) : x)));
                        }}
                      >
                        {POSTERS[formatUiToInternal(it.format)].map((p) => (
  <option key={p.suffix} value={p.suffix}>
    #{p.suffix} — {p.jp} — {p.fr}
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
                          setItems((p) => p.map((x, i) => (i === idx ? syncItemFromSelection(x, nextFmt, x.suffix) : x)));
                        }}
                      >
                        <option value="30×40">30×40</option>
                        <option value="A3">A3</option>
                        <option value="A2">A2</option>
                      </select>
                    </td>

                    <td className="px-4 py-2">
                      <input className="w-full rounded-xl border px-3 py-2 bg-neutral-50 tabular-nums" value={it.ref} readOnly disabled />
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
                      <input className="w-full rounded-xl border px-3 py-2 bg-neutral-50 tabular-nums" value={it.unitPriceEuros} readOnly disabled />
                    </td>

                    <td className="px-4 py-2 text-right">
                      <button className="rounded-xl border px-3 py-2 text-xs" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>
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

        <div className="pt-2 flex items-center justify-end">
          <button className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-60" onClick={createConsignment} disabled={loading}>
            Générer le dépôt
          </button>
        </div>
      </div>
    </div>
  );
}
