// src/app/api/clients/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


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

function splitAdresseFull(adresse: string): { street: string; postalCode: string; city: string } {
  const a = String(adresse ?? "").replace(/\s+/g, " ").trim();
  const m = a.match(/(.*)\s(\d{5})\s(.+)$/);
  if (m) {
    return {
      street: String(m[1] ?? "").trim(),
      postalCode: String(m[2] ?? "").trim(),
      city: String(m[3] ?? "").trim(),
    };
  }
  return { street: a, postalCode: "", city: "" };
}

function toUi(c: any): ClientUi {
  const n = safeJsonNotes(c.notes) ?? {};

  // ✅ source de vérité = colonnes Prisma
  // fallback = notes (compat)

  const rawSociete = String(c.companyName ?? n.societe ?? "");
  const rawService = String(c.serviceName ?? n.service ?? "");
  const normalized = normalizeCompanyAndService(rawSociete, rawService);

  const isProfessional = c?.type === "COMPANY" || Boolean(n.isProfessional ?? false);

  // ✅ nom/prénom : colonnes -> fallback notes -> fallback displayName
  const lnCol = String(c.lastName ?? "").trim();
  const fnCol = String(c.firstName ?? "").trim();

  let nameSplit = splitLastFirst(
    lnCol || String(n.lastName ?? ""),
    fnCol || String(n.firstName ?? "")
  );

  if (!nameSplit.lastName && !nameSplit.firstName) {
    const display = String(c.displayName ?? "").trim();
    if (display) nameSplit = splitLastFirst(display, "");
  }

  // ✅ adresse : colonnes -> fallback notes -> fallback billingAddress/shippingAddress
  const streetCol = String(c.street ?? "").trim();
  const cpCol = String(c.postalCode ?? "").trim();
  const cityCol = String(c.city ?? "").trim();

  const addrFallback = splitAdresseFull(String(c.billingAddress ?? c.shippingAddress ?? ""));

  const street = streetCol || String(n.street ?? addrFallback.street ?? "");
  const postalCode = cpCol || String(n.postalCode ?? addrFallback.postalCode ?? "");
  const city = cityCol || String(n.city ?? addrFallback.city ?? "");

  return {
    id: c.id,

    isProfessional,

    societe: normalized.company,
    service: normalized.service,

    // ✅ NEW : colonne siret -> fallback notes
    siret: String(c.siret ?? n.siret ?? ""),

    lastName: nameSplit.lastName,
    firstName: nameSplit.firstName,

    email: String(c.email ?? n.email ?? ""),
    telephone: String(c.phone ?? n.telephone ?? ""),

    street: String(street ?? ""),
    postalCode: String(postalCode ?? ""),
    city: String(city ?? ""),

    // ✅ NEW : colonnes prospection -> fallback notes
    prospectedByPhone: Boolean(c.prospectedByPhone ?? n.prospectedByPhone ?? false),
    prospectedByEmail: Boolean(c.prospectedByEmail ?? n.prospectedByEmail ?? false),
    prospectedInPerson: Boolean(c.prospectedInPerson ?? n.prospectedInPerson ?? false),

    // ✅ NEW : colonne date -> fallback notes -> createdAt
    clientDepuisLe: String(
      (c.clientDepuisLe ? toIsoDate(c.clientDepuisLe) : "") ||
        n.clientDepuisLe ||
        toIsoDate(c.createdAt)
    ),

    // ✅ note libre : champ notes dans JSON legacy si présent
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
