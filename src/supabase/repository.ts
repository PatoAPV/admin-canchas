import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CanchaPartido,
  ColorEquipoPartido,
  EstadoApp,
  GalletaPartido,
  Jugador,
  MovimientoAbono,
  PartidoRegistrado,
  Posicion,
  ReglaEquiposSeparacion,
  ResultadoEncuentroPartido,
} from "../types";
import { recalcularSaldosJugadoresDesdeMovimientos } from "../saldos";
import { getClubId, getSupabase } from "./client";

function normDestreza(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normSaldo(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

const POS_VALIDAS: readonly Posicion[] = ["arquero", "defensa", "volante", "delantero"];

function canchaToDb(c: CanchaPartido): string {
  return c === 1 ? "1" : c === 2 ? "2" : c;
}

function canchaFromDb(s: string): CanchaPartido {
  if (s === "1") return 1;
  if (s === "2") return 2;
  if (s === "desafio-vs" || s === "desafio-futbol-11") return s;
  return 1;
}

function mapJugadorRow(r: {
  id: string;
  nombre: string;
  posiciones: string[] | null;
  destreza: number;
  saldo: number;
  es_solo_contabilidad: boolean | null;
}): Jugador {
  const posiciones = Array.isArray(r.posiciones)
    ? (r.posiciones.filter((p): p is Posicion => POS_VALIDAS.includes(p as Posicion)) as Posicion[])
    : [];
  const j: Jugador = {
    id: r.id,
    nombre: r.nombre,
    posiciones: posiciones.length ? posiciones : ["volante"],
    destreza: normDestreza(r.destreza),
    saldo: normSaldo(r.saldo),
  };
  if (r.es_solo_contabilidad) j.soloContabilidad = true;
  return j;
}

/** Carga el estado del club desde Supabase. */
export async function cargarEstadoDesdeSupabase(): Promise<EstadoApp> {
  const sb = getSupabase();
  const clubId = getClubId();

  const { data: jugRows, error: ej } = await sb
    .from("jugadores")
    .select("id,nombre,posiciones,destreza,saldo,es_solo_contabilidad")
    .eq("club_id", clubId)
    .order("nombre", { ascending: true });
  if (ej) throw new Error(ej.message);

  const { data: movRows, error: em } = await sb
    .from("movimientos_abono")
    .select("id,jugador_id,monto,fecha,nota,anulado")
    .eq("club_id", clubId)
    .order("fecha", { ascending: false });
  if (em) throw new Error(em.message);

  const { data: partRows, error: ep } = await sb
    .from("partidos")
    .select(
      `
      id,
      cancha,
      fecha,
      monto_por_jugador,
      valor_arriendo,
      resultado_encuentro,
      jugador_ids,
      partido_jugadores ( jugador_id, color_camiseta ),
      partido_galletas ( id, nombre, monto, cargo_jugador_id )
    `
    )
    .eq("club_id", clubId)
    .order("fecha", { ascending: false });
  if (ep) throw new Error(ep.message);

  const { data: regRows, error: er } = await sb
    .from("reglas_equipos_separacion")
    .select("id,jugador_a_id,jugador_b_id")
    .eq("club_id", clubId);
  if (er) throw new Error(er.message);

  const jugadores = (jugRows ?? []).map((r) =>
    mapJugadorRow(r as Parameters<typeof mapJugadorRow>[0])
  );

  const abonos: MovimientoAbono[] = (movRows ?? []).map((r) => {
    const m: MovimientoAbono = {
      id: r.id as string,
      jugadorId: r.jugador_id as string,
      monto: Math.round(Number(r.monto)),
      fecha: new Date(r.fecha as string).toISOString(),
    };
    const nota = r.nota as string | null;
    if (nota?.trim()) m.nota = nota.trim();
    if (r.anulado === true) m.anulado = true;
    return m;
  });

  const partidos: PartidoRegistrado[] = (partRows ?? []).map((raw) => {
    const p = raw as {
      id: string;
      cancha: string;
      fecha: string;
      monto_por_jugador: number;
      valor_arriendo: number;
      resultado_encuentro: string | null;
      jugador_ids: string[] | null;
      partido_jugadores: { jugador_id: string; color_camiseta: string }[] | null;
      partido_galletas: {
        id: string;
        nombre: string;
        monto: number;
        cargo_jugador_id: string;
      }[] | null;
    };
    const pj = p.partido_jugadores ?? [];
    const idsGuardados = Array.isArray(p.jugador_ids) ? p.jugador_ids : [];
    const jugadorIds =
      idsGuardados.length > 0 ? idsGuardados : pj.map((x) => x.jugador_id);
    const coloresEquipoPorJugador: Record<string, ColorEquipoPartido> = {};
    for (const row of pj) {
      if (row.color_camiseta === "rojo" || row.color_camiseta === "azul") {
        coloresEquipoPorJugador[row.jugador_id] = row.color_camiseta;
      }
    }
    const galletasRaw = p.partido_galletas ?? [];
    const galletas: GalletaPartido[] = galletasRaw.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      monto: Math.round(Number(g.monto)),
      cargoAJugadorId: g.cargo_jugador_id,
    }));

    const base: PartidoRegistrado = {
      id: p.id,
      cancha: canchaFromDb(p.cancha),
      fecha: new Date(p.fecha).toISOString(),
      jugadorIds,
      montoPorJugador: Math.round(Number(p.monto_por_jugador)),
      valorArriendo: Math.round(Number(p.valor_arriendo)),
    };
    if (galletas.length) base.galletas = galletas;
    if (Object.keys(coloresEquipoPorJugador).length) base.coloresEquipoPorJugador = coloresEquipoPorJugador;
    const res = p.resultado_encuentro;
    if (res === "rojo" || res === "azul" || res === "empate") base.resultadoEncuentro = res as ResultadoEncuentroPartido;
    return base;
  });

  const reglasEquiposSeparacion: ReglaEquiposSeparacion[] = (regRows ?? []).map((r) => ({
    id: r.id as string,
    jugadorIdA: r.jugador_a_id as string,
    jugadorIdB: r.jugador_b_id as string,
  }));

  return recalcularSaldosJugadoresDesdeMovimientos({
    jugadores,
    abonos,
    partidos,
    reglasEquiposSeparacion,
  });
}

