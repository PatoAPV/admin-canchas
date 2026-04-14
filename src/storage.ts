import { recalcularSaldosJugadoresDesdeMovimientos } from "./saldos";
import type {
  CanchaPartido,
  ColorEquipoPartido,
  EstadoApp,
  EstadisticaPartidosJugadorRanking,
  GalletaPartido,
  Jugador,
  MovimientoAbono,
  PartidoRegistrado,
  Posicion,
  ReglaEquiposSeparacion,
  ResultadoEncuentroPartido,
} from "./types";
import { isSupabaseConfigured } from "./supabase/client";
import { cargarEstadoDesdeSupabase, guardarEstadoEnSupabase } from "./supabase/repository";

const POS_VALIDAS: readonly Posicion[] = ["arquero", "defensa", "volante", "delantero"];

const KEY = "admin-canchas-v1";

const defaultEstado: EstadoApp = {
  jugadores: [],
  abonos: [],
  partidos: [],
  reglasEquiposSeparacion: [],
};

function ordenarParReglaIds(idA: string, idB: string): [string, string] {
  return idA.localeCompare(idB, "es") <= 0 ? [idA, idB] : [idB, idA];
}

function normalizarCanchaPartido(raw: unknown): CanchaPartido {
  if (raw === "desafio-vs" || raw === "desafio-futbol-11") return raw;
  if (raw === 2 || raw === "2") return 2;
  return 1;
}

/** Asegura destreza entre 1 y 10 (datos antiguos sin campo). */
export function normalizarDestreza(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

/** Saldo en pesos (entero); permite cero y negativos. */
export function normalizarSaldo(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** Valida y normaliza un objeto (localStorage, archivo importado o copia pegada). */
export function normalizarEstadoImportado(parsed: unknown): EstadoApp | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.jugadores)) return null;
  const jugadores: Jugador[] = [];
  for (const item of o.jugadores) {
    if (!item || typeof item !== "object") continue;
    const j = item as Record<string, unknown>;
    if (typeof j.id !== "string" || typeof j.nombre !== "string") continue;
    const posiciones: Posicion[] = Array.isArray(j.posiciones)
      ? (j.posiciones.filter((p): p is Posicion => POS_VALIDAS.includes(p as Posicion)) as Posicion[])
      : [];
    const jug: Jugador = {
      id: j.id,
      nombre: j.nombre,
      posiciones: posiciones.length ? posiciones : ["volante"],
      destreza: normalizarDestreza(j.destreza),
      saldo: normalizarSaldo(j.saldo),
    };
    if (j.soloContabilidad === true || j.esSoloContabilidad === true) jug.soloContabilidad = true;
    jugadores.push(jug);
  }
  const abonos: MovimientoAbono[] = [];
  if (Array.isArray(o.abonos)) {
    for (const item of o.abonos) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.jugadorId !== "string" || typeof r.fecha !== "string") continue;
      const monto = Math.round(Number(r.monto));
      if (!Number.isFinite(monto) || monto === 0) continue;
      const mov: MovimientoAbono = {
        id: r.id,
        jugadorId: r.jugadorId,
        monto,
        fecha: r.fecha,
      };
      if (typeof r.nota === "string" && r.nota.trim()) mov.nota = r.nota.trim();
      if (r.anulado === true) mov.anulado = true;
      abonos.push(mov);
    }
  }
  const partidos: PartidoRegistrado[] = [];
  if (Array.isArray(o.partidos)) {
    for (const item of o.partidos) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      if (typeof p.id !== "string" || typeof p.fecha !== "string" || !Array.isArray(p.jugadorIds)) continue;
      const cancha = normalizarCanchaPartido(p.cancha);
      const monto = Math.round(Number(p.montoPorJugador));
      if (!Number.isFinite(monto)) continue;
      const ids = (p.jugadorIds as unknown[]).filter((x): x is string => typeof x === "string");
      const va = Math.round(Number(p.valorArriendo));
      const galletas: GalletaPartido[] = [];
      if (Array.isArray(p.galletas)) {
        for (const gItem of p.galletas) {
          if (!gItem || typeof gItem !== "object") continue;
          const g = gItem as Record<string, unknown>;
          if (
            typeof g.id !== "string" ||
            typeof g.nombre !== "string" ||
            typeof g.cargoAJugadorId !== "string"
          )
            continue;
          const gm = Math.round(Number(g.monto));
          if (!Number.isFinite(gm) || gm <= 0) continue;
          galletas.push({
            id: g.id,
            nombre: g.nombre.trim(),
            monto: gm,
            cargoAJugadorId: g.cargoAJugadorId,
          });
        }
      }
      const base: PartidoRegistrado = {
        id: p.id,
        cancha,
        fecha: p.fecha,
        jugadorIds: ids,
        montoPorJugador: monto,
        valorArriendo: Number.isFinite(va) && va >= 0 ? va : 0,
      };
      if (galletas.length > 0) base.galletas = galletas;
      const colsRaw = p.coloresEquipoPorJugador;
      if (colsRaw && typeof colsRaw === "object" && !Array.isArray(colsRaw)) {
        const cr = colsRaw as Record<string, unknown>;
        const coloresOut: Record<string, ColorEquipoPartido> = {};
        for (const jid of ids) {
          const c = cr[jid];
          if (c === "rojo" || c === "azul") coloresOut[jid] = c;
        }
        if (Object.keys(coloresOut).length > 0) base.coloresEquipoPorJugador = coloresOut;
      }
      const resRaw = p.resultadoEncuentro;
      if (resRaw === "rojo" || resRaw === "azul" || resRaw === "empate") {
        base.resultadoEncuentro = resRaw;
      }
      partidos.push(base);
    }
  }

  let reglasEquiposSeparacion: ReglaEquiposSeparacion[] = [];
  if (Array.isArray(o.reglasEquiposSeparacion)) {
    for (const item of o.reglasEquiposSeparacion) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.jugadorIdA !== "string" || typeof r.jugadorIdB !== "string")
        continue;
      const [ja, jb] = ordenarParReglaIds(r.jugadorIdA, r.jugadorIdB);
      reglasEquiposSeparacion.push({ id: r.id, jugadorIdA: ja, jugadorIdB: jb });
    }
  }

  return recalcularSaldosJugadoresDesdeMovimientos({
    jugadores,
    abonos,
    partidos,
    reglasEquiposSeparacion,
  });
}

