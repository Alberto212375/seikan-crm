"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Prospect = {
  id: string;
  societe: string;
  contact: string;
  service: string;
  email: string;
  telephone: string;
  adresse: string;
  demarcheLe: string; // yyyy-mm-dd
  methode: { physique: boolean; appel: boolean; mail: boolean };
  createdAt: string; // ISO
};

export type Client = {
  id: string;
  societe: string;
  contact: string;
  service: string;
  email: string;
  telephone: string;
  adresse: string;
  clientDepuisLe: string; // yyyy-mm-dd
  notes: string; // libre (max 250 mots)
  createdAt: string; // ISO
};

type Store = {
  prospects: Prospect[];
  clients: Client[];
  addProspect(): void;
  updateProspect(id: string, patch: Partial<Prospect>): void;
  deleteProspect(id: string): void;
  convertProspectToClient(id: string): void;

  updateClient(id: string, patch: Partial<Client>): void;
  deleteClient(id: string): void;
};

const LS_KEY = "hcf_crm_store_v1";

const Ctx = createContext<Store | null>(null);

function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clampNotesTo250Words(s: string) {
  const words = s
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length <= 250) return s;

  return words.slice(0, 250).join(" ") + " ";
}

export function CrmStoreProvider({ children }: { children: React.ReactNode }) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  // Hydrate depuis localStorage
  useEffect(() => {
    const parsed = safeParse<{ prospects: Prospect[]; clients: Client[] }>(
      typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null
    );
    if (parsed) {
      setProspects(Array.isArray(parsed.prospects) ? parsed.prospects : []);
      setClients(Array.isArray(parsed.clients) ? parsed.clients : []);
    }
  }, []);

  // Persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({ prospects, clients })
    );
  }, [prospects, clients]);

  const api = useMemo<Store>(() => {
    return {
      prospects,
      clients,

      addProspect() {
        const now = new Date().toISOString();
        setProspects((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            societe: "",
            contact: "",
            service: "",
            email: "",
            telephone: "",
            adresse: "",
            demarcheLe: "",
            methode: { physique: false, appel: false, mail: false },
            createdAt: now,
          },
        ]);
      },

      updateProspect(id, patch) {
        setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      },

      deleteProspect(id) {
        setProspects((prev) => prev.filter((p) => p.id !== id));
      },

      convertProspectToClient(id) {
        setProspects((prev) => {
          const p = prev.find((x) => x.id === id);
          if (!p) return prev;

          const now = new Date().toISOString();

          setClients((cprev) => [
            ...cprev,
            {
              id: crypto.randomUUID(),
              societe: p.societe,
              contact: p.contact,
              service: p.service,
              email: p.email,
              telephone: p.telephone,
              adresse: p.adresse,
              clientDepuisLe: todayYmd(),
              notes: "",
              createdAt: now,
            },
          ]);

          // disparaît de Prospects
          return prev.filter((x) => x.id !== id);
        });
      },

      updateClient(id, patch) {
        setClients((prev) =>
          prev.map((c) => {
            if (c.id !== id) return c;
            const next: Client = { ...c, ...patch };
            if (typeof next.notes === "string") next.notes = clampNotesTo250Words(next.notes);
            return next;
          })
        );
      },

      deleteClient(id) {
        setClients((prev) => prev.filter((c) => c.id !== id));
      },
    };
  }, [prospects, clients]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCrmStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCrmStore must be used within CrmStoreProvider");
  return v;
}
