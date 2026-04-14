/**
 * Importa un JSON de respaldo o el formato de la app a Supabase (reemplaza datos del club).
 *
 * Uso:
 *   npm run import-supabase
 *   npm run import-supabase -- ruta/al/archivo.json
 *
 * Variables (en .env): SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY,
 * SUPABASE_CLUB_ID / VITE_CLUB_ID.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { escribirEstadoClubEnSupabase } from "../src/supabase/repository";
import { normalizarEstadoImportado } from "../src/storage";

function envPrimero(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v?.trim()) return v.trim();
  }
  return "";
}

config({ path: resolve(process.cwd(), ".env") });

const url = envPrimero("SUPABASE_URL", "VITE_SUPABASE_URL");
const key = envPrimero("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
const clubId = envPrimero("SUPABASE_CLUB_ID", "VITE_CLUB_ID");

if (!url || !key || !clubId) {
  console.error(
    "Faltan variables de entorno. Definí en .env:\n" +
      "  SUPABASE_URL o VITE_SUPABASE_URL\n" +
      "  SUPABASE_ANON_KEY o VITE_SUPABASE_ANON_KEY\n" +
      "  SUPABASE_CLUB_ID o VITE_CLUB_ID (UUID del club en la migración SQL)"
  );
  process.exit(1);
}

const argPath = process.argv[2];
const jsonPath = resolve(process.cwd(), argPath ?? "public/datos-canchas.json");

if (!existsSync(jsonPath)) {
  console.error(`No existe el archivo: ${jsonPath}`);
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (e) {
  console.error("No se pudo leer o parsear el JSON:", e);
  process.exit(1);
}

const estado = normalizarEstadoImportado(parsed);
if (!estado) {
  console.error('El JSON no tiene el formato esperado (falta array "jugadores" válido).');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

void (async () => {
  try {
    await escribirEstadoClubEnSupabase(sb, clubId, estado);
    console.log("Listo. Datos cargados en Supabase para el club", clubId);
    console.log(
      `  Jugadores: ${estado.jugadores.length} · Abonos: ${estado.abonos.length} · Partidos: ${estado.partidos.length} · Reglas: ${estado.reglasEquiposSeparacion.length}`
    );
  } catch (e) {
    console.error("Error al escribir en Supabase:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