export function cargar(): EstadoApp {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaultEstado);
    const parsed: unknown = JSON.parse(raw);
    const n = normalizarEstadoImportado(parsed);
    return n ?? structuredClone(defaultEstado);
  } catch {
    return structuredClone(defaultEstado);
  }
}

const BACKUP_VERSION = 1;

/** JSON listo para guardar como archivo; sirve en cualquier navegador u ordenador. */
export function estadoARespaldoJson(estado: EstadoApp): string {
  const payload = {
    exportVersion: BACKUP_VERSION,
    exportado: new Date().toISOString(),
    aplicacion: "admin-canchas",
    jugadores: estado.jugadores,
    abonos: estado.abonos,
    partidos: estado.partidos,
    reglasEquiposSeparacion: estado.reglasEquiposSeparacion,
  };
  return JSON.stringify(payload, null, 2);
}

export function respaldoJsonAEstado(
  texto: string
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(texto);
  } catch {
    return { ok: false, error: "El archivo no es JSON válido." };
  }
  const n = normalizarEstadoImportado(parsed);
  if (!n) {
    return {
      ok: false,
      error: 'Formato incorrecto: debe incluir al menos un array "jugadores".',
    };
  }
  return { ok: true, estado: n };
}

/** URL del JSON versionado en el proyecto (`public/datos-canchas.json`). */
export function urlDatosCanchasJson(): string {
  const base = import.meta.env.BASE_URL || "/";
  if (base === "/" || base === "") return "/datos-canchas.json";
  return base.endsWith("/") ? `${base}datos-canchas.json` : `${base}/datos-canchas.json`;
}

const API_GUARDAR_PROYECTO = "/api/admin-canchas/save";

/** Intenta leer el archivo del proyecto al abrir la página. */
export async function tryCargarDesdeJsonProyecto(): Promise<EstadoApp | null> {
  try {
    const r = await fetch(urlDatosCanchasJson(), { cache: "no-store" });
    if (!r.ok) return null;
    const parsed: unknown = await r.json();
    return normalizarEstadoImportado(parsed);
  } catch {
    return null;
  }
}

export function estadoTieneContenido(e: EstadoApp): boolean {
  return e.jugadores.length > 0 || e.abonos.length > 0 || e.partidos.length > 0;
}

export async function guardar(estado: EstadoApp): Promise<void> {
  if (isSupabaseConfigured()) {
    /* Primero el navegador: si Supabase falla a mitad del borrado+insert, no perdés el estado al recargar. */
    try {
      localStorage.setItem(KEY, JSON.stringify(estado));
    } catch {
      /* ignorar cuota / privado */
    }
    await guardarEstadoEnSupabase(estado);
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(estado));
  void fetch(API_GUARDAR_PROYECTO, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: estadoARespaldoJson(estado),
  }).catch(() => {});
}

export type AvisoCargaInicial = { type: "ok" | "error"; text: string };

let avisoTrasCargarInicial: AvisoCargaInicial | null = null;

/** Tras `cargarInicial`, lee y borra un mensaje para el usuario (si hubo fallback o error). */
export function consumirAvisoCargaInicial(): AvisoCargaInicial | null {
  const a = avisoTrasCargarInicial;
  avisoTrasCargarInicial = null;
  return a;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Carga inicial: Supabase si está configurado; si no, localStorage y opcional JSON del proyecto. */
export async function cargarInicial(): Promise<EstadoApp> {
  avisoTrasCargarInicial = null;

  if (isSupabaseConfigured()) {
    try {
      const remoto = await cargarEstadoDesdeSupabase();
      if (estadoTieneContenido(remoto)) return remoto;

      const local = cargar();
      if (estadoTieneContenido(local)) {
        avisoTrasCargarInicial = {
          type: "ok",
          text: "En Supabase todavía no hay datos; se muestran los de este navegador. En la pestaña Respaldo usá «Actualizar datos en Supabase» para subir esta copia a la nube.",
        };
        return local;
      }

      const fromProject = await tryCargarDesdeJsonProyecto();
      if (fromProject && estadoTieneContenido(fromProject)) {
        try {
          await guardar(fromProject);
          avisoTrasCargarInicial = {
            type: "ok",
            text: "Se cargó el JSON del proyecto y se guardó en Supabase.",
          };
        } catch {
          avisoTrasCargarInicial = {
            type: "error",
            text: "Se leyó el JSON del proyecto pero no se pudo guardar en Supabase. Revisá conexión y permisos; en Respaldo probá «Actualizar datos en Supabase».",
          };
        }
        return fromProject;
      }

      avisoTrasCargarInicial = {
        type: "ok",
        text: "Supabase está vacío y no hay copia en este navegador ni datos en public/datos-canchas.json. En Respaldo podés importar un .json o subir datos con npm run import-supabase.",
      };
      return remoto;
    } catch (e) {
      const msg = errMsg(e);
      const local = cargar();
      if (estadoTieneContenido(local)) {
        avisoTrasCargarInicial = {
          type: "error",
          text: `No se pudo leer desde Supabase (${msg}). Mostrando datos de este navegador.`,
        };
        return local;
      }
      const fromProject = await tryCargarDesdeJsonProyecto();
      if (fromProject && estadoTieneContenido(fromProject)) {
        avisoTrasCargarInicial = {
          type: "error",
          text: `No se pudo leer desde Supabase (${msg}). Se muestran datos del archivo del proyecto; en Respaldo usá «Actualizar datos en Supabase» cuando la conexión funcione.`,
        };
        return fromProject;
      }
      avisoTrasCargarInicial = {
        type: "error",
        text: `No se pudo leer desde Supabase: ${msg}. Revisá .env, la clave (si falla, probá la clave anon en API Keys → Legacy) y que el SQL de migración esté ejecutado en el proyecto.`,
      };
      return structuredClone(defaultEstado);
    }
  }

  const local = cargar();
  const fromProject = await tryCargarDesdeJsonProyecto();
  if (fromProject && estadoTieneContenido(fromProject)) {
    await guardar(fromProject);
    return fromProject;
  }
  return local;
}

/** Recarga el estado desde Supabase (pestaña Informe u otras sincronizaciones). */
export async function recargarEstadoDesdeSupabase(): Promise<EstadoApp> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase no está configurado.");
  }
  return cargarEstadoDesdeSupabase();
}


