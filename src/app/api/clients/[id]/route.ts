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

  const existingNotes = safeJsonNotes(existing.notes);

  // ✅ on ignore toute tentative de modification des champs figés
  const patch = stripLockedFields(rawPatch);

  // --- lecture patch (UI fields) ---
  const isProfessionalPatch =
    typeof patch.isProfessional === "boolean" ? patch.isProfessional : undefined;

  const societeRaw = clean(patch.societe ?? existing.companyName ?? existingNotes.societe ?? "");
  const serviceRaw = clean(patch.service ?? existing.serviceName ?? existingNotes.service ?? "");
  const fixed = splitCompanyIfPolluted(societeRaw, serviceRaw);

  const siret = clean(patch.siret ?? existing.siret ?? existingNotes.siret ?? "") || null;

  const lastName = clean(patch.lastName ?? existing.lastName ?? existingNotes.lastName ?? "");
  const firstName = clean(patch.firstName ?? existing.firstName ?? existingNotes.firstName ?? "");

  const email = clean(patch.email ?? existing.email ?? existingNotes.email ?? "") || null;
  const phone = clean(patch.telephone ?? existing.phone ?? existingNotes.telephone ?? "") || null;

  const street = clean(patch.street ?? existing.street ?? existingNotes.street ?? "");
  const postalCode = clean(patch.postalCode ?? existing.postalCode ?? existingNotes.postalCode ?? "");
  const city = clean(patch.city ?? existing.city ?? existingNotes.city ?? "");

  // note libre (compat)
  const freeNote = typeof patch.notes === "string" ? patch.notes : (existingNotes.notes ?? "");

  // --- type (respect du lock) ---
  const nextType =
    existing.typeLocked
      ? existing.type
      : (isProfessionalPatch === true ? "COMPANY" : isProfessionalPatch === false ? "INDIVIDUAL" : existing.type);

  // --- displayName : simple et propre ---
  const displayName =
    nextType === "COMPANY"
      ? (fixed.company || existing.displayName || "Client")
      : ([lastName.toUpperCase(), firstName].filter(Boolean).join(" ").trim() || existing.displayName || "Client");

  // --- adresse compat concat ---
  const adresse =
    [street, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean).join(" ").trim();

  // --- notes JSON compat (on maintient l’ancien format pour ne rien casser) ---
  const nextNotes: NotesJson = {
    ...existingNotes,

    // champs UI
    isProfessional: nextType === "COMPANY",
    societe: fixed.company,
    service: fixed.service,
    siret: siret ?? "",

    lastName: lastName || "",
    firstName: firstName || "",

    email: email ?? "",
    telephone: phone ?? "",

    street: street || "",
    postalCode: postalCode || "",
    city: city || "",

    // champs figés : on ne les modifie pas ici
    prospectedByPhone: existing.prospectedByPhone ?? existingNotes.prospectedByPhone ?? false,
    prospectedByEmail: existing.prospectedByEmail ?? existingNotes.prospectedByEmail ?? false,
    prospectedInPerson: existing.prospectedInPerson ?? existingNotes.prospectedInPerson ?? false,
    clientDepuisLe:
      (existing.clientDepuisLe ? existing.clientDepuisLe.toISOString().slice(0, 10) : "") ||
      existingNotes.clientDepuisLe ||
      "",

    // note libre
    notes: String(freeNote ?? ""),
  };

  const updated = await prisma.client.update({
    where: { id },
    data: {
      type: nextType,

      companyName: fixed.company || null,
      serviceName: fixed.service || null,

      siret: siret,
      firstName: firstName || null,
      lastName: lastName || null,

      email,
      phone,

      street: street || null,
      postalCode: postalCode || null,
      city: city || null,

      displayName,

      // compat
      billingAddress: adresse || null,
      shippingAddress: adresse || null,

      // compat JSON
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