/** Nombre del club (`clubs.nombre` para el id de `VITE_CLUB_ID`). */
export async function cargarNombreClubDesdeSupabase(): Promise<string | null> {
  const sb = getSupabase();
  const clubId = getClubId();
  const { data, error } = await sb.from("clubs").select("nombre").eq("id", clubId).maybeSingle();
  if (error) throw new Error(error.message);
  const n = data?.nombre as string | undefined;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

const CHUNK = 80;

async function insertChunked<T extends Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  rows: T[]
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).insert(slice as never);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/**
 * Reemplaza todos los datos del club en Supabase (borra e inserta).
 * Usable desde el navegador o desde scripts Node con un cliente propio.
 */
export async function escribirEstadoClubEnSupabase(
  sb: SupabaseClient,
  clubId: string,
  estado: EstadoApp
): Promise<void> {
  const { error: e1 } = await sb.from("partidos").delete().eq("club_id", clubId);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.from("movimientos_abono").delete().eq("club_id", clubId);
  if (e2) throw new Error(e2.message);
  const { error: e3 } = await sb.from("reglas_equipos_separacion").delete().eq("club_id", clubId);
  if (e3) throw new Error(e3.message);
  const { error: e4 } = await sb.from("jugadores").delete().eq("club_id", clubId);
  if (e4) throw new Error(e4.message);

  const now = new Date().toISOString();
  const jugIns = estado.jugadores.map((j) => ({
    id: j.id,
    club_id: clubId,
    nombre: j.nombre,
    posiciones: j.posiciones,
    destreza: j.destreza,
    saldo: j.saldo,
    es_solo_contabilidad: j.soloContabilidad === true,
    updated_at: now,
  }));
  await insertChunked(sb, "jugadores", jugIns);

  const movIns = estado.abonos.map((a) => ({
    id: a.id,
    club_id: clubId,
    jugador_id: a.jugadorId,
    monto: a.monto,
    fecha: a.fecha,
    nota: a.nota ?? null,
    anulado: a.anulado === true,
  }));
  await insertChunked(sb, "movimientos_abono", movIns);

  const partIns = estado.partidos.map((p) => ({
    id: p.id,
    club_id: clubId,
    cancha: canchaToDb(p.cancha),
    fecha: p.fecha,
    monto_por_jugador: p.montoPorJugador,
    valor_arriendo: p.valorArriendo,
    resultado_encuentro: p.resultadoEncuentro ?? null,
    jugador_ids: p.jugadorIds,
  }));
  await insertChunked(sb, "partidos", partIns);

  const pjRows: { partido_id: string; jugador_id: string; color_camiseta: string }[] = [];
  for (const p of estado.partidos) {
    const cols = p.coloresEquipoPorJugador;
    for (const jid of p.jugadorIds) {
      const c = cols?.[jid];
      if (c === "rojo" || c === "azul") {
        pjRows.push({ partido_id: p.id, jugador_id: jid, color_camiseta: c });
      }
    }
  }
  await insertChunked(sb, "partido_jugadores", pjRows);

  const galRows: {
    id: string;
    partido_id: string;
    nombre: string;
    monto: number;
    cargo_jugador_id: string;
  }[] = [];
  for (const p of estado.partidos) {
    for (const g of p.galletas ?? []) {
      galRows.push({
        id: g.id,
        partido_id: p.id,
        nombre: g.nombre,
        monto: g.monto,
        cargo_jugador_id: g.cargoAJugadorId,
      });
    }
  }
  await insertChunked(sb, "partido_galletas", galRows);

  const regIns = estado.reglasEquiposSeparacion.map((r) => ({
    id: r.id,
    club_id: clubId,
    jugador_a_id: r.jugadorIdA,
    jugador_b_id: r.jugadorIdB,
  }));
  await insertChunked(sb, "reglas_equipos_separacion", regIns);
}