export function nuevoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function agregarReglaEquiposSeparacion(
  estado: EstadoApp,
  jugadorIdA: string,
  jugadorIdB: string
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  if (jugadorIdA === jugadorIdB) return { ok: false, error: "Elegí dos jugadores distintos." };
  const ja = estado.jugadores.find((j) => j.id === jugadorIdA);
  const jb = estado.jugadores.find((j) => j.id === jugadorIdB);
  if (!ja || !jb) return { ok: false, error: "Jugador no encontrado." };
  const [a, b] = ordenarParReglaIds(jugadorIdA, jugadorIdB);
  if (estado.reglasEquiposSeparacion.some((r) => r.jugadorIdA === a && r.jugadorIdB === b)) {
    return { ok: false, error: "Esa pareja ya está en la lista." };
  }
  return {
    ok: true,
    estado: {
      ...estado,
      reglasEquiposSeparacion: [
        ...estado.reglasEquiposSeparacion,
        { id: nuevoId(), jugadorIdA: a, jugadorIdB: b },
      ],
    },
  };
}

export function quitarReglaEquiposSeparacion(estado: EstadoApp, reglaId: string): EstadoApp {
  return {
    ...estado,
    reglasEquiposSeparacion: estado.reglasEquiposSeparacion.filter((r) => r.id !== reglaId),
  };
}

export function registrarAbono(
  estado: EstadoApp,
  jugadorId: string,
  monto: number,
  nota?: string
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  const j = estado.jugadores.find((x) => x.id === jugadorId);
  if (!j) return { ok: false, error: "Jugador no encontrado." };
  const m = Math.round(monto);
  if (!Number.isFinite(m) || m === 0) return { ok: false, error: "Ingresa un monto distinto de cero (positivo abona, negativo descuenta)." };
  const mov: MovimientoAbono = {
    id: nuevoId(),
    jugadorId,
    monto: m,
    fecha: new Date().toISOString(),
    nota,
  };
  const jugadores = estado.jugadores.map((x) =>
    x.id === jugadorId ? { ...x, saldo: x.saldo + m } : x
  );
  return {
    ok: true,
    estado: { ...estado, jugadores, abonos: [mov, ...estado.abonos] },
  };
}

export function anularMovimientoAbono(
  estado: EstadoApp,
  movId: string
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  const mov = estado.abonos.find((a) => a.id === movId);
  if (!mov) return { ok: false, error: "Movimiento no encontrado." };
  if (mov.anulado) return { ok: false, error: "Este movimiento ya está anulado." };
  if (!estado.jugadores.some((x) => x.id === mov.jugadorId)) {
    return { ok: false, error: "Jugador no encontrado." };
  }
  const jugadores = estado.jugadores.map((x) =>
    x.id === mov.jugadorId ? { ...x, saldo: x.saldo - mov.monto } : x
  );
  const abonos = estado.abonos.map((a) => (a.id === movId ? { ...a, anulado: true } : a));
  return { ok: true, estado: { ...estado, jugadores, abonos } };
}

