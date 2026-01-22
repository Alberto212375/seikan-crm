"use client";

import { useState } from "react";

export default function SecurityClient() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    setSaving(true);

    try {
      const res = await fetch("/api/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) throw new Error(await res.text());

      setCurrentPassword("");
      setNewPassword("");
      setOk("Mot de passe mis à jour.");
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Sécurité</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Change ton mot de passe. (Recommandé après le seed admin)
      </p>

      <form
        onSubmit={submit}
        className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
      >
        <label className="block text-sm font-medium">Mot de passe actuel</label>
        <input
          className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />

        <label className="mt-4 block text-sm font-medium">Nouveau mot de passe</label>
        <input
          className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
        />

        {ok && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {ok}
          </div>
        )}
        {err && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <button
          disabled={saving}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? "Enregistrement..." : "Mettre à jour"}
        </button>
      </form>
    </div>
  );
}