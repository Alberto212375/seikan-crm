// src/app/(crm)/depot-vente/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

  metaJson?: string | null;

  items: Item[];
};

type ConsignmentMeta = Partial<{
  signature: Partial<{
    signerFirstName: string;
    signerLastName: string;
    signerRole: string;
    accepted: boolean;
    signedAt: string;
    signatureDataUrl: string;
  }>;
}>;

function safeMeta(s: string | null | undefined): ConsignmentMeta {
  if (!s) return {};
  try {
    return JSON.parse(s) as ConsignmentMeta;
  } catch {
    return {};
  }
}

// ✅ Mémo dernier signataire (comme devis / liste dépôt-vente)
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

export default function DepotVenteDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const sp = useSearchParams();
  const action = sp.get("action"); // "sign" => on ouvre la zone signature

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [c, setC] = useState<Detail | null>(null);

  // signature UI
  const [signerFirstName, setSignerFirstName] = useState("");
  const [signerLastName, setSignerLastName] = useState("");
  const [signerRole, setSignerRole] = useState("Gérant");
  const [accepted, setAccepted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const signatureOpen = action === "sign";

    // ✅ Pré-remplissage automatique à l’ouverture (comme devis)
  useEffect(() => {
    if (!signatureOpen) return;

    const last = loadLastSigner();
    if (!last) return;

    // on ne force pas si déjà rempli (ex: si déjà signé => champs hydratés)
    setSignerFirstName((v) => (String(v || "").trim() ? v : last.firstName));
    setSignerLastName((v) => (String(v || "").trim() ? v : last.lastName));
    setSignerRole((v) => (String(v || "").trim() ? v : last.role || "Gérant"));
  }, [signatureOpen]);

  async function load() {
    const r = await fetch(`/api/consignments/${encodeURIComponent(id)}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j?.error ?? "Erreur chargement dépôt-vente");
      return;
    }
    const cc = j.consignment as Detail;
    setC(cc);

    // hydrate signature fields si déjà signé
    const meta = safeMeta((cc as any).metaJson ?? null);
    const sig = (meta as any)?.signature ?? {};
    if (sig?.signerFirstName) setSignerFirstName(String(sig.signerFirstName));
    if (sig?.signerLastName) setSignerLastName(String(sig.signerLastName));
    if (sig?.signerRole) setSignerRole(String(sig.signerRole));
    if (sig?.accepted) setAccepted(Boolean(sig.accepted));
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

  // ✅ Comme devis : bloquer le scroll quand la "modale" signature est ouverte
  useEffect(() => {
    if (!signatureOpen) return;

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
  }, [signatureOpen]);

    function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const r = c.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(r.width));
    const cssH = 140;

    // ctx est en "unités CSS" (car on setTransform avec DPR)
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

    // ✅ Calibrage canvas correct (DPR) => plus de décalage doigt/stylet
  useEffect(() => {
    if (!signatureOpen) return;

    const t = setTimeout(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;

      const rect = c.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      // taille CSS (ce que tu vois)
      const cssW = Math.max(300, Math.floor(rect.width));
      const cssH = 140;

      // taille interne en pixels réels (retina)
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);

      // 1 unité canvas = 1 pixel CSS
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // fond blanc
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, cssW, cssH);

      // style trait
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }, 50);

    return () => clearTimeout(t);
  }, [signatureOpen]);

    function getPos(e: any, canvas: HTMLCanvasElement) {
    const r = canvas.getBoundingClientRect();
    const t = e?.touches?.[0] || e?.changedTouches?.[0] || null;
    const clientX = t ? t.clientX : e.clientX;
    const clientY = t ? t.clientY : e.clientY;

    // coordonnées en pixels CSS (et ctx est déjà "scalé DPR")
    const x = clientX - r.left;
    const y = clientY - r.top;

    return { x, y };
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

  async function submitSignature() {
    if (!c) return;

    const fn = String(signerFirstName || "").trim();
    const ln = String(signerLastName || "").trim();
    if (!fn || !ln) return alert("Nom + prénom du signataire requis.");
    if (!accepted) return alert("Tu dois cocher la mention 'Bon pour accord'.");

    const cv = canvasRef.current;
    if (!cv) return alert("Canvas signature introuvable.");

           const dataUrl = cv.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/")) return alert("Signature invalide.");

    // ✅ mémorise pour les prochaines signatures
    saveLastSigner(fn, ln, signerRole);

    setSaving(true);
    try {
      const r = await fetch(`/api/consignments/${encodeURIComponent(id)}/signature`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerFirstName: fn,
          signerLastName: ln,
          signerRole,
          accepted: true,
          signatureDataUrl: dataUrl,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) return alert(j?.error ?? "Erreur signature");

      await load();
      alert("Signé ✅");
      window.open(`/api/exports/consignments/${encodeURIComponent(id)}/pdf`, "_blank");
    } finally {
      setSaving(false);
    }
  }

  async function sendToClient() {
    if (!c) return;
    if (!confirm("Envoyer ce dépôt-vente au client par email ?")) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/consignments/${encodeURIComponent(id)}/send`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return alert(j?.error ?? "Erreur envoi email");

      alert("Email envoyé au client ✅");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading || !c) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Chargement…</div>;
  }

  const meta = safeMeta((c as any).metaJson ?? null);
  const sig = (meta as any)?.signature ?? {};
  const isSigned = Boolean(sig?.accepted && sig?.signatureDataUrl);

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
            {isSigned ? <> · ✍️ Signé le {fmtDateFR(sig?.signedAt ?? null)}</> : null}
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

          <button className="rounded-xl border px-3 py-2 text-xs" disabled={saving} onClick={sendToClient}>
            {saving ? "…" : "Envoyer au client"}
          </button>

          <a className="rounded-xl bg-black px-3 py-2 text-xs text-white" href={`/depot-vente/${encodeURIComponent(id)}?action=sign`}>
            Signer
          </a>
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

      {/* ✅ Signature (MODALE comme devis : plein écran, anti-scroll, canvas doigt) */}
      {signatureOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overscroll-contain"
          onTouchMove={(e) => e.preventDefault()}
        >
          <div className="w-full max-w-3xl rounded-2xl border bg-white p-4 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Signature du dépôt-vente</div>
                <div className="text-xs text-neutral-600">Nom + prénom + qualité, “Bon pour accord”, puis signature.</div>
              </div>

              <a className="rounded-xl border px-3 py-2 text-xs" href={`/depot-vente/${encodeURIComponent(id)}`}>
                Fermer
              </a>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                <span className="text-neutral-600">Prénom</span>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={signerFirstName}
                  onChange={(e) => setSignerFirstName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="text-neutral-600">Nom</span>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={signerLastName}
                  onChange={(e) => setSignerLastName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="text-neutral-600">Qualité</span>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={signerRole}
                  onChange={(e) => setSignerRole(e.target.value)}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>Bon pour accord</span>
            </label>

            <div className="rounded-2xl border p-3">
              <div className="text-xs text-neutral-600 mb-2">Signature</div>

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

              <div className="mt-2 flex items-center justify-between">
                <button className="rounded-xl border px-3 py-2 text-xs" type="button" onClick={clearCanvas}>
                  Effacer
                </button>

                <button
                  className="rounded-xl bg-black px-4 py-2 text-sm text-white"
                  type="button"
                  disabled={saving}
                  onClick={submitSignature}
                >
                  {saving ? "Signature…" : "Signer et générer le PDF"}
                </button>
              </div>
            </div>

            {isSigned ? (
              <div className="text-xs text-neutral-600">
                Déjà signé : {String(sig?.signerLastName ?? "").toUpperCase()} {String(sig?.signerFirstName ?? "")} —{" "}
                {String(sig?.signerRole ?? "Gérant")} · {fmtDateFR(sig?.signedAt ?? null)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