export function restaurarMovimientoAbono(
  estado: EstadoApp,
  movId: string
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  const mov = estado.abonos.find((a) => a.id === movId);
  if (!mov) return { ok: false, error: "Movimiento no encontrado." };
  if (!mov.anulado) return { ok: false, error: "Este movimiento ya está activo." };
  if (!estado.jugadores.some((x) => x.id === mov.jugadorId)) {
    return { ok: false, error: "Jugador no encontrado." };
  }
  const jugadores = estado.jugadores.map((x) =>
    x.id === mov.jugadorId ? { ...x, saldo: x.saldo + mov.monto } : x
  );
  const abonos = estado.abonos.map((a) => (a.id === movId ? { ...a, anulado: false } : a));
  return { ok: true, estado: { ...estado, jugadores, abonos } };
}

/** Victorias por jugador (solo partidos con resultado y camisetas guardadas; no cuenta empates). */
export function contarVictoriasPorJugador(estado: EstadoApp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of estado.jugadores) out[j.id] = 0;
  for (const p of estado.partidos) {
    const r = p.resultadoEncuentro;
    if (!r || r === "empate") continue;
    const cols = p.coloresEquipoPorJugador;
    if (!cols) continue;
    for (const jid of p.jugadorIds) {
      if (cols[jid] !== r) continue;
      if (Object.prototype.hasOwnProperty.call(out, jid)) out[jid] += 1;
    }
  }
  return out;
}

/**
 * Ranking de jugadores con al menos un partido que cuenta: resultado del encuentro y camiseta guardados.
 * Orden: más ganados, luego más empates; a igualdad, menos derrotas va antes.
 * No incluye jugadores sin partidos contabilizados ni IDs huérfanos en partidos.
 */
export function rankingPartidosPorJugador(estado: EstadoApp): EstadisticaPartidosJugadorRanking[] {
  const stats = new Map<string, { g: number; e: number; p: number }>();
  for (const j of estado.jugadores) {
    stats.set(j.id, { g: 0, e: 0, p: 0 });
  }
  for (const p of estado.partidos) {
    const r = p.resultadoEncuentro;
    const cols = p.coloresEquipoPorJugador;
    if (!r || !cols) continue;
    for (const jid of p.jugadorIds) {
      const color = cols[jid];
      if (color !== "rojo" && color !== "azul") continue;
      const s = stats.get(jid);
      if (!s) continue;
      if (r === "empate") {
        s.e += 1;
      } else if (r === "rojo") {
        if (color === "rojo") s.g += 1;
        else s.p += 1;
      } else if (r === "azul") {
        if (color === "azul") s.g += 1;
        else s.p += 1;
      }
    }
  }
  const rows: EstadisticaPartidosJugadorRanking[] = [];
  for (const j of estado.jugadores) {
    const s = stats.get(j.id)!;
    const total = s.g + s.e + s.p;
    if (total === 0) continue;
    rows.push({ jugadorId: j.id, ganados: s.g, empates: s.e, perdidos: s.p });
  }
  rows.sort((a, b) => {
    if (b.ganados !== a.ganados) return b.ganados - a.ganados;
    if (b.empates !== a.empates) return b.empates - a.empates;
    return a.perdidos - b.perdidos;
  });
  return rows;
}

