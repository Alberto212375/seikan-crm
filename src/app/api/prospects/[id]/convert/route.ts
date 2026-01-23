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

function normalizeSpaces(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// ✅ FIX DÉFINITIF : split tolérant sur - / ‒ / – / — / ― + espaces + NBSP
function splitCompanyIfPolluted(companyRaw: string, serviceRaw: string) {
  const clean = (s: unknown) =>
    String(s ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

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

function sourceToMethode(source: string | null | undefined): Methode {
  const s = (source ?? "").toLowerCase();
  return {
    physique: s.includes("physique"),
    appel: s.includes("appel"),
    mail: s.includes("mail"),
  };
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

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const prospect = await tx.prospect.findUnique({ where: { id } });
      if (!prospect) return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });

      // ✅ 1) Base: notes canonique (si la PATCH prospects a bien tourné)
      const pn = safeJson(prospect.notes);

      // ✅ 2) Fallback legacy (pour anciens prospects)
      const fallbackSociete = norm(pn.societe) || norm(prospect.company);
      const fallbackService = norm(pn.service) || norm(prospect.needType);
      const fallbackSiret = norm(pn.siret);

      // ✅ nettoyage société/service si pollués (Société — Service)
      const fixedCS = splitCompanyIfPolluted(fallbackSociete, fallbackService);
      const finalSociete = fixedCS.company;
      const finalService = fixedCS.service;

      const fallbackContact = norm(pn.contact) || norm(prospect.name);
      const fallbackAdresse = norm(pn.adresse) || norm(prospect.location);

             const fallbackEmail = norm(pn.email) || norm(prospect.email) || "";
      const fallbackTelephone = norm(pn.telephone) || norm(prospect.phone) || "";


      // méthode
      const methode: Methode =
        pn.methode && typeof pn.methode === "object"
          ? {
              physique: Boolean(pn.methode.physique),
              appel: Boolean(pn.methode.appel),
              mail: Boolean(pn.methode.mail),
            }
          : sourceToMethode(prospect.source);

      // démarché le
      const demarcheLe =
        norm(pn.demarcheLe) ||
        (prospect.eventDate ? toIsoDateOnly(prospect.eventDate) : "") ||
        toIsoDateOnly(prospect.createdAt);

      // isProfessional
      const inferredIsPro = Boolean(finalSociete || finalService || fallbackSiret);
      const isProfessional = Boolean(pn.isProfessional ?? inferredIsPro);

      // contact split
      let lastName = norm(pn.lastName);
      let firstName = norm(pn.firstName);
      if (!lastName && !firstName && fallbackContact) {
        const s = splitContact(fallbackContact);
        lastName = s.lastName;
        firstName = s.firstName;
      }

          // adresse split (✅ plus robuste : complète les champs manquants, même partiellement)
      let street = norm(pn.street);
      let postalCode = norm(pn.postalCode);
      let city = norm(pn.city);

      if (fallbackAdresse) {
        const s = splitAdresse(fallbackAdresse);

        // on complète seulement ce qui manque
        if (!street) street = s.street;
        if (!postalCode) postalCode = s.postalCode;
        if (!city) city = s.city;
      }


      const clientNotes: NotesJson = {
        // on part d’un merge propre
        ...pn,

        isProfessional,
        societe: finalSociete,
        service: finalService,
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

        clientDepuisLe: demarcheLe,

        // note libre (si présente)
        notes: norm(pn.notes) || "",
      };

      const displayName = composeDisplayName(clientNotes);
      const adresseFull = composeAdresse(clientNotes);

      // ✅ NOUVEAU : écrire les colonnes Prisma séparées (source de vérité)
      const companyName = finalSociete || null;
      const serviceName = finalService || null;

      // évite doublon : si email existe déjà côté client, on update au lieu de recréer
      let client = fallbackEmail ? await tx.client.findFirst({ where: { email: fallbackEmail } }) : null;

      if (!client) {
        client = await tx.client.create({
          data: {
            // ✅ colonnes séparées
            companyName,
            serviceName,

            displayName,
            email: fallbackEmail || null,
            phone: fallbackTelephone || null,
            billingAddress: adresseFull || null,
            shippingAddress: adresseFull || null,
            notes: JSON.stringify(clientNotes),
          },
        });
      } else {
        const cn = safeJson(client.notes);
        const merged = { ...cn, ...clientNotes };

        // ✅ NOUVEAU : on garde/écrase avec la valeur “propre”
        const mergedSociete = norm(merged.societe);
        const mergedService = norm(merged.service);

        client = await tx.client.update({
          where: { id: client.id },
          data: {
            // ✅ colonnes séparées
            companyName: mergedSociete || client.companyName || null,
            serviceName: mergedService || client.serviceName || null,

            displayName: composeDisplayName(merged),
            phone: fallbackTelephone || client.phone,
            billingAddress: composeAdresse(merged) || client.billingAddress,
            shippingAddress: composeAdresse(merged) || client.shippingAddress,
            notes: JSON.stringify(merged),
          },
        });
      }

      // relie prospect -> client (utile si tu veux tracer)
      await tx.prospect.update({
        where: { id },
        data: { convertedAt: new Date(), clientId: client.id },
      });

      // supprime le prospect de la liste (comme tu fais)
      await tx.prospect.delete({ where: { id } });

      return NextResponse.json({ ok: true, clientId: client.id });
    });

    return result;
  } catch (e: any) {
    console.error("❌ convert prospect -> client failed:", e);
    return NextResponse.json({ error: "Conversion échouée", details: e?.message ?? String(e) }, { status: 500 });
  }
}
