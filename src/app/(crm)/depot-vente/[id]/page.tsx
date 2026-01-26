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
  const drawing = useRef(false);

  const signatureOpen = action === "sign";

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

  function clearCanvas() {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
  }

  function ensureCanvasBg() {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // fond blanc (sinon transparent)
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }

  useEffect(() => {
    // init canvas
    const cv = canvasRef.current;
    if (!cv) return;
    cv.width = 700;
    cv.height = 220;
    ensureCanvasBg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureOpen]);

  function getPos(e: any) {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function onDown(e: any) {
    if (!canvasRef.current) return;
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function onMove(e: any) {
    if (!drawing.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function onUp() {
    drawing.current = false;
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

    setSaving(true);
    try {
      const r = await fetch(`/api/consignments/${encodeURIComponent(id)}/signature`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerFirstName: fn,
          signerLastName: ln,
          signerRole,
          accepted,
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

      {/* Signature zone (comme devis) */}
      {signatureOpen && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Signature du dépôt-vente</div>
              <div className="text-xs text-neutral-600">
                Nom + prénom + qualité, “Bon pour accord”, puis signature.
              </div>
            </div>

            <a className="rounded-xl border px-3 py-2 text-xs" href={`/depot-vente/${encodeURIComponent(id)}`}>
              Fermer
            </a>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              <span className="text-neutral-600">Prénom</span>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={signerFirstName} onChange={(e) => setSignerFirstName(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-neutral-600">Nom</span>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={signerLastName} onChange={(e) => setSignerLastName(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-neutral-600">Qualité</span>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={signerRole} onChange={(e) => setSignerRole(e.target.value)} />
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
              className="w-full rounded-xl border bg-white touch-none"
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onTouchStart={(e) => {
                e.preventDefault();
                onDown(e);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                onMove(e);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                onUp();
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <button className="rounded-xl border px-3 py-2 text-xs" type="button" onClick={clearCanvas}>
                Effacer
              </button>

              <button className="rounded-xl bg-black px-4 py-2 text-sm text-white" type="button" disabled={saving} onClick={submitSignature}>
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
      )}
    </div>
  );
}