export function registrarPartido(
  estado: EstadoApp,
  cancha: CanchaPartido,
  jugadorIds: string[],
  fechaIso: string,
  montoPorJugador: number,
  valorArriendo: number,
  galletas: GalletaPartido[] = [],
  coloresPorJugador?: Record<string, ColorEquipoPartido>,
  resultadoEncuentro?: ResultadoEncuentroPartido | null
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  const monto = Math.round(montoPorJugador);
  const arriendo = Math.round(valorArriendo);
  if (!Number.isFinite(arriendo) || arriendo < 0) {
    return { ok: false, error: "Ingresa un valor de arriendo de cancha válido (cero o mayor)." };
  }
  const ids = [...new Set(jugadorIds)];
  if (ids.length > 0) {
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: "Con jugadores marcados, ingresá un monto por jugador mayor a cero." };
    }
  } else if (!Number.isFinite(monto) || monto < 0) {
    return {
      ok: false,
      error: "Sin jugadores, el monto por jugador puede ser cero (definilo al agregar jugadores) o un valor positivo.",
    };
  }
  for (const id of ids) {
    const j = estado.jugadores.find((x) => x.id === id);
    if (!j) return { ok: false, error: "Jugador no encontrado." };
  }
  const galletasNorm: GalletaPartido[] = [];
  for (const g of galletas) {
    const nombre = (g.nombre ?? "").trim();
    const gm = Math.round(Number(g.monto));
    if (!nombre) return { ok: false, error: "Cada galleta marcada necesita un nombre." };
    if (!Number.isFinite(gm) || gm <= 0) return { ok: false, error: `Monto inválido para la galleta «${nombre}».` };
    const pj = estado.jugadores.find((x) => x.id === g.cargoAJugadorId);
    if (!pj) return { ok: false, error: `Jugador que paga no encontrado (galleta «${nombre}»).` };
    galletasNorm.push({
      id: g.id || nuevoId(),
      nombre,
      monto: gm,
      cargoAJugadorId: g.cargoAJugadorId,
    });
  }
  let coloresFinal: Record<string, ColorEquipoPartido> | undefined;
  if (ids.length > 0) {
    if (!coloresPorJugador) {
      return { ok: false, error: "Indicá la camiseta (rojo o azul) de cada jugador de la lista." };
    }
    coloresFinal = {};
    for (const id of ids) {
      const c = coloresPorJugador[id];
      if (c !== "rojo" && c !== "azul") {
        return { ok: false, error: "Cada jugador marcado debe tener camiseta roja o azul." };
      }
      coloresFinal[id] = c;
    }
  }

  const partido: PartidoRegistrado = {
    id: nuevoId(),
    cancha,
    fecha: fechaIso,
    jugadorIds: ids,
    montoPorJugador: monto,
    valorArriendo: arriendo,
  };
  if (galletasNorm.length > 0) partido.galletas = galletasNorm;
  if (coloresFinal && Object.keys(coloresFinal).length > 0) {
    partido.coloresEquipoPorJugador = coloresFinal;
  }
  if (resultadoEncuentro === "rojo" || resultadoEncuentro === "azul" || resultadoEncuentro === "empate") {
    partido.resultadoEncuentro = resultadoEncuentro;
  }

  let jugadores = estado.jugadores;
  if (ids.length > 0) {
    jugadores = jugadores.map((j) =>
      ids.includes(j.id) ? { ...j, saldo: j.saldo - monto } : j
    );
  }
  for (const g of galletasNorm) {
    jugadores = jugadores.map((j) =>
      j.id === g.cargoAJugadorId ? { ...j, saldo: j.saldo - g.monto } : j
    );
  }
  return {
    ok: true,
    estado: { ...estado, jugadores, partidos: [partido, ...estado.partidos] },
  };
}

export function agregarJugador(
  estado: EstadoApp,
  nombre: string,
  posiciones: Jugador["posiciones"],
  destreza: number
): EstadoApp {
  const jugador: Jugador = {
    id: nuevoId(),
    nombre: nombre.trim(),
    posiciones: posiciones.length ? posiciones : ["volante"],
    destreza: normalizarDestreza(destreza),
    saldo: 0,
  };
  return { ...estado, jugadores: [...estado.jugadores, jugador] };
}

export function actualizarJugador(
  estado: EstadoApp,
  id: string,
  patch: Partial<Pick<Jugador, "nombre" | "posiciones" | "destreza" | "saldo">>
): EstadoApp {
  return {
    ...estado,
    jugadores: estado.jugadores.map((j) => {
      if (j.id !== id) return j;
      const updated = { ...j, ...patch };
      if (patch.destreza !== undefined) updated.destreza = normalizarDestreza(patch.destreza);
      if (patch.saldo !== undefined) updated.saldo = normalizarSaldo(patch.saldo);
      return updated;
    }),
  };
}

