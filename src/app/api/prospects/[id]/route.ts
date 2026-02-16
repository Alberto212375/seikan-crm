// src/app/api/prospects/[id]/convert/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type NotesJson = Record<string, any>;
type Methode = { physique: boolean; appel: boolean; mail: boolean };

function safeJson(s: string | null | undefined): NotesJson {
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

function normalizeSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// ✅ split tolérant sur - / ‒ / – / — / ― + espaces + NBSP
function splitCompanyIfPolluted(companyRaw: string, serviceRaw: string) {
  const company = clean(companyRaw);
  const service = clean(serviceRaw);

  if (!company) return { company: "", service };

  const parts = company
    .split(/\s*[-\u2012\u2013\u2014\u2015]\s*/g)
    .map((x) => clean(x))
    .filter(Boolean);

  if (parts.length >= 2) {
    const left = parts[0];
    const right = parts.slice(1).join(" - ").trim();

    if (service && right.toLowerCase() === service.toLowerCase()) return { company: left, service };
    if (!service && right) return { company: left, service: right };
    return { company: left, service };
  }

  return { company, service };
}

function splitContact(contact: string): { lastName: string; firstName: string } {
  const c = normalizeSpaces(contact);

  // tiret long
  if (c.includes("—")) {
    const [a, b] = c.split("—").map((x) => normalizeSpaces(x));
    return { lastName: a ?? "", firstName: b ?? "" };
  }

  const parts = c.split(" ").filter(Boolean);
  if (parts.length <= 1) return { lastName: c, firstName: "" };
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function splitAdresse(adresse: string): { street: string; postalCode: string; city: string } {
  const a = normalizeSpaces(adresse);
  const m = a.match(/(.*)\s(\d{5})\s(.+)$/);
  if (m) {
    return {
      street: normalizeSpaces(m[1]),
      postalCode: m[2],
      city: normalizeSpaces(m[3]),
    };
  }
  return { street: a, postalCode: "", city: "" };
}

function toIsoDateOnly(d: Date | undefined | null) {
  try {
    return d ? d.toISOString().slice(0, 10) : "";
  } catch {
    return "";
  }
}

function parseISODateOnly(s: string): Date | null {
  const v = String(s ?? "").trim();
  if (!v) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sourceToMethode(source: string | null | undefined): Methode {
  const s = (source ?? "").toLowerCase();
  return {
    physique: s.includes("physique"),
    appel: s.includes("appel"),
    mail: s.includes("mail"),
  };
}

function composeDisplayName(args: {
  type: "COMPANY" | "INDIVIDUAL";
  companyName: string;
  lastName: string;
  firstName: string;
  fallbackDisplay?: string;
  fallbackEmail?: string;
}) {
  const ln = (args.lastName || "").trim().toUpperCase();
  const fn = (args.firstName || "").trim();

  if (args.type === "COMPANY") {
    return (args.companyName || args.fallbackDisplay || "Client").trim();
  }

  const full = [ln, fn].filter(Boolean).join(" ").trim();
  return full || (args.fallbackDisplay || args.fallbackEmail || "Client");
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const prospect = await tx.prospect.findUnique({ where: { id } });
      if (!prospect) return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });

      // ✅ notes canonique prospect (si PATCH prospect a tourné)
      const pn = safeJson(prospect.notes);

      // ✅ fallback legacy pour anciens prospects
      const fallbackSociete = clean(pn.societe ?? prospect.company ?? "");
      const fallbackService = clean(pn.service ?? prospect.needType ?? "");
      const fallbackSiret = clean(pn.siret ?? "");
      const fallbackContact = clean(pn.contact ?? prospect.name ?? "");
      const fallbackAdresse = clean(pn.adresse ?? prospect.location ?? "");
      const fallbackEmail = clean(pn.email ?? prospect.email ?? "");
      const fallbackTelephone = clean(pn.telephone ?? prospect.phone ?? "");

      // ✅ nettoyage société/service si pollués (Société — Service)
      const fixedCS = splitCompanyIfPolluted(fallbackSociete, fallbackService);
      const companyName = fixedCS.company;
      const serviceName = fixedCS.service;

      // ✅ méthode
      const methode: Methode =
        pn.methode && typeof pn.methode === "object"
          ? {
              physique: Boolean(pn.methode.physique),
              appel: Boolean(pn.methode.appel),
              mail: Boolean(pn.methode.mail),
            }
          : sourceToMethode(prospect.source);

      // ✅ démarché le (clientDepuisLe)
      const demarcheLeISO =
        clean(pn.demarcheLe) ||
        (prospect.eventDate ? toIsoDateOnly(prospect.eventDate) : "") ||
        toIsoDateOnly(prospect.createdAt);

      const clientDepuisLe = demarcheLeISO ? parseISODateOnly(demarcheLeISO) : null;

      // ✅ isProfessional (déduit si non fourni)
      const inferredIsPro = Boolean(companyName || serviceName || fallbackSiret);
      const isProfessional = typeof pn.isProfessional === "boolean" ? pn.isProfessional : inferredIsPro;

      const nextType: "COMPANY" | "INDIVIDUAL" = isProfessional ? "COMPANY" : "INDIVIDUAL";
      const typeLocked = nextType === "COMPANY"; // ✅ si PRO -> verrouillé

      // ✅ contact split
      let lastName = clean(pn.lastName);
      let firstName = clean(pn.firstName);
      if (!lastName && !firstName && fallbackContact) {
        const s = splitContact(fallbackContact);
        lastName = s.lastName;
        firstName = s.firstName;
      }

      // ✅ adresse split (complète ce qui manque)
      let street = clean(pn.street);
      let postalCode = clean(pn.postalCode);
      let city = clean(pn.city);

      if (fallbackAdresse) {
        const s = splitAdresse(fallbackAdresse);
        if (!street) street = s.street;
        if (!postalCode) postalCode = s.postalCode;
        if (!city) city = s.city;
      }

      // ✅ displayName propre
      const displayName = composeDisplayName({
        type: nextType,
        companyName: companyName,
        lastName,
        firstName,
        fallbackDisplay: "",
        fallbackEmail: fallbackEmail,
      });

      // ✅ adresse compat concat
      const adresseFull = [street, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean).join(" ").trim();

      // ✅ notes JSON compat (mais la note libre reste vide)
      const clientNotes: NotesJson = {
        ...pn,

        isProfessional: nextType === "COMPANY",
        societe: companyName,
        service: serviceName,
        siret: fallbackSiret,

        lastName,
        firstName,

        email: fallbackEmail,
        telephone: fallbackTelephone,

        street,
        postalCode,
        city,

        prospectedInPerson: Boolean(methode.physique),
        prospectedByPhone: Boolean(methode.appel),
        prospectedByEmail: Boolean(methode.mail),

        clientDepuisLe: demarcheLeISO,

        // ✅ note libre = vide (tu ne veux pas polluer)
        notes: "",
      };

      // ✅ anti doublon : si email existe -> update, sinon create
      const existingClient = fallbackEmail ? await tx.client.findFirst({ where: { email: fallbackEmail } }) : null;

      const client = existingClient
        ? await tx.client.update({
            where: { id: existingClient.id },
            data: {
              type: nextType,
              typeLocked: typeLocked,

              companyName: companyName || existingClient.companyName || null,
              serviceName: serviceName || existingClient.serviceName || null,

              siret: fallbackSiret || existingClient.siret || null,
              firstName: firstName || existingClient.firstName || null,
              lastName: lastName || existingClient.lastName || null,

              email: fallbackEmail || existingClient.email || null,
              phone: fallbackTelephone || existingClient.phone || null,

              street: street || existingClient.street || null,
              postalCode: postalCode || existingClient.postalCode || null,
              city: city || existingClient.city || null,

              prospectedInPerson: existingClient.prospectedInPerson || Boolean(methode.physique),
              prospectedByPhone: existingClient.prospectedByPhone || Boolean(methode.appel),
              prospectedByEmail: existingClient.prospectedByEmail || Boolean(methode.mail),

              clientDepuisLe: existingClient.clientDepuisLe ?? clientDepuisLe,

              displayName: displayName || existingClient.displayName,

              // compat
              billingAddress: adresseFull || existingClient.billingAddress,
              shippingAddress: adresseFull || existingClient.shippingAddress,

              // compat JSON
              notes: JSON.stringify(clientNotes),
            },
          })
        : await tx.client.create({
            data: {
              type: nextType,
              typeLocked: typeLocked,

              companyName: companyName || null,
              serviceName: serviceName || null,

              siret: fallbackSiret || null,
              firstName: firstName || null,
              lastName: lastName || null,

              email: fallbackEmail || null,
              phone: fallbackTelephone || null,

              street: street || null,
              postalCode: postalCode || null,
              city: city || null,

              prospectedInPerson: Boolean(methode.physique),
              prospectedByPhone: Boolean(methode.appel),
              prospectedByEmail: Boolean(methode.mail),

              clientDepuisLe: clientDepuisLe,

              displayName: displayName || "Client",

              // compat
              billingAddress: adresseFull || null,
              shippingAddress: adresseFull || null,

              // tags ok
              tags: [],

              // compat JSON
              notes: JSON.stringify(clientNotes),
            },
          });

      // relie prospect -> client (tracer)
      await tx.prospect.update({
        where: { id },
        data: { convertedAt: new Date(), clientId: client.id },
      });

      // supprime le prospect (comme tu fais)
      await tx.prospect.delete({ where: { id } });

      return NextResponse.json({ ok: true, clientId: client.id });
    });

    return result;
  } catch (e: any) {
    console.error("❌ convert prospect -> client failed:", e);
    return NextResponse.json({ error: "Conversion échouée", details: e?.message ?? String(e) }, { status: 500 });
  }
}
