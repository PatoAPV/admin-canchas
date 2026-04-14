import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured, resetSupabaseClient } from "./client";

export type AppRole = "admin" | "operador" | "lector";

let cachedRole: AppRole | null = null;
/** Parte local del email de sesión (nombre de usuario en login). */
let cachedUsuarioCabecera: string | null = null;

function setUsuarioCabeceraDesdeSesion(session: Session | null): void {
  if (!session?.user?.email) {
    cachedUsuarioCabecera = null;
    return;
  }
  const at = session.user.email.indexOf("@");
  cachedUsuarioCabecera =
    at > 0 ? session.user.email.slice(0, at) : session.user.email.trim() || null;
}

/** Texto corto para el encabezado (usuario con el que iniciaste sesión). */
export function getUsuarioCabecera(): string {
  return cachedUsuarioCabecera ?? "";
}

/** Sin Supabase se comporta como admin local. Con Supabase, el rol viene de `perfiles` tras el login. */
export function getAppRole(): AppRole | null {
  if (!isSupabaseConfigured()) return "admin";
  return cachedRole;
}

export function esAdminApp(): boolean {
  return getAppRole() === "admin";
}

export function esOperadorApp(): boolean {
  return getAppRole() === "operador";
}

export function esLectorApp(): boolean {
  return getAppRole() === "lector";
}

function normalizarRol(raw: string | undefined): AppRole | null {
  if (raw === "admin" || raw === "operador" || raw === "lector") return raw;
  return null;
}

/**
 * Lee la sesión persistida y el rol en `perfiles`.
 * Si hay sesión pero no perfil válido, cierra sesión.
 */
export async function cargarSesionYRol(): Promise<{ session: Session | null; rol: AppRole | null }> {
  if (!isSupabaseConfigured()) {
    cachedRole = "admin";
    setUsuarioCabeceraDesdeSesion(null);
    return { session: null, rol: "admin" };
  }
  const sb = getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    cachedRole = null;
    setUsuarioCabeceraDesdeSesion(null);
    return { session: null, rol: null };
  }
  const { data, error } = await sb.from("perfiles").select("rol").eq("user_id", session.user.id).maybeSingle();
  if (error || !data) {
    cachedRole = null;
    setUsuarioCabeceraDesdeSesion(null);
    await sb.auth.signOut();
    resetSupabaseClient();
    return { session: null, rol: null };
  }
  const rol = normalizarRol(data.rol as string | undefined);
  if (!rol) {
    cachedRole = null;
    setUsuarioCabeceraDesdeSesion(null);
    await sb.auth.signOut();
    resetSupabaseClient();
    return { session: null, rol: null };
  }
  cachedRole = rol;
  setUsuarioCabeceraDesdeSesion(session);
  return { session, rol };
}

/** Dominio por defecto del email sintético (`usuario@dominio`). Podés sobreescribirlo con `VITE_AUTH_EMAIL_DOMAIN`. */
const DEFAULT_AUTH_EMAIL_DOMAIN = "club.auth";

/**
 * Convierte el nombre de usuario visible en el email que Supabase Auth usa internamente.
 * Debe coincidir con el campo Email al crear el usuario en Authentication → Users.
 */
export function usuarioASintesisEmail(usuario: string): string {
  const raw = usuario.trim();
  if (!raw) throw new Error("Ingresá tu nombre de usuario.");
  const domain = (import.meta.env.VITE_AUTH_EMAIL_DOMAIN as string | undefined)?.trim() || DEFAULT_AUTH_EMAIL_DOMAIN;
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(domain) || !domain.includes(".")) {
    throw new Error(
      "VITE_AUTH_EMAIL_DOMAIN en .env tiene un formato inválido (ej. mi-club.auth). Solo letras, números, puntos y guiones."
    );
  }
  const sinAcentos = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const local = sinAcentos.replace(/[^a-z0-9._-]/g, "");
  if (!local) {
    throw new Error("El usuario solo puede tener letras, números y los símbolos . _ -");
  }
  if (local.length > 64) throw new Error("El nombre de usuario es demasiado largo.");
  return `${local}@${domain}`;
}

/** Login con nombre de usuario + contraseña (internamente se usa email sintético `usuario@VITE_AUTH_EMAIL_DOMAIN`). */
export async function iniciarSesionUsuario(usuario: string, password: string): Promise<void> {
  const email = usuarioASintesisEmail(usuario);
  const sb = getSupabase();
  const { error } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(error.message);
  const { rol } = await cargarSesionYRol();
  if (!rol) {
    throw new Error(
      "Tu usuario no tiene perfil asignado. Pedile al administrador que inserte tu cuenta en la tabla public.perfiles (rol admin, operador o lector)."
    );
  }
}

export async function cerrarSesion(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  await sb.auth.signOut();
  cachedRole = null;
  setUsuarioCabeceraDesdeSesion(null);
  resetSupabaseClient();
}

export function etiquetaRol(rol: AppRole | null): string {
  if (rol === "admin") return "Administrador";
  if (rol === "operador") return "Operador";
  if (rol === "lector") return "Solo consulta";
  return "—";
}