/** Reemplaza todos los datos del club por el estado en memoria (misma idea que un JSON único). */
export async function guardarEstadoEnSupabase(estado: EstadoApp): Promise<void> {
  await escribirEstadoClubEnSupabase(getSupabase(), getClubId(), estado);
}

async function upsertChunked<T extends Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  rows: T[],
  onConflict: string
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).upsert(slice as never, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/**
 * Sincroniza sin borrar filas de `partidos` (el operador no tiene permiso DELETE en esa tabla).
 * Actualiza jugadores, partidos, hijos y reglas según el estado en memoria.
 */
export async function sincronizarEstadoOperadorEnSupabase(
  sb: SupabaseClient,
  clubId: string,
  estado: EstadoApp
): Promise<void> {
  const now = new Date().toISOString();
  const jugIns = estado.jugadores.map((j) => ({
    id: j.id,
    club_id: clubId,
    nombre: j.nombre,
    posiciones: j.posiciones,
    destreza: j.destreza,
    saldo: j.saldo,
    es_solo_contabilidad: j.soloContabilidad === true,
    updated_at: now,
  }));
  await upsertChunked(sb, "jugadores", jugIns, "id");

  const partIns = estado.partidos.map((p) => ({
    id: p.id,
    club_id: clubId,
    cancha: canchaToDb(p.cancha),
    fecha: p.fecha,
    monto_por_jugador: p.montoPorJugador,
    valor_arriendo: p.valorArriendo,
    resultado_encuentro: p.resultadoEncuentro ?? null,
    jugador_ids: p.jugadorIds,
  }));
  await upsertChunked(sb, "partidos", partIns, "id");

  for (const p of estado.partidos) {
    const { error: e1 } = await sb.from("partido_jugadores").delete().eq("partido_id", p.id);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await sb.from("partido_galletas").delete().eq("partido_id", p.id);
    if (e2) throw new Error(e2.message);
    const pjRows: { partido_id: string; jugador_id: string; color_camiseta: string }[] = [];
    const cols = p.coloresEquipoPorJugador;
    for (const jid of p.jugadorIds) {
      const c = cols?.[jid];
      if (c === "rojo" || c === "azul") {
        pjRows.push({ partido_id: p.id, jugador_id: jid, color_camiseta: c });
      }
    }
    await insertChunked(sb, "partido_jugadores", pjRows);
    const galRows = (p.galletas ?? []).map((g) => ({
      id: g.id,
      partido_id: p.id,
      nombre: g.nombre,
      monto: g.monto,
      cargo_jugador_id: g.cargoAJugadorId,
    }));
    await insertChunked(sb, "partido_galletas", galRows);
  }

  const { error: er } = await sb.from("reglas_equipos_separacion").delete().eq("club_id", clubId);
  if (er) throw new Error(er.message);
  const regIns = estado.reglasEquiposSeparacion.map((r) => ({
    id: r.id,
    club_id: clubId,
    jugador_a_id: r.jugadorIdA,
    jugador_b_id: r.jugadorIdB,
  }));
  await insertChunked(sb, "reglas_equipos_separacion", regIns);
}
