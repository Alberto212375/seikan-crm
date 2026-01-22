// src/app/api/prospects/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


type Methode = { physique: boolean; appel: boolean; mail: boolean };
type ProspectUi = {
  id: string;
  societe: string;
  contact: string;
  service: string;
  email: string;
  telephone: string;
  adresse: string;
  demarcheLe: string; // YYYY-MM-DD
  methode: Methode;
  createdAt?: string;
  updatedAt?: string;
};

function parseISODateOnly(s: unknown): Date | null {
  const v = typeof s === "string" ? s.trim() : "";
  if (!v) return null;
  // attendu: YYYY-MM-DD
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtISODateOnly(d: Date | null): string {
  if (!d) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function methodeToSource(m: Methode | null | undefined): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.physique) parts.push("physique");
  if (m.appel) parts.push("appel");
  if (m.mail) parts.push("mail");
  return parts.length ? parts.join(",") : null;
}

function sourceToMethode(source: string | null | undefined): Methode {
  const s = (source ?? "").toLowerCase();
  return {
    physique: s.includes("physique"),
    appel: s.includes("appel"),
    mail: s.includes("mail"),
  };
}

function toUi(p: any): ProspectUi {
  return {
    id: p.id,
    societe: p.company ?? "",
    contact: p.name ?? "",
    service: p.needType ?? "",
    email: p.email ?? "",
    telephone: p.phone ?? "",
    adresse: p.location ?? "",
    demarcheLe: fmtISODateOnly(p.eventDate ?? null),
    methode: sourceToMethode(p.source),
    createdAt: p.createdAt?.toISOString?.(),
    updatedAt: p.updatedAt?.toISOString?.(),
  };
}

export async function GET() {
  const prospects = await prisma.prospect.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ prospects: prospects.map(toUi) });
}

export async function POST() {
  // Crée un prospect "vide" pour coller à ton bouton "Nouveau prospect"
  const created = await prisma.prospect.create({
    data: {
      name: "",
      company: "",
      email: null,
      phone: null,
      location: null,
      needType: null,
      source: null,
      stage: "NEW",
      eventDate: null,
      notes: null,
    },
  });

  return NextResponse.json({ prospect: toUi(created) }, { status: 201 });
}

export async function PATCH(req: Request) {
  // PATCH en bulk optionnel (non utilisé par défaut). On garde pour compat.
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id requis" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
