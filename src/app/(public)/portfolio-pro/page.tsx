// src/app/portfolio-pro/page.tsx

export const dynamic = "force-dynamic";

export default function PortfolioProPage() {
  return (
    <main className="min-h-screen bg-white text-black">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">

        <h1 className="text-4xl font-light tracking-wide mb-6">
          Portfolio Professionnel
        </h1>

        <p className="text-lg mb-8 leading-relaxed">
          Bienvenue dans l’univers professionnel de <strong>Seikan Gallery</strong>.
          Vous trouverez ci-dessous le portfolio complet présentant les visuels disponibles,
          le positionnement ainsi que les conditions de première commande.
          POUR COMMANDER, CLIQUEZ SUR L'ONGLET "COMMANDER" ET TAPEZ LE MOT DE PASSE :
          skgl
        </p>

        <div className="flex gap-4 mb-10">
          <a
            href="/portfolio-seikan-gallery.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-black hover:bg-black hover:text-white transition"
          >
            Voir le portfolio
          </a>

          <a
            href="/portfolio-seikan-gallery.pdf"
            download
            className="px-6 py-3 bg-black text-white hover:opacity-80 transition"
          >
            Télécharger le PDF
          </a>
        </div>

        <div className="border border-gray-200">
          <iframe
            src="/portfolio-seikan-gallery.pdf"
            className="w-full h-[900px]"
          />
        </div>

      </div>
    </main>
  );
}
