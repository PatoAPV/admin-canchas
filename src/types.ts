export type Posicion = "arquero" | "defensa" | "volante" | "delantero";

export interface Jugador {
  id: string;
  nombre: string;
  posiciones: Posicion[];
  /** Nivel de destreza de 1 a 10 (para equilibrar equipos al sortear). */
  destreza: number;
  saldo: number;
  /** Ficha solo contable (no aparece en partidos/equipos). Viene de BD o respaldo. */
  soloContabilidad?: boolean;
}

export interface MovimientoAbono {
  id: string;
  jugadorId: string;
  monto: number;
  fecha: string;
  nota?: string;
  /** Si es true, el movimiento no suma en informes y su efecto en el saldo fue revertido. */
  anulado?: boolean;
}

/** Invitado sin ficha: cuenta en el partido; el monto se descuenta al jugador asignado. */
export interface GalletaPartido {
  id: string;
  nombre: string;
  monto: number;
  cargoAJugadorId: string;
}

/** Lugar / modalidad del partido (1 y 2 conservan datos históricos en JSON). */
export type CanchaPartido = 1 | 2 | "desafio-vs" | "desafio-futbol-11";

/** Camiseta del equipo en el partido (misma convención que la pestaña Equipos). */
export type ColorEquipoPartido = "rojo" | "azul";

/** Resultado del encuentro por color de camiseta. */
export type ResultadoEncuentroPartido = "rojo" | "azul" | "empate";

export interface PartidoRegistrado {
  id: string;
  cancha: CanchaPartido;
  fecha: string;
  jugadorIds: string[];
  montoPorJugador: number;
  /** Costo de arriendo de la cancha ese día (registrado con el partido). */
  valorArriendo: number;
  /** Opcional; ausente en datos antiguos. */
  galletas?: GalletaPartido[];
  /** Por jugador de la lista: en qué equipo jugó. Ausente en datos antiguos. */
  coloresEquipoPorJugador?: Record<string, ColorEquipoPartido>;
  /** Ganador del encuentro (por color). Ausente si no se registró. */
  resultadoEncuentro?: ResultadoEncuentroPartido;
}

/** Conteos por jugador para el ranking de partidos (resultado + camiseta registrados). */
export interface EstadisticaPartidosJugadorRanking {
  jugadorId: string;
  ganados: number;
  empates: number;
  perdidos: number;
}

/** Dos jugadores que no pueden quedar en el mismo equipo al sortear. */
export interface ReglaEquiposSeparacion {
  id: string;
  jugadorIdA: string;
  jugadorIdB: string;
}

export interface EstadoApp {
  jugadores: Jugador[];
  abonos: MovimientoAbono[];
  partidos: PartidoRegistrado[];
  /** Pares que no deben compartir equipo (se aplican solo si ambos están en la selección del sorteo). */
  reglasEquiposSeparacion: ReglaEquiposSeparacion[];
}
