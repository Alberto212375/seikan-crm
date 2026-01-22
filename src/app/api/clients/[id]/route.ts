// src/app/api/clients/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type NotesJson = Record<string, any>;

function safeJsonNotes(s: string | null | undefined): NotesJson {
  if (!s) return {};
  try {
    return JSON.parse(s) as NotesJson;
  } catch {
    return {};
  }
}

function norm(s: unknown) {
  return (typeof s === "string" ? s : "").trim();
}

function clean(s: unknown) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ✅ split ultra tolérant sur tous types de tirets
function splitCompanyIfPolluted(companyRaw: string, serviceRaw: string) {
  const company = clean(companyRaw);
  const service = clean(serviceRaw);

  if (!company) return { company: "", service };

  const parts = company
    .split(/\s*[-\u2012\u2013\u2014\u2015]\s*/g) // - ‒ – — ―
    .map(clean)
    .filter(Boolean);

  if (parts.length >= 2) {
    const left = parts[0];
    const right = parts.slice(1).join(" - ").trim();

    // si le service existe et correspond à la partie droite -> on nettoie
    if (service && right.toLowerCase() === service.toLowerCase()) {
      return { company: left, service };
    }

    // si service est vide, on peut le déduire depuis la partie droite
    if (!service && right) {
      return { company: left, service: right };
    }

    // sinon on force société propre
    return { company: left, service };
  }

  return { company, service };
}

function composeDisplayName(n: NotesJson) {
  const isPro = Boolean(n.isProfessional);
  const societe = norm(n.societe);
  const ln = norm(n.lastName).toUpperCase();
  const fn = norm(n.firstName);

  if (isPro && societe) {
    const full = [ln, fn].filter(Boolean).join(" ").trim();
    return full ? `${societe} — ${full}` : societe;
  }
  const full = [ln, fn].filter(Boolean).join(" ").trim();
  return full || norm(n.email) || "Client";
}

function composeAdresse(n: NotesJson) {
  const street = norm(n.street);
  const cp = norm(n.postalCode);
  const city = norm(n.city);
  const tail = [cp, city].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(" ").trim();
}

/**
 * ✅ Champs figés après conversion Prospect -> Client
 * - Pro : isProfessional
 * - Méthode : prospectedByPhone / prospectedByEmail / prospectedInPerson
 * - Démarché le : clientDepuisLe
 */
function stripLockedFields(patch: Record<string, any>) {
  const locked = new Set([
    "isProfessional",
    "prospectedByPhone",
    "prospectedByEmail",
    "prospectedInPerson",
    "clientDepuisLe",
  ]);

  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (locked.has(k)) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const rawPatch = (await req.json().catch(() => ({}))) as Record<string, any>;

  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const n = safeJsonNotes(existing.notes);

  // ✅ on ignore toute tentative de modification des champs figés
  const patch = stripLockedFields(rawPatch);

  // merge patch -> notes
  const nextNotes: NotesJson = { ...n, ...patch };

  // ✅ FIX DÉFINITIF : societe ne doit jamais contenir "— service"
  const fixed = splitCompanyIfPolluted(String(nextNotes.societe ?? ""), String(nextNotes.service ?? ""));
  nextNotes.societe = fixed.company;
  nextNotes.service = fixed.service;

  // champs standard synchronisés
  const email = norm(nextNotes.email) || norm(existing.email);
  const phone = norm(nextNotes.telephone) || norm(existing.phone);

  const displayName = composeDisplayName(nextNotes);
  const adresse = composeAdresse(nextNotes);

  const updated = await prisma.client.update({
    where: { id },
    data: {
      displayName,
      email: email || null,
      phone: phone || null,
      billingAddress: adresse || null,
      shippingAddress: adresse || null,
      notes: JSON.stringify(nextNotes),
    },
  });

  return NextResponse.json({ ok: true, client: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  await prisma.client.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
