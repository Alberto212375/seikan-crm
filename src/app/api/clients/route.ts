// src/app/api/clients/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

type NotesJson = Partial<{
  isProfessional: boolean;
  societe: string;
  service: string;
  siret: string;

  lastName: string;
  firstName: string;

  email: string;
  telephone: string;

  street: string;
  postalCode: string;
  city: string;

  prospectedByPhone: boolean;
  prospectedByEmail: boolean;
  prospectedInPerson: boolean;

  clientDepuisLe: string;

  // ✅ note libre
  notes: string;
}>;

function safeJsonNotes(s: string | null | undefined): NotesJson | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as NotesJson;
  } catch {
    return null;
  }
}

function toIsoDate(d: Date | undefined | null) {
  try {
    return d ? d.toISOString().slice(0, 10) : "";
  } catch {
    return "";
  }
}

// ✅ ultra-tolérant : split sur - / – / — / etc + espaces / NBSP
function normalizeCompanyAndService(rawCompany: string, rawService: string) {
  const clean = (s: string) =>
    String(s || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const company = clean(rawCompany);
  const service = clean(rawService);

  if (!company) return { company: "", service };

  // split sur tout type de "tiret"
  const parts = company
    .split(/\s*[-\u2012\u2013\u2014\u2015]\s*/g)
    .map(clean)
    .filter(Boolean);

  if (parts.length >= 2) {
    const left = parts[0];
    const right = parts.slice(1).join(" - ").trim();

    // si service est déjà = right (même avec espaces), on nettoie company
    if (service && right.toLowerCase() === service.toLowerCase()) {
      return { company: left, service };
    }

    // si service vide, on peut déduire service
    if (!service && right) {
      return { company: left, service: right };
    }

    // sinon, on garde quand même la société "propre"
    return { company: left, service };
  }

  return { company, service };
}

function splitLastFirst(lastNameRaw: string, firstNameRaw: string) {
  const clean = (s: unknown) =>
    String(s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const ln0 = clean(lastNameRaw);
  const fn0 = clean(firstNameRaw);

  // cas normal
  if (fn0) return { lastName: ln0, firstName: fn0 };

  // si tout est dans lastName : "NOM — PRÉNOM" (ou autres tirets)
  const parts = ln0
    .split(/\s*[-\u2012\u2013\u2014\u2015—]\s*/g)
    .map((x) => clean(x))
    .filter(Boolean);

  if (parts.length >= 2) {
    return { lastName: parts[0] ?? "", firstName: parts.slice(1).join(" ") ?? "" };
  }

  return { lastName: ln0, firstName: "" };
}

function toUi(c: any): ClientUi {
  const n = safeJsonNotes(c.notes) ?? {};

  // ✅ NOUVEAU : source de vérité = colonnes Prisma
  // fallback = notes (compat) si jamais
  const rawSociete = String(c.companyName ?? n.societe ?? "");
  const rawService = String(c.serviceName ?? n.service ?? "");

  // ✅ garde ton normalize “anti pollution”
  const normalized = normalizeCompanyAndService(rawSociete, rawService);

  const isProfessional = c?.type === "COMPANY" || Boolean(n.isProfessional ?? false);
    // ✅ 1) priorité : notes.lastName / notes.firstName
  let nameSplit = splitLastFirst(String(n.lastName ?? ""), String(n.firstName ?? ""));

  // ✅ 2) fallback : client.displayName (très utile pour les PRO issus des prospects)
  if (!nameSplit.lastName && !nameSplit.firstName) {
    const display = String(c.displayName ?? "").trim();
    if (display) {
      nameSplit = splitLastFirst(display, "");
    }
  }

  return {
    id: c.id,

    isProfessional,

    // ✅ société propre + service propre
    societe: normalized.company,
    service: normalized.service,
    siret: String(n.siret ?? ""),

    lastName: nameSplit.lastName,
    firstName: nameSplit.firstName,


    email: String(n.email ?? c.email ?? ""),
    telephone: String(n.telephone ?? c.phone ?? ""),

    street: String(n.street ?? ""),
    postalCode: String(n.postalCode ?? ""),
    city: String(n.city ?? ""),

    prospectedByPhone: Boolean(n.prospectedByPhone ?? false),
    prospectedByEmail: Boolean(n.prospectedByEmail ?? false),
    prospectedInPerson: Boolean(n.prospectedInPerson ?? false),

    clientDepuisLe: String(n.clientDepuisLe ?? toIsoDate(c.createdAt)),

    // ✅ IMPORTANT : notes = uniquement note libre
    notes: String(n.notes ?? ""),
  };
}

export async function GET() {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ clients: clients.map(toUi) });
}
