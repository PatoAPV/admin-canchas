import type { EstadoApp, PartidoRegistrado } from "./types";

/** Total descontado a un jugador en un partido (cuota en lista + galletas a su cargo). */
export function descuentoPartidoSobreJugador(p: PartidoRegistrado, jugadorId: string): number {
  let d = 0;
  if (p.jugadorIds.includes(jugadorId)) d += p.montoPorJugador;
  for (const g of p.galletas ?? []) {
    if (g.cargoAJugadorId === jugadorId) d += g.monto;
  }
  return d;
}

/**
 * Deja `jugador.saldo` = Σ abonos (no anulados) − Σ cargos por partidos.
 * Corrige fichas desalineadas respecto al historial (importes, respaldos, datos viejos).
 */
export function recalcularSaldosJugadoresDesdeMovimientos(estado: EstadoApp): EstadoApp {
  const jugadores = estado.jugadores.map((j) => {
    let saldo = 0;
    for (const m of estado.abonos) {
      if (m.jugadorId !== j.id || m.anulado === true) continue;
      saldo += m.monto;
    }
    for (const p of estado.partidos) {
      saldo -= descuentoPartidoSobreJugador(p, j.id);
    }
    return { ...j, saldo };
  });
  return { ...estado, jugadores };
}