export function eliminarJugador(estado: EstadoApp, id: string): EstadoApp {
  return {
    ...estado,
    jugadores: estado.jugadores.filter((j) => j.id !== id),
    reglasEquiposSeparacion: estado.reglasEquiposSeparacion.filter(
      (r) => r.jugadorIdA !== id && r.jugadorIdB !== id
    ),
  };
}

/** Quita el partido y devuelve a cada jugador aún en lista el monto descontado en ese partido. */
/**
 * Solo si el partido no tiene jugadores: asigna la lista y descuenta `montoPorJugador` a cada uno.
 */
export function agregarJugadoresAPartido(
  estado: EstadoApp,
  partidoId: string,
  nuevosJugadorIds: string[],
  montoPorJugadorExplicito?: number,
  coloresPorJugador?: Record<string, ColorEquipoPartido>,
  resultadoEncuentro?: ResultadoEncuentroPartido | null
): { ok: true; estado: EstadoApp } | { ok: false; error: string } {
  const p = estado.partidos.find((x) => x.id === partidoId);
  if (!p) return { ok: false, error: "Partido no encontrado." };
  if (p.jugadorIds.length > 0) {
    return {
      ok: false,
      error: "Este partido ya tiene jugadores. Solo podés agregar cuando el partido está sin jugadores (solo arriendo).",
    };
  }
  const ids = [...new Set(nuevosJugadorIds)];
  if (ids.length === 0) return { ok: false, error: "Seleccioná al menos un jugador." };
  for (const id of ids) {
    const j = estado.jugadores.find((x) => x.id === id);
    if (!j) return { ok: false, error: "Jugador no encontrado." };
  }
  let monto = p.montoPorJugador;
  if (p.montoPorJugador <= 0 && montoPorJugadorExplicito !== undefined) {
    const me = Math.round(montoPorJugadorExplicito);
    if (Number.isFinite(me) && me > 0) monto = me;
  }
  if (monto <= 0) {
    return {
      ok: false,
      error: "Indicá un monto por jugador mayor a cero (en el formulario de abajo).",
    };
  }
  if (!coloresPorJugador) {
    return { ok: false, error: "Indicá la camiseta (rojo o azul) de cada jugador." };
  }
  const coloresFinal: Record<string, ColorEquipoPartido> = {};
  for (const id of ids) {
    const c = coloresPorJugador[id];
    if (c !== "rojo" && c !== "azul") {
      return { ok: false, error: "Cada jugador debe tener camiseta roja o azul." };
    }
    coloresFinal[id] = c;
  }

  const jugadores = estado.jugadores.map((j) =>
    ids.includes(j.id) ? { ...j, saldo: j.saldo - monto } : j
  );
  const partidos = estado.partidos.map((x) => {
    if (x.id !== partidoId) return x;
    const next: PartidoRegistrado = {
      ...x,
      jugadorIds: ids,
      montoPorJugador: monto,
      coloresEquipoPorJugador: coloresFinal,
    };
    if (resultadoEncuentro === "rojo" || resultadoEncuentro === "azul" || resultadoEncuentro === "empate") {
      next.resultadoEncuentro = resultadoEncuentro;
    }
    return next;
  });
  return { ok: true, estado: { ...estado, jugadores, partidos } };
}

export function eliminarPartido(estado: EstadoApp, partidoId: string): EstadoApp {
  const p = estado.partidos.find((x) => x.id === partidoId);
  if (!p) return estado;
  const monto = p.montoPorJugador;
  const ids = new Set(p.jugadorIds);
  let jugadores = estado.jugadores.map((j) =>
    ids.has(j.id) ? { ...j, saldo: j.saldo + monto } : j
  );
  for (const g of p.galletas ?? []) {
    jugadores = jugadores.map((j) =>
      j.id === g.cargoAJugadorId ? { ...j, saldo: j.saldo + g.monto } : j
    );
  }
  return {
    ...estado,
    jugadores,
    partidos: estado.partidos.filter((x) => x.id !== partidoId),
  };
}
