import type { Jugador, Posicion } from "./types";

/** Jugadores por equipo en el encuentro (incluye arquero). */
export type EncuentroPorEquipo = 6 | 7 | 8;

export const ENCUENTRO_OPCIONES: EncuentroPorEquipo[] = [6, 7, 8];

const INTENTOS_PARTICION = 520;
const INTENTOS_PLANTILLA_POR_PARTICION = 36;

function plural(n: number, una: string, varias: string): string {
  return n === 1 ? `1 ${una}` : `${n} ${varias}`;
}

export function describirPlantilla(slots: Posicion[]): string {
  const c: Record<Posicion, number> = { arquero: 0, defensa: 0, volante: 0, delantero: 0 };
  for (const p of slots) c[p]++;
  const partes: string[] = [];
  if (c.arquero) partes.push(plural(c.arquero, "arquero", "arqueros"));
  if (c.defensa) partes.push(plural(c.defensa, "defensa", "defensas"));
  if (c.volante) partes.push(plural(c.volante, "volante", "volantes"));
  if (c.delantero) partes.push(plural(c.delantero, "delantero", "delanteros"));
  return partes.join(", ");
}

export function describirComposicionEquipos(equipoA: LineUp[], equipoB: LineUp[]): string {
  const da = describirPlantilla(equipoA.map((l) => l.posicion));
  const db = describirPlantilla(equipoB.map((l) => l.posicion));
  if (da === db) return `${da} (ambos equipos)`;
  return `Equipo A: ${da} · Equipo B: ${db}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function poolTieneArqueroDeclarado(pool: Jugador[]): boolean {
  return pool.some((j) => j.posiciones.includes("arquero"));
}

function puedeJugarEnSlot(j: Jugador, pos: Posicion, flexArquero: boolean): boolean {
  if (flexArquero && pos === "arquero") return true;
  return j.posiciones.includes(pos);
}

function elegirConEmpate<T>(candidatos: T[], puntuacion: (c: T) => number): T {
  if (candidatos.length === 1) return candidatos[0]!;
  let mejor = puntuacion(candidatos[0]!);
  for (let i = 1; i < candidatos.length; i++) {
    mejor = Math.min(mejor, puntuacion(candidatos[i]!));
  }
  const empate = candidatos.filter((c) => puntuacion(c) === mejor);
  return empate[Math.floor(Math.random() * empate.length)]!;
}

export interface LineUp {
  jugador: Jugador;
  posicion: Posicion;
}

export function totalDestrezaEquipo(equipo: LineUp[]): number {
  return equipo.reduce((s, l) => s + l.jugador.destreza, 0);
}

export type ResultadoEquipos =
  | { ok: true; equipoA: LineUp[]; equipoB: LineUp[] }
  | { ok: false; error: string };

/** Conteos aleatorios de cupos por equipo (suman n). Arquero y delantero pueden variar mucho entre equipos. */
function conteosLineupAleatorios(n: number): { arq: number; def: number; vol: number; del: number } {
  const arq = Math.floor(Math.random() * Math.min(3, n + 1));
  let left = n - arq;
  const del = Math.floor(Math.random() * Math.min(4, left + 1));
  left -= del;
  const def = Math.floor(Math.random() * (left + 1));
  const vol = left - def;
  return { arq, def, vol, del };
}

function plantillaDesdeConteos(c: { arq: number; def: number; vol: number; del: number }): Posicion[] {
  const slots: Posicion[] = [];
  for (let i = 0; i < c.arq; i++) slots.push("arquero");
  for (let i = 0; i < c.def; i++) slots.push("defensa");
  for (let i = 0; i < c.vol; i++) slots.push("volante");
  for (let i = 0; i < c.del; i++) slots.push("delantero");
  return shuffle(slots);
}

/**
 * Dos plantillas de n cupos: defensa y volante equilibrados entre A y B (diferencia ≤ 1).
 * Arquero y delantero pueden disparar entre equipos.
 */
function generarParejaPlantillas(n: number): [Posicion[], Posicion[]] {
  for (let k = 0; k < 60; k++) {
    const ca = conteosLineupAleatorios(n);
    const cb = conteosLineupAleatorios(n);
    if (Math.abs(ca.def - cb.def) <= 1 && Math.abs(ca.vol - cb.vol) <= 1) {
      return [plantillaDesdeConteos(ca), plantillaDesdeConteos(cb)];
    }
  }
  const c = conteosLineupAleatorios(n);
  return [plantillaDesdeConteos(c), plantillaDesdeConteos(c)];
}

/**
 * Asigna jugadores del subconjunto a la plantilla (MRV + especialistas primero).
 */
function llenarUnEquipoDesdeJugadores(
  jugadores: Jugador[],
  template: Posicion[],
  flexArquero: boolean
): LineUp[] | null {
  const fullPool = jugadores;
  let pendientes = [...template];
  const line: LineUp[] = [];
  const usados = new Set<string>();
  const meta = jugadores.reduce((s, j) => s + j.destreza, 0) / 2;
  const pesoEsp = (c: Jugador) => c.posiciones.length * 200;

  while (pendientes.length > 0) {
    const porSlot = pendientes.map((pos, idx) => {
      const candidatos = fullPool.filter(
        (p) => !usados.has(p.id) && puedeJugarEnSlot(p, pos, flexArquero)
      );
      return { idx, pos, candidatos };
    });
    const sinOpcion = porSlot.find((s) => s.candidatos.length === 0);
    if (sinOpcion) return null;

    const minCand = Math.min(...porSlot.map((s) => s.candidatos.length));
    const escasos = porSlot.filter((s) => s.candidatos.length === minCand);
    const elegido = escasos[Math.floor(Math.random() * escasos.length)]!;
    const sumaActual = line.reduce((s, x) => s + x.jugador.destreza, 0);
    const pick = elegirConEmpate(
      elegido.candidatos,
      (c) => pesoEsp(c) + Math.abs(sumaActual + c.destreza - meta)
    );
    usados.add(pick.id);
    line.push({ jugador: pick, posicion: elegido.pos });
    pendientes.splice(elegido.idx, 1);
  }
  return line;
}

/** Galletas de sorteo: si hay un número par, mismo cupo en A y B; si es impar, diferencia de exactamente 1. */
function particionCumpleBalanceGalletas(
  jugA: Jugador[],
  jugB: Jugador[],
  idsGalletasSorteo: ReadonlySet<string> | undefined
): boolean {
  if (!idsGalletasSorteo || idsGalletasSorteo.size === 0) return true;
  const gA = jugA.filter((j) => idsGalletasSorteo.has(j.id)).length;
  const gB = jugB.filter((j) => idsGalletasSorteo.has(j.id)).length;
  const total = gA + gB;
  if (total === 0) return true;
  if (total % 2 === 0) return gA === gB;
  return Math.abs(gA - gB) === 1;
}

function jugadoresCumplenReglasSeparacion(
  jugA: Jugador[],
  jugB: Jugador[],
  reglas: readonly ParReglaSeparacion[]
): boolean {
  if (reglas.length === 0) return true;
  const idsA = new Set(jugA.map((j) => j.id));
  const idsB = new Set(jugB.map((j) => j.id));
  for (const r of reglas) {
    if (idsA.has(r.jugadorIdA) && idsA.has(r.jugadorIdB)) return false;
    if (idsB.has(r.jugadorIdA) && idsB.has(r.jugadorIdB)) return false;
  }
  return true;
}

function scoreEquilibrioRolesJugadores(jugA: Jugador[], jugB: Jugador[]): number {
  const defA = jugA.filter((j) => j.posiciones.includes("defensa")).length;
  const defB = jugB.filter((j) => j.posiciones.includes("defensa")).length;
  const volA = jugA.filter((j) => j.posiciones.includes("volante")).length;
  const volB = jugB.filter((j) => j.posiciones.includes("volante")).length;
  return Math.abs(defA - defB) + Math.abs(volA - volB);
}

function puntuacionBalanceDestreza(equipoA: LineUp[], equipoB: LineUp[]): number {
  return Math.abs(totalDestrezaEquipo(equipoA) - totalDestrezaEquipo(equipoB));
}

export type ParReglaSeparacion = { jugadorIdA: string; jugadorIdB: string };

export function reglasSeparacionActivasEnSeleccion(
  reglas: readonly ParReglaSeparacion[],
  idsSeleccion: Set<string>
): ParReglaSeparacion[] {
  return reglas.filter((r) => idsSeleccion.has(r.jugadorIdA) && idsSeleccion.has(r.jugadorIdB));
}

export function equiposCumplenReglasSeparacion(
  equipoA: LineUp[],
  equipoB: LineUp[],
  reglas: readonly ParReglaSeparacion[]
): boolean {
  return jugadoresCumplenReglasSeparacion(
    equipoA.map((l) => l.jugador),
    equipoB.map((l) => l.jugador),
    reglas
  );
}

export function armarEquiposAleatorio(
  jugadoresSeleccionados: Jugador[],
  jugadoresPorEquipo: EncuentroPorEquipo,
  reglasSeparacion: readonly ParReglaSeparacion[] = [],
  idsGalletasSorteo?: ReadonlySet<string>
): ResultadoEquipos {
  const n = jugadoresPorEquipo;
  const total = n * 2;
  if (jugadoresSeleccionados.length !== total) {
    return {
      ok: false,
      error: `Debes elegir exactamente ${total} jugadores (${n} vs ${n}).`,
    };
  }
  const ids = new Set(jugadoresSeleccionados.map((j) => j.id));
  if (ids.size !== jugadoresSeleccionados.length) {
    return { ok: false, error: "Hay jugadores duplicados en la selección." };
  }

  const reglasActivas = reglasSeparacionActivasEnSeleccion(reglasSeparacion, ids);
  const flexArquero = !poolTieneArqueroDeclarado(jugadoresSeleccionados);

  let intentos = INTENTOS_PARTICION;
  if (reglasActivas.length > 0) intentos = Math.floor(intentos * 1.6);
  if (idsGalletasSorteo && idsGalletasSorteo.size > 0) intentos = Math.floor(intentos * 1.45);

  let mejor: { ok: true; equipoA: LineUp[]; equipoB: LineUp[] } | null = null;
  let mejorScoreRoles = Infinity;
  let mejorBalance = Infinity;
  let ultimoError = "";

  for (let i = 0; i < intentos; i++) {
    const orden = shuffle([...jugadoresSeleccionados]);
    const jugA = orden.slice(0, n);
    const jugB = orden.slice(n, total);
    if (!particionCumpleBalanceGalletas(jugA, jugB, idsGalletasSorteo)) continue;
    if (!jugadoresCumplenReglasSeparacion(jugA, jugB, reglasActivas)) continue;

    const scoreRoles = scoreEquilibrioRolesJugadores(jugA, jugB);

    for (let t = 0; t < INTENTOS_PLANTILLA_POR_PARTICION; t++) {
      const [tplA, tplB] = generarParejaPlantillas(n);
      const lineA = llenarUnEquipoDesdeJugadores(jugA, tplA, flexArquero);
      const lineB = llenarUnEquipoDesdeJugadores(jugB, tplB, flexArquero);
      if (!lineA || !lineB) {
        ultimoError =
          "No se pudo asignar posiciones con la plantilla generada. Revisá que los jugadores cubran los roles o probá de nuevo.";
        continue;
      }
      const bal = puntuacionBalanceDestreza(lineA, lineB);
      if (
        scoreRoles < mejorScoreRoles ||
        (scoreRoles === mejorScoreRoles && bal < mejorBalance)
      ) {
        mejorScoreRoles = scoreRoles;
        mejorBalance = bal;
        mejor = { ok: true, equipoA: lineA, equipoB: lineB };
        if (scoreRoles === 0 && bal === 0) break;
      }
    }
    if (mejor && mejorScoreRoles === 0 && mejorBalance === 0) break;
  }

  if (!mejor) {
    const hint =
      reglasActivas.length > 0
        ? " Si tenés reglas de no juntar jugadores, puede que no haya reparto posible."
        : "";
    const hintGalletas =
      idsGalletasSorteo && idsGalletasSorteo.size > 0
        ? " Con galletas de sorteo, cada equipo debe llevar la misma cantidad si son pares, o diferencia de una si son impares."
        : "";
    return {
      ok: false,
      error:
        ultimoError ||
        `No se pudieron armar equipos.${hint}${hintGalletas} Probá de nuevo o revisá las posiciones de los jugadores.`,
    };
  }

  return mejor;
}

const ORDEN_POSICION_LISTA: Posicion[] = ["arquero", "defensa", "volante", "delantero"];

function indicePosicion(p: Posicion): number {
  return ORDEN_POSICION_LISTA.indexOf(p);
}

export function ordenarLineUpPorPosicion(line: LineUp[]): LineUp[] {
  return [...line].sort((a, b) => {
    const d = indicePosicion(a.posicion) - indicePosicion(b.posicion);
    if (d !== 0) return d;
    return a.jugador.nombre.localeCompare(b.jugador.nombre, "es");
  });
}

function partitionKeyEquipoA(equipoA: LineUp[]): string {
  return [...equipoA.map((l) => l.jugador.id)].sort().join(",");
}

export type ResultadoDosOpcionesEquipos =
  | { ok: false; error: string }
  | {
      ok: true;
      opcion1: { equipoA: LineUp[]; equipoB: LineUp[] };
      opcion2: { equipoA: LineUp[]; equipoB: LineUp[] };
    };

const INTENTOS_SEGUNDA_OPCION = 280;

export function armarDosOpcionesEquipos(
  jugadoresSeleccionados: Jugador[],
  jugadoresPorEquipo: EncuentroPorEquipo,
  reglasSeparacion: readonly ParReglaSeparacion[] = [],
  idsGalletasSorteo?: ReadonlySet<string>
): ResultadoDosOpcionesEquipos {
  const r1 = armarEquiposAleatorio(
    jugadoresSeleccionados,
    jugadoresPorEquipo,
    reglasSeparacion,
    idsGalletasSorteo
  );
  if (!r1.ok) return r1;
  const k1 = partitionKeyEquipoA(r1.equipoA);
  let best: { equipoA: LineUp[]; equipoB: LineUp[] } | null = null;
  let bestBal = Infinity;
  for (let i = 0; i < INTENTOS_SEGUNDA_OPCION; i++) {
    const t = armarEquiposAleatorio(
      jugadoresSeleccionados,
      jugadoresPorEquipo,
      reglasSeparacion,
      idsGalletasSorteo
    );
    if (!t.ok) continue;
    if (partitionKeyEquipoA(t.equipoA) === k1) continue;
    const bal = puntuacionBalanceDestreza(t.equipoA, t.equipoB);
    if (bal < bestBal) {
      bestBal = bal;
      best = { equipoA: t.equipoA, equipoB: t.equipoB };
      if (bal === 0) break;
    }
  }
  const opcion2 = best ?? { equipoA: r1.equipoA, equipoB: r1.equipoB };
  return {
    ok: true,
    opcion1: { equipoA: r1.equipoA, equipoB: r1.equipoB },
    opcion2,
  };
}

/** 12 jugadores mínimos para un 6vs6; calienta JIT del sorteo antes del primer uso real. */
const JUGADORES_CALENTAMIENTO_SORTEO: Jugador[] = Array.from({ length: 12 }, (_, i) => ({
  id: `__warmup-sorteo-${i}`,
  nombre: "·",
  posiciones: ["volante"],
  destreza: 5,
  saldo: 0,
}));

/** Ejecuta un sorteo completo en vacío para que el motor vaya más rápido en el primer clic del usuario. */
export function calentarMotorSorteo(): void {
  armarDosOpcionesEquipos(JUGADORES_CALENTAMIENTO_SORTEO, 6, []);
}
