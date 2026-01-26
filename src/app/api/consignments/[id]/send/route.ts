// src/app/api/consignments/[id]/send/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodemailer = require("nodemailer");

function fmtDateFR(d: Date | string | null | undefined) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function normalizeSpaces(s: any) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escHtml(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP non configuré. Ajoute SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS dans les variables d’environnement."
    );
  }

  const secure =
    String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true"
      ? true
      : port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function getFromAddress() {
  return process.env.SMTP_FROM || "SEIKAN GALLERY <seikan.gallery@gmail.com>";
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const consignmentId = params.id;

  try {
        const c = await prisma.consignment.findUnique({
      where: { id: consignmentId },
      include: { client: true, items: true },
    });

    // ✅ déterminer si signé via metaJson.signature
    let isSigned = false;
    try {
      const meta = JSON.parse(String((c as any)?.metaJson || "{}"));
      isSigned = Boolean(meta?.signature?.accepted && meta?.signature?.signatureDataUrl);
    } catch {
      isSigned = false;
    }

    if (!c) {
      return NextResponse.json({ error: "Dépôt-vente introuvable." }, { status: 404 });
    }

    const toEmail =
      String(c.clientEmail || "").trim() ||
      String(c.client?.email || "").trim();

    if (!toEmail) {
      return NextResponse.json(
        { error: "Email client manquant (fiche client / snapshot dépôt)." },
        { status: 400 }
      );
    }

    // PDF (signé si SIGNED)
    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

        const pdfUrl = `${origin}/api/exports/consignments/${encodeURIComponent(consignmentId)}/pdf${isSigned ? "?signed=1" : ""}`;
    const pdfResp = await fetch(pdfUrl, {
      headers: cookie ? { cookie } : undefined,
      cache: "no-store",
    });

    if (!pdfResp.ok) {
      const t = await pdfResp.text().catch(() => "");
      return NextResponse.json(
        { error: "Impossible de générer/charger le PDF dépôt-vente.", details: t.slice(0, 400) },
        { status: 500 }
      );
    }

    const pdf = Buffer.from(await pdfResp.arrayBuffer());

    const clientName = normalizeSpaces(c.clientName || c.client?.displayName || "Client");
    const subject = `Contrat de dépôt-vente — ${c.number}`;

    // Texte juridique (mail)
    const bodyText = [
      `Bonjour Madame, Monsieur,`,
      `${clientName},`,
      ``,
      `Veuillez trouver ci-joint votre contrat de dépôt-vente (référence ${c.number}).`,
      ``,
      `Rappel des obligations principales :`,
      `• Les articles listés sont confiés du ${fmtDateFR(c.depositDate)} au ${fmtDateFR(c.recoveryDate)}.`,
      `• Les articles invendus doivent être restitués à l’issue de la période, sans frais.`,
      `• Tout article perdu, manquant ou restitué abîmé sera dû au prix unitaire dépôt indiqué dans le contrat.`,
      ``,
      `Ce message vaut transmission du document contractuel. Pour toute question, vous pouvez répondre à cet email.`,
      ``,
      `Cordialement,`,
      `Xavier CUZIN`,
      `SEIKAN GALLERY`,
      `seikan.gallery@gmail.com`,
      `06 10 38 02 08`,
      ``,
    ].join("\n");

    const bodyHtml = `
<div style="font-family: Arial, Helvetica, sans-serif; font-size:14px; color:#111; line-height:1.55;">
  <div>Bonjour Madame, Monsieur,<br/><strong>${escHtml(clientName)}</strong>,</div>

  <div style="height:14px;"></div>

  <div>Veuillez trouver ci-joint votre <strong>contrat de dépôt-vente</strong> (référence <strong>${escHtml(
    c.number
  )}</strong>).</div>

  <div style="height:12px;"></div>

  <div><strong>Rappel des obligations principales :</strong></div>
  <ul style="margin:8px 0 0 18px; padding:0;">
    <li>Les articles listés sont confiés du <strong>${escHtml(
      fmtDateFR(c.depositDate)
    )}</strong> au <strong>${escHtml(fmtDateFR(c.recoveryDate))}</strong>.</li>
    <li>Les articles invendus doivent être restitués à l’issue de la période, <strong>sans frais</strong>.</li>
    <li>Tout article <strong>perdu, manquant ou restitué abîmé</strong> sera dû au <strong>prix unitaire dépôt</strong> indiqué dans le contrat.</li>
  </ul>

  <div style="height:14px;"></div>

  <div>Ce message vaut transmission du document contractuel. Pour toute question, vous pouvez répondre à cet email.</div>

  <div style="height:18px;"></div>

  <div>Cordialement,</div>
  <div>Xavier CUZIN</div>
  <div>SEIKAN GALLERY</div>
  <div>seikan.gallery@gmail.com</div>
  <div>06 10 38 02 08</div>
</div>`;

    const transporter = buildTransporter();
    await transporter.sendMail({
      from: getFromAddress(),
      to: toEmail,
      subject,
      text: bodyText,
      html: bodyHtml,
      attachments: [
        {
                    filename: `Depot-vente-${c.number}${isSigned ? "-SIGNE" : ""}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });

    // badge “envoyé le …” + compteur
    await prisma.consignment.update({
      where: { id: consignmentId },
      data: {
        emailSentAt: new Date(),
        emailSentCount: (c.emailSentCount ?? 0) + 1,
      },
    });

    // activité
    try {
      await prisma.activity.create({
        data: {
          type: "EMAIL",
          title: `Dépôt-vente envoyé au client (${c.number})`,
          body: `Envoyé à ${toEmail}`,
          clientId: c.clientId,
        },
      });
    } catch {
      // non bloquant
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Erreur envoi email dépôt-vente.", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
