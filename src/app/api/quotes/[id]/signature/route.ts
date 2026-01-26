// src/app/api/quotes/[id]/signature/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteMeta = {
  signature?: {
    signerFirstName?: string;
    signerLastName?: string;
    signerRole?: string;

    accepted?: boolean; // "Bon pour accord"
    signedAt?: string; // ISO string
    signatureDataUrl?: string; // data:image/png;base64,...

    context?: {
      ip?: string;
      userAgent?: string;
    };
  };
};

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function normalize(s: unknown) {
  return String(s ?? "").trim();
}

function getClientIp(req: Request) {
  // en prod, tu es derrière proxy => x-forwarded-for
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "";
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = String(params?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    const signerFirstName = normalize(body?.signerFirstName);
    const signerLastName = normalize(body?.signerLastName);
        const signerRole = normalize(body?.signerRole) || "Gérant";

    const accepted = Boolean(body?.accepted);
    const signatureDataUrl = normalize(body?.signatureDataUrl);

    if (!signerFirstName || !signerLastName) {
      return NextResponse.json({ error: "Nom + prénom du signataire requis" }, { status: 400 });
    }
    if (!accepted) {
      return NextResponse.json({ error: "La mention 'Bon pour accord' doit être cochée" }, { status: 400 });
    }
    if (!signatureDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "Signature invalide (dataUrl image attendu)" }, { status: 400 });
    }

    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, metaJson: true },
    });

    if (!quote) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    const meta = safeJsonParse<QuoteMeta>(quote.metaJson) ?? {};

    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? "";

    const signedAt = new Date().toISOString();

    const nextMeta: QuoteMeta = {
      ...meta,
      signature: {
        signerFirstName,
        signerLastName,
        signerRole,
        accepted: true,
        signedAt,
        signatureDataUrl,
        context: {
          ip: ip || undefined,
          userAgent: userAgent || undefined,
        },
      },
    };

    await prisma.quote.update({
      where: { id },
      data: { metaJson: JSON.stringify(nextMeta) },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, signedAt });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

// ✅ Compat : certains écrans envoient POST (ou PUT) par habitude.
// On délègue vers PATCH pour ne pas casser l’UX.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  return PATCH(req, ctx);
}

export async function PUT(req: Request, ctx: { params: { id: string } }) {
  return PATCH(req, ctx);
}
