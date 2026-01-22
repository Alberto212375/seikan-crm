"use client";

import { useEffect, useState } from "react";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
  createdAt: string;
};

export default function UsersClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [creating, setCreating] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, role }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEmail("");
      setName("");
      setPassword("");
      setRole("USER");
      setOk("Utilisateur créé.");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Erreur");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Utilisateurs</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Création et gestion des comptes (réservé Admin).
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <form
          onSubmit={createUser}
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-sm font-semibold">Créer un utilisateur</h2>

          <label className="mt-4 block text-sm font-medium">Email</label>
          <input
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />

          <label className="mt-4 block text-sm font-medium">
            Nom (optionnel)
          </label>
          <input
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
          />

          <label className="mt-4 block text-sm font-medium">Mot de passe</label>
          <input
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />

          <label className="mt-4 block text-sm font-medium">Rôle</label>
          <select
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
            value={role}
            onChange={(e) => setRole(e.target.value === "ADMIN" ? "ADMIN" : "USER")}
          >
            <option value="USER">Utilisateur</option>
            <option value="ADMIN">Admin</option>
          </select>

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
            disabled={creating}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {creating ? "Création..." : "Créer"}
          </button>
        </form>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Liste</h2>

          {loading ? (
            <p className="mt-3 text-sm text-zinc-600">Chargement…</p>
          ) : (
            <div className="mt-3 space-y-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{u.email}</div>
                    <div className="text-xs text-zinc-500">
                      {u.name ?? "—"} · {u.role}
                    </div>
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-sm text-zinc-600">Aucun utilisateur.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
