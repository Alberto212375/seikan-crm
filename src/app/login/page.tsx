import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { from?: string; error?: string };
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const from = searchParams?.from;
  const callbackUrl = from && from.startsWith("/") ? from : "/dashboard";

  const error = searchParams?.error;
  const errorMessage =
    error === "credentials"
      ? "Email ou mot de passe incorrect."
      : error === "config"
      ? "Configuration d’authentification invalide."
      : null;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Connexion</h1>
        <p className="mt-2 text-zinc-600">
          Accède au CRM.{" "}
          <Link href="/" className="underline underline-offset-4">
            Retour accueil
          </Link>
        </p>

        <form
          action={login}
          className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <label className="block text-sm font-medium">Email</label>
          <input
            name="email"
            defaultValue="admin@local.test"
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
            type="email"
            autoComplete="email"
            required
          />

          <label className="mt-5 block text-sm font-medium">Mot de passe</label>
          <input
            name="password"
            defaultValue="Admin123!"
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
            type="password"
            autoComplete="current-password"
            required
          />

          {errorMessage && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Se connecter
          </button>

          <p className="mt-4 text-xs text-zinc-500">
            Redirection après connexion :{" "}
            <span className="font-medium text-zinc-700">{callbackUrl}</span>
          </p>
        </form>
      </main>
    </div>
  );
}
