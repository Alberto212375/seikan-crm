// src/app/api/prospects/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Methode = { physique: boolean; appel: boolean; mail: boolean };
type NotesJson = Record<string, any>;

function safeJson(s: string | null | undefined): NotesJson {
  if (!s) return {};
  try {
    return JSON.parse(s) as NotesJson;
  } catch {
    return {};
  }
}

function normalizeSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function parseISODateOnly(s: unknown): Date | null {
  const v = typeof s === "string" ? s.trim() : "";
  if (!v) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDateOnly(d: Date | null | undefined) {
  try {
    return d ? d.toISOString().slice(0, 10) : "";
  } catch {
    return "";
  }
}

function methodeToSource(m: Methode | null | undefined): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.physique) parts.push("physique");
  if (m.appel) parts.push("appel");
  if (m.mail) parts.push("mail");
  return parts.length ? parts.join(",") : null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const body = await req.json().catch(() => null);

  const societe = typeof body?.societe === "string" ? body.societe : undefined;
  const contact = typeof body?.contact === "string" ? body.contact : undefined;
  const service = typeof body?.service === "string" ? body.service : undefined;
  const email = typeof body?.email === "string" ? body.email : undefined;
  const telephone = typeof body?.telephone === "string" ? body.telephone : undefined;
  const adresse = typeof body?.adresse === "string" ? body.adresse : undefined;
  const demarcheLe = body?.demarcheLe;
  const methode = body?.methode as Methode | undefined;

  // siret est “UI only” dans ton schema actuel -> on le persiste dans notes JSON
  const siret = typeof body?.siret === "string" ? body.siret : undefined;

  // ✅ On récupère le prospect pour merge propre des notes
  const existing = await prisma.prospect.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }

  const pn = safeJson(existing.notes);

  // ✅ Canonique: on stocke TOUT ce que l’UI utilise dans notes
  if (societe !== undefined) pn.societe = normalizeSpaces(societe);
  if (service !== undefined) pn.service = normalizeSpaces(service);
  if (siret !== undefined) pn.siret = normalizeSpaces(siret);

  if (contact !== undefined) pn.contact = normalizeSpaces(contact);
  if (email !== undefined) pn.email = normalizeSpaces(email);
  if (telephone !== undefined) pn.telephone = normalizeSpaces(telephone);
  if (adresse !== undefined) pn.adresse = normalizeSpaces(adresse);

  if (demarcheLe !== undefined) {
    const d = parseISODateOnly(demarcheLe);
    pn.demarcheLe = d ? toIsoDateOnly(d) : "";
  }

  if (methode !== undefined) {
    pn.methode = {
      physique: Boolean(methode.physique),
      appel: Boolean(methode.appel),
      mail: Boolean(methode.mail),
    };
  }

  // ✅ Bonus: isProfessional canonique (sert à la conversion)
  const inferredIsPro = Boolean(
    normalizeSpaces(pn.societe ?? "") ||
      normalizeSpaces(pn.service ?? "") ||
      normalizeSpaces(pn.siret ?? "")
  );
  pn.isProfessional = Boolean(pn.isProfessional ?? inferredIsPro);

  // ✅ Compat: on continue à écrire dans les colonnes legacy
  const data: any = {};
  if (societe !== undefined) data.company = societe || null;
  if (contact !== undefined) data.name = contact || "";
  if (service !== undefined) data.needType = service || null;
  if (email !== undefined) data.email = email || null;
  if (telephone !== undefined) data.phone = telephone || null;
  if (adresse !== undefined) data.location = adresse || null;
  if (demarcheLe !== undefined) data.eventDate = parseISODateOnly(demarcheLe);
  if (methode !== undefined) data.source = methodeToSource(methode);

  // ✅ On persiste notes JSON “canonique”
  data.notes = JSON.stringify(pn);

  const updated = await prisma.prospect.update({
    where: { id },
    data,
  });

  return NextResponse.json({ ok: true, updatedAt: updated.updatedAt.toISOString() });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  await prisma.prospect.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
