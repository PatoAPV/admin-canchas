import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const clubId = import.meta.env.VITE_CLUB_ID as string | undefined;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url?.trim() && anon?.trim() && clubId?.trim());
}

export function getClubId(): string {
  if (!clubId?.trim()) throw new Error("Falta VITE_CLUB_ID");
  return clubId.trim();
}

/** Tras cerrar sesión se fuerza un cliente nuevo (evita estado mezclado). */
export function resetSupabaseClient(): void {
  client = null;
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase no está configurado (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_CLUB_ID).");
  }
  if (!client) {
    client = createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: typeof localStorage !== "undefined" ? localStorage : undefined,
      },
    });
  }
  return client;
}
