import "./styles.css";
import {
  cargarSesionYRol,
  cerrarSesion,
  esAdminApp,
  esLectorApp,
  esOperadorApp,
  getUsuarioCabecera,
  iniciarSesionUsuario,
} from "./supabase/auth";
import { getSupabase, isSupabaseConfigured } from "./supabase/client";
import { cargarNombreClubDesdeSupabase } from "./supabase/repository";
import {
  agregarJugador,
  agregarReglaEquiposSeparacion,
  actualizarJugador,
  cargarInicial,
  consumirAvisoCargaInicial,
  contarVictoriasPorJugador,
  eliminarJugador,
  agregarJugadoresAPartido,
  anularMovimientoAbono,
  eliminarPartido,
  estadoARespaldoJson,
  estadoTieneContenido,
  guardar,
  nuevoId,
  normalizarDestreza,
  normalizarSaldo,
  quitarReglaEquiposSeparacion,
  recargarEstadoDesdeSupabase,
  registrarAbono,
  rankingPartidosPorJugador,
  registrarPartido,
  restaurarMovimientoAbono,
  respaldoJsonAEstado,
  tryCargarDesdeJsonProyecto,
} from "./storage";
import {
  ENCUENTRO_OPCIONES,
  armarDosOpcionesEquipos,
  calentarMotorSorteo,
  describirComposicionEquipos,
  ordenarLineUpPorPosicion,
  totalDestrezaEquipo,
  type EncuentroPorEquipo,
  type LineUp,
} from "./teams";
import { descuentoPartidoSobreJugador } from "./saldos";
import type {
  CanchaPartido,
  ColorEquipoPartido,
  EstadoApp,
  GalletaPartido,
  Jugador,
  PartidoRegistrado,
  Posicion,
  ResultadoEncuentroPartido,
} from "./types";

const POSICIONES: Posicion[] = ["arquero", "defensa", "volante", "delantero"];
const POS_LABEL: Record<Posicion, string> = {
  arquero: "Arquero",
  defensa: "Defensa",
  volante: "Volante",
  delantero: "Delantero",
};

type TabPrincipal =
  | "jugadores"
  | "abonos"
  | "partidos"
  | "equipos"
  | "informe"
  | "informe-partidos"
  | "respaldo";

const TODAS_LAS_TABS: TabPrincipal[] = [
  "jugadores",
  "abonos",
  "partidos",
  "equipos",
  "informe",
  "informe-partidos",
  "respaldo",
];

function tabsVisibles(): TabPrincipal[] {
  return TODAS_LAS_TABS;
}

/** Admin: siempre. Operador: solo en Partidos y Equipos. Lector: nunca. Sin Supabase: sí (modo local). */
function puedeEscribirEnPestanaActual(): boolean {
  if (!isSupabaseConfigured()) return true;
  if (esLectorApp()) return false;
  if (esAdminApp()) return true;
  if (esOperadorApp()) return tab === "partidos" || tab === "equipos";
  return false;
}

/** Sorteo de equipos: lector y modo local pueden; admin/operador en pestaña Equipos también. */
function puedeInteractuarSorteoEquipos(): boolean {
  if (!isSupabaseConfigured()) return true;
  if (esLectorApp()) return true;
  return puedeEscribirEnPestanaActual();
}

function asegurarTabPermitida(): void {
  const v = tabsVisibles();
  if (!v.includes(tab as TabPrincipal)) {
    tab = v[0] ?? "jugadores";
  }
}

function soloLectura(): boolean {
  return isSupabaseConfigured() && esLectorApp();
}

function puedeBorrarPartido(): boolean {
  return !isSupabaseConfigured() || esAdminApp();
}

function puedeEditarRespaldoCompleto(): boolean {
  return !isSupabaseConfigured() || esAdminApp();
}

/** Cuenta ficticia (abonos/ajustes): no se lista en Partidos ni Equipos. */
const NOMBRE_JUGADOR_SOLO_CONTABILIDAD = "Z-Otros Ingresos/Egresos";

function esJugadorSoloContabilidad(j: Jugador): boolean {
  if (j.soloContabilidad === true) return true;
  return j.nombre.trim().toLowerCase() === NOMBRE_JUGADOR_SOLO_CONTABILIDAD.toLowerCase();
}

function jugadoresPartidosYEquipos(lista: Jugador[]): Jugador[] {
  return lista.filter((j) => !esJugadorSoloContabilidad(j));
}

/** Al agregar una galleta, «Carga a» usa a «Pato» si existe en la lista; si no, el primero. */
function idJugadorGalletaNuevaDefecto(jugadoresEnLista: Jugador[]): string {
  const pato = jugadoresEnLista.find((j) => j.nombre.trim().toLowerCase() === "pato");
  return pato?.id ?? jugadoresEnLista[0]!.id;
}

/** URL del cursor (public/soccer-cursor.svg); absoluta para que el navegador lo cargue bien. */
function urlCursorBalonSoccer(): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${prefix}soccer-cursor.svg`, document.baseURI).href;
}

/** Logo del encabezado: `public/logo.png` o `VITE_APP_LOGO` (solo nombre de archivo seguro). */
function urlLogoCabecera(): string {
  let name = (import.meta.env.VITE_APP_LOGO as string | undefined)?.trim() || "logo.png";
  if (!/^[\w.-]+$/.test(name)) name = "logo.png";
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${prefix}${name}`, document.baseURI).href;
}

const THEME_STORAGE_KEY = "admin-canchas-theme";

function temaDesdeUrl(): "default" | "futbol" | null {
  const u = new URLSearchParams(location.search).get("tema");
  if (u === "cancha") return "futbol";
  if (u === "clasico") return "default";
  return null;
}

/** Predeterminado del proyecto: cancha (verde). Solo si guardaste «clásico» queda el tema azul. */
function temaGuardadoEnNavegador(): "default" | "futbol" {
  return localStorage.getItem(THEME_STORAGE_KEY) === "clasico" ? "default" : "futbol";
}

function temaEfectivo(): "default" | "futbol" {
  return temaDesdeUrl() ?? temaGuardadoEnNavegador();
}

function aplicarTemaVisual(t: "default" | "futbol"): void {
  if (t === "futbol") document.documentElement.setAttribute("data-theme", "futbol");
  else document.documentElement.removeAttribute("data-theme");
}

function inicializarTemaDesdeUrlYLocalStorage(): void {
  aplicarTemaVisual(temaEfectivo());
}

/** Quita `?tema=` de la URL y persiste clásico o cancha en localStorage. */
function guardarTemaPreferido(t: "default" | "futbol"): void {
  if (t === "futbol") localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, "clasico");
  aplicarTemaVisual(t);
  const url = new URL(location.href);
  url.searchParams.delete("tema");
  const q = url.searchParams.toString();
  history.replaceState({}, "", url.pathname + (q ? `?${q}` : "") + url.hash);
}

/** Muestra el cursor de balón y deja pintar un frame antes del trabajo síncrono del sorteo. */
function withFutbolWaitCursor(run: () => void): void {
  const html = document.documentElement;
  const cursorVal = `url("${urlCursorBalonSoccer()}") 32 32, wait`;
  html.classList.add("equipos-sorteando");
  html.style.setProperty("--equipos-cursor-futbol", cursorVal);
  requestAnimationFrame(() => {
    try {
      run();
    } finally {
      html.classList.remove("equipos-sorteando");
      html.style.removeProperty("--equipos-cursor-futbol");
    }
  });
}

let estado: EstadoApp = {
  jugadores: [],
  abonos: [],
  partidos: [],
  reglasEquiposSeparacion: [],
};
let tab: TabPrincipal = "jugadores";
let mensaje: { type: "ok" | "error"; text: string } | null = null;
/** Con Supabase: nombre de `clubs.nombre` para mostrar sobre el título. */
let nombreClubCabecera: string | null = null;
let editandoId: string | null = null;
type CamisetaEquipo = "rojo" | "azul";

interface VistaDosOpcionesEquipos {
  opcion1: { equipoA: LineUp[]; equipoB: LineUp[] };
  opcion2: { equipoA: LineUp[]; equipoB: LineUp[] };
  /** Color de camiseta asignado al equipo A en cada opción (B recibe el otro). */
  camisetaAOp1: CamisetaEquipo;
  camisetaAOp2: CamisetaEquipo;
}

let ultimoEquipos: VistaDosOpcionesEquipos | null = null;
/** Tamaño del encuentro elegido al armar equipos (jugadores por equipo). */
let encuentroPorEquipo: EncuentroPorEquipo = 6;
/** Conserva los checks al cambiar 6v6 / 7v7 / etc. */
let equiposSeleccionCache: string[] = [];
/** Fichas solo para el sorteo en Equipos (no se guardan como jugadores). Volante, destreza 5. */
let equiposGalletasSorteo: { id: string; nombre: string }[] = [];
/** Evita repetir el calentamiento JIT del sorteo de equipos. */
let equiposSorteoWarmupListo = false;

function jugadorSintesisGalletaSorteo(g: { id: string; nombre: string }): Jugador {
  return {
    id: g.id,
    nombre: g.nombre,
    posiciones: ["volante"],
    destreza: 5,
    saldo: 0,
  };
}

function jugadoresSeleccionadosParaSorteo(ids: string[]): Jugador[] {
  return ids
    .map((id) => {
      const g = equiposGalletasSorteo.find((x) => x.id === id);
      if (g) return jugadorSintesisGalletaSorteo(g);
      const j = estado.jugadores.find((jj) => jj.id === id);
      if (!j || esJugadorSoloContabilidad(j)) return undefined;
      return j;
    })
    .filter((j): j is Jugador => j !== undefined);
}

function intentarCalentarMotorEquipos(): void {
  if (equiposSorteoWarmupListo) return;
  equiposSorteoWarmupListo = true;
  try {
    calentarMotorSorteo();
  } catch {
    equiposSorteoWarmupListo = false;
  }
}

function programarCalentamientoSorteoEquiposIdle(): void {
  const run = (): void => {
    intentarCalentarMotorEquipos();
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run, { timeout: 900 });
  } else {
    setTimeout(run, 400);
  }
}
/** Orden del listado en la pestaña Jugadores (por defecto: nombre). */
let ordenJugadoresCampo: "nombre" | "saldo" = "nombre";
let ordenJugadoresDir: "asc" | "desc" = "asc";
/** Si está definido, se muestra el diálogo de confirmación para eliminar ese jugador. */
let eliminarJugadorPendienteId: string | null = null;
let eliminarPartidoPendienteId: string | null = null;
/** Partido sin jugadores: modal para asignar jugadores y descontar. */
let agregarJugadoresPartidoId: string | null = null;
/** Informe: ciclo al pulsar # — 0 nombre A→Z, 1 Z→A, 2 saldo ↑, 3 saldo ↓. */
let informeOrdenPaso = 0;
/** Archivo .json leído listo para confirmar restauración (reemplaza todo el estado). */
let respaldoPendiente: { nombre: string; estado: EstadoApp } | null = null;
/** Respaldo: botón «Actualizar Supabase» en curso. */
let subiendoSupabaseDesdeRespaldo = false;
/** Abonos: jugador elegido en «Cuadratura por jugador». */
let cuadraturaJugadorSeleccionId: string | null = null;

/** Filas de galletas en el formulario de partido (persiste entre re-render en la misma pestaña). */
interface PartidoGalletaBorrador {
  id: string;
  incluida: boolean;
  nombre: string;
  monto: string;
  cargoAJugadorId: string;
}
let partidoGalletasBorrador: PartidoGalletaBorrador[] = [];

/** Campos del formulario de partido (fecha en adelante) para no perderlos al re-renderizar (ej. al agregar galleta). */
interface PartidoFormBorrador {
  fechaD: string;
  hora: string;
  cancha: string;
  montoPartido: string;
  valorArriendo: string;
  jugadorIds: string[];
  coloresPorJugador: Record<string, ColorEquipoPartido>;
  resultadoEncuentro: string;
}
let partidoFormBorrador: PartidoFormBorrador | null = null;

function canchaPartidoFormValueValid(v: string): boolean {
  return v === "1" || v === "2" || v === "desafio-vs" || v === "desafio-futbol-11";
}

function syncPartidoFormBorradorDesdeDom(form: HTMLFormElement): void {
  const fechaD = form.querySelector<HTMLInputElement>('input[name="fecha-d"]')?.value ?? "";
  const hora = form.querySelector<HTMLInputElement>('input[name="hora"]')?.value ?? "";
  const cancha = form.querySelector<HTMLSelectElement>('select[name="cancha"]')?.value ?? "1";
  const montoPartido = form.querySelector<HTMLInputElement>('input[name="montoPartido"]')?.value ?? "";
  const valorArriendo = form.querySelector<HTMLInputElement>('input[name="valorArriendo"]')?.value ?? "";
  const jugadorIds = [...form.querySelectorAll<HTMLInputElement>('input[name="pj"]:checked')].map((c) => c.value);
  const coloresPorJugador: Record<string, ColorEquipoPartido> = {
    ...(partidoFormBorrador?.coloresPorJugador ?? {}),
  };
  form.querySelectorAll<HTMLSelectElement>("select[data-pj-color-id]").forEach((sel) => {
    const jid = sel.dataset.pjColorId;
    if (!jid) return;
    const v = sel.value;
    if (v === "rojo" || v === "azul") coloresPorJugador[jid] = v;
  });
  const resultadoEncuentro =
    form.querySelector<HTMLSelectElement>('select[name="resultadoEncuentro"]')?.value ?? "";
  partidoFormBorrador = {
    fechaD,
    hora,
    cancha,
    montoPartido,
    valorArriendo,
    jugadorIds,
    coloresPorJugador,
    resultadoEncuentro,
  };
}

function syncPartidoGalletasBorradorDesdeDom(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>("[data-galleta-id]").forEach((row) => {
    const id = row.dataset.galletaId;
    if (!id) return;
    const b = partidoGalletasBorrador.find((x) => x.id === id);
    if (!b) return;
    const incl = row.querySelector<HTMLInputElement>(".galleta-incluir");
    const nom = row.querySelector<HTMLInputElement>(".galleta-nombre");
    const mon = row.querySelector<HTMLInputElement>(".galleta-monto");
    const paga = row.querySelector<HTMLSelectElement>(".galleta-paga");
    if (incl) b.incluida = incl.checked;
    if (nom) b.nombre = nom.value;
    if (mon) b.monto = mon.value;
    if (paga) b.cargoAJugadorId = paga.value;
  });
}

function sumaMontosGalletas(p: PartidoRegistrado): number {
  return (p.galletas ?? []).reduce((s, g) => s + g.monto, 0);
}

function totalRecaudadoPartido(p: PartidoRegistrado): number {
  return p.montoPorJugador * p.jugadorIds.length + sumaMontosGalletas(p);
}

interface LineaCuadraturaJugador {
  fechaMs: number;
  fechaIso: string;
  tipo: "abono" | "partido";
  detalle: string;
  /** Efecto en saldo: abonos tal cual; partidos en negativo. */
  movimiento: number;
}

/** Abonos no anulados + cargos por partidos (lista + galletas), orden cronológico. */
function lineasCuadraturaJugador(estado: EstadoApp, jugadorId: string): LineaCuadraturaJugador[] {
  const lineas: LineaCuadraturaJugador[] = [];
  for (const m of estado.abonos) {
    if (m.jugadorId !== jugadorId || m.anulado === true) continue;
    const nota = m.nota?.trim() ? ` — ${escapeHtml(m.nota.trim())}` : "";
    lineas.push({
      fechaMs: new Date(m.fecha).getTime(),
      fechaIso: m.fecha,
      tipo: "abono",
      detalle: `Abono / ajuste${nota}`,
      movimiento: m.monto,
    });
  }
  for (const p of estado.partidos) {
    const desc = descuentoPartidoSobreJugador(p, jugadorId);
    if (desc <= 0) continue;
    const partes: string[] = [];
    if (p.jugadorIds.includes(jugadorId)) {
      partes.push(`Cuota lista ${fmtMoney(p.montoPorJugador)}`);
    }
    for (const g of p.galletas ?? []) {
      if (g.cargoAJugadorId === jugadorId) {
        partes.push(`Galleta «${escapeHtml(g.nombre)}» ${fmtMoney(g.monto)}`);
      }
    }
    lineas.push({
      fechaMs: new Date(p.fecha).getTime(),
      fechaIso: p.fecha,
      tipo: "partido",
      detalle: `${fmtCanchaPartido(p.cancha)} · ${partes.join(" · ")}`,
      movimiento: -desc,
    });
  }
  lineas.sort((a, b) => {
    if (a.fechaMs !== b.fechaMs) return a.fechaMs - b.fechaMs;
    if (a.tipo !== b.tipo) return a.tipo === "abono" ? -1 : 1;
    return 0;
  });
  return lineas;
}

function parseEncuentroPorEquipo(v: string): EncuentroPorEquipo {
  const n = Number(v);
  if (n === 6 || n === 7 || n === 8) return n;
  return 6;
}

const CANCHA_PARTIDO_LABEL: Record<CanchaPartido, string> = {
  1: "Cancha 1",
  2: "Cancha 2",
  "desafio-vs": "Desafio VS",
  "desafio-futbol-11": "Desafio Futbol 11",
};

function fmtCanchaPartido(c: CanchaPartido): string {
  return CANCHA_PARTIDO_LABEL[c];
}

function etiquetaColorEquipo(c: ColorEquipoPartido): string {
  return c === "rojo" ? "Rojo" : "Azul";
}

function badgeColorEquipoHtml(c: ColorEquipoPartido): string {
  const cls = c === "rojo" ? "camiseta-badge camiseta-badge--rojo" : "camiseta-badge camiseta-badge--azul";
  const abbr = c === "rojo" ? "R" : "A";
  return `<span class="${cls}" title="${etiquetaColorEquipo(c)}">${abbr}</span>`;
}

function textoResultadoEncuentro(p: PartidoRegistrado): string {
  const r = p.resultadoEncuentro;
  if (!r) return "";
  if (r === "empate") return "Empate";
  return r === "rojo" ? "Ganó rojo" : "Ganó azul";
}

function parseCanchaPartidoFormValue(v: string): CanchaPartido | null {
  if (v === "1") return 1;
  if (v === "2") return 2;
  if (v === "desafio-vs") return "desafio-vs";
  if (v === "desafio-futbol-11") return "desafio-futbol-11";
  return null;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CL", {
      dateStyle: "short",
      timeStyle: "short",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function saldoClass(saldo: number): string {
  if (saldo < 0) return "saldo-neg";
  if (saldo < 5000) return "saldo-bajo";
  return "saldo-ok";
}

function errDetalle(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function persist(): void {
  if (!puedeEscribirEnPestanaActual()) return;
  void guardar(estado).catch((e) => {
    setMsg(
      "error",
      `No se pudo guardar en Supabase (${errDetalle(e)}). Los datos siguen en este navegador; probá de nuevo o en Respaldo «Actualizar datos en Supabase». Si usás clave publishable y falla, probá la clave anon (API Keys → Legacy).`
    );
    render();
  });
}

function setMsg(type: "ok" | "error", text: string): void {
  mensaje = { type, text };
}

function renderModalEliminarJugador(): string {
  if (!eliminarJugadorPendienteId) return "";
  const j = estado.jugadores.find((x) => x.id === eliminarJugadorPendienteId);
  if (!j) return "";
  const pos = j.posiciones.map((p) => POS_LABEL[p]).join(", ");
  return `
    <div class="modal-backdrop" id="modal-eliminar-jugador" role="dialog" aria-modal="true" aria-labelledby="modal-eliminar-titulo">
      <div class="modal-dialog" role="document">
        <h2 id="modal-eliminar-titulo" class="modal-title">Eliminar jugador</h2>
        <p class="modal-lead">Revisá los datos y confirmá si querés borrarlo de la lista.</p>
        <dl class="modal-detalles">
          <div><dt>Nombre</dt><dd>${escapeHtml(j.nombre)}</dd></div>
          <div><dt>Posiciones</dt><dd>${escapeHtml(pos)}</dd></div>
          <div><dt>Destreza</dt><dd>${j.destreza} / 10</dd></div>
          <div><dt>Saldo</dt><dd class="${saldoClass(j.saldo)}">${fmtMoney(j.saldo)}</dd></div>
        </dl>
        <p class="modal-aviso">Se quitará de la lista. Los movimientos y partidos guardados pueden seguir mostrando su ID antiguo. <strong>No se puede deshacer.</strong></p>
        <div class="modal-actions">
          <button type="button" class="secondary" id="btn-eliminar-cancelar">Cancelar</button>
          <button type="button" class="primary modal-btn-peligro" id="btn-eliminar-confirmar">Sí, eliminar</button>
        </div>
      </div>
    </div>`;
}

function renderModalEliminarPartido(): string {
  if (!eliminarPartidoPendienteId) return "";
  const p = estado.partidos.find((x) => x.id === eliminarPartidoPendienteId);
  if (!p) return "";
  const nombres =
    p.jugadorIds
      .map((id) => {
        const j = estado.jugadores.find((x) => x.id === id);
        if (j && esJugadorSoloContabilidad(j)) return null;
        if (j) return j.nombre;
        return `(id: ${id})`;
      })
      .filter((x): x is string => x != null)
      .join(", ") || "—";
  const nEnLista = p.jugadorIds.filter((id) => estado.jugadores.some((j) => j.id === id)).length;
  const galletas = p.galletas ?? [];
  const lineasGalleta =
    galletas.length === 0
      ? ""
      : `<div><dt>Galletas</dt><dd>${galletas
          .map((g) => {
            const pj = estado.jugadores.find((x) => x.id === g.cargoAJugadorId);
            const nom = pj ? pj.nombre : "(?)";
            return `${escapeHtml(g.nombre)}: ${escapeHtml(fmtMoney(g.monto))} a cargo de ${escapeHtml(nom)}`;
          })
          .join("<br/>")}</dd></div>`;
  const textoReintegro =
    nEnLista === 0 && galletas.length === 0
      ? "Nadie a reintegrar (partido sin jugadores ni galletas)."
      : [
          nEnLista > 0
            ? `${escapeHtml(fmtMoney(p.montoPorJugador))} a cada uno de los ${nEnLista} en la lista actual`
            : null,
          ...galletas.map((g) => {
            const pj = estado.jugadores.find((x) => x.id === g.cargoAJugadorId);
            const nom = pj ? escapeHtml(pj.nombre) : "(?)";
            return `${escapeHtml(fmtMoney(g.monto))} a ${nom} (galleta «${escapeHtml(g.nombre)}»)`;
          }),
        ]
          .filter(Boolean)
          .join("<br/>");
  return `
    <div class="modal-backdrop" id="modal-eliminar-partido" role="dialog" aria-modal="true" aria-labelledby="modal-eliminar-partido-titulo">
      <div class="modal-dialog" role="document">
        <h2 id="modal-eliminar-partido-titulo" class="modal-title">Eliminar partido</h2>
        <p class="modal-lead">Se borrará el registro y se reintegrará el monto descontado a cada jugador que siga en la lista.</p>
        <dl class="modal-detalles">
          <div><dt>Fecha</dt><dd>${escapeHtml(fmtFecha(p.fecha))}</dd></div>
          <div><dt>Cancha</dt><dd>${escapeHtml(fmtCanchaPartido(p.cancha))}</dd></div>
          <div><dt>Monto por jugador</dt><dd>${escapeHtml(fmtMoney(p.montoPorJugador))}</dd></div>
          <div><dt>Arriendo registrado</dt><dd>${escapeHtml(fmtMoney(p.valorArriendo))}</dd></div>
          <div><dt>Jugadores (${nEnLista} en lista)</dt><dd>${escapeHtml(nombres || "—")}</dd></div>
          ${lineasGalleta}
          <div><dt>Reintegro</dt><dd>${textoReintegro}</dd></div>
        </dl>
        <p class="modal-aviso">El partido desaparece del historial y del informe. <strong>No se puede deshacer.</strong></p>
        <div class="modal-actions">
          <button type="button" class="secondary" id="btn-eliminar-partido-cancelar">Cancelar</button>
          <button type="button" class="primary modal-btn-peligro" id="btn-eliminar-partido-confirmar">Sí, eliminar y reintegrar</button>
        </div>
      </div>
    </div>`;
}

function renderModalAgregarJugadoresPartido(): string {
  if (!agregarJugadoresPartidoId) return "";
  const p = estado.partidos.find((x) => x.id === agregarJugadoresPartidoId);
  if (!p || p.jugadorIds.length > 0) return "";
  const disM = !puedeEscribirEnPestanaActual() ? " disabled" : "";
  const opts = jugadoresPartidosYEquipos(estado.jugadores)
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((j, idx) => {
      const defColor: ColorEquipoPartido = idx % 2 === 0 ? "rojo" : "azul";
      const selR = defColor === "rojo" ? " selected" : "";
      const selA = defColor === "azul" ? " selected" : "";
      return `<div class="partido-jugador-fila partido-jugador-fila--modal">
        <label class="partido-jugador-check"><input type="checkbox" name="pj-add" value="${escapeHtml(j.id)}"${disM} /> ${escapeHtml(j.nombre)} <span class="${saldoClass(j.saldo)}">(${fmtMoney(j.saldo)})</span></label>
        <select data-pj-add-color-id="${escapeHtml(j.id)}" name="pj-add-color" class="partido-pj-camiseta" aria-label="Camiseta de ${escapeHtml(j.nombre)}"${disM}>
          <option value="rojo"${selR}>Rojo</option>
          <option value="azul"${selA}>Azul</option>
        </select>
      </div>`;
    })
    .join("");
  return `
    <div class="modal-backdrop" id="modal-agregar-jugadores-partido" role="dialog" aria-modal="true" aria-labelledby="modal-agregar-jp-titulo">
      <div class="modal-dialog" role="document">
        <h2 id="modal-agregar-jp-titulo" class="modal-title">Agregar jugadores al partido</h2>
        <p class="modal-lead">Este partido solo tenía arriendo/fecha. Al confirmar se guardan los jugadores y se descuenta el monto por jugador a cada uno marcado.</p>
        <dl class="modal-detalles">
          <div><dt>Fecha</dt><dd>${escapeHtml(fmtFecha(p.fecha))}</dd></div>
          <div><dt>Cancha</dt><dd>${escapeHtml(fmtCanchaPartido(p.cancha))}</dd></div>
          <div><dt>Monto por jugador</dt><dd>${p.montoPorJugador > 0 ? escapeHtml(fmtMoney(p.montoPorJugador)) : "Pendiente (completar abajo)"}</dd></div>
          <div><dt>Arriendo</dt><dd>${escapeHtml(fmtMoney(p.valorArriendo))}</dd></div>
        </dl>
        <form id="form-agregar-jugadores-partido">
          ${
            p.montoPorJugador <= 0
              ? `<div class="form-row" style="margin-bottom:0.65rem">
            <label>Monto por jugador ($) <span class="label-hint">(requerido)</span>
              <input type="number" name="monto-add-jp" id="monto-add-jp" step="1" min="1" required placeholder="Ej. 4000"${disM} />
            </label>
          </div>`
              : ""
          }
          <p id="modal-agregar-jp-contador" class="equipos-seleccion-count" aria-live="polite">Marcados: 0</p>
          <div class="jugador-checks jugador-checks--modal">${opts || "<span style='color:var(--muted)'>No hay jugadores en la lista. Agregalos en la pestaña Jugadores.</span>"}</div>
          <div class="form-row" style="margin-top:0.65rem">
            <label>Resultado del encuentro <span class="label-hint">(opcional)</span>
              <select name="resultado-encuentro-add-jp" id="resultado-encuentro-add-jp"${disM}>
                <option value="">Sin registrar</option>
                <option value="empate">Empate</option>
                <option value="rojo">Ganó camiseta roja</option>
                <option value="azul">Ganó camiseta azul</option>
              </select>
            </label>
          </div>
          <div class="modal-actions" style="margin-top:0.85rem">
            <button type="button" class="secondary" id="btn-agregar-jp-cancelar">Cancelar</button>
            <button type="submit" class="primary" ${jugadoresPartidosYEquipos(estado.jugadores).length && puedeEscribirEnPestanaActual() ? "" : "disabled"}>Agregar y descontar</button>
          </div>
        </form>
      </div>
    </div>`;
}

function render(): void {
  asegurarTabPermitida();
  if (tab === "partidos") {
    const formPrevio = document.querySelector<HTMLFormElement>("#app #form-partido");
    if (formPrevio) {
      syncPartidoGalletasBorradorDesdeDom(formPrevio);
      syncPartidoFormBorradorDesdeDom(formPrevio);
    }
  }
  if (eliminarJugadorPendienteId && !estado.jugadores.some((j) => j.id === eliminarJugadorPendienteId)) {
    eliminarJugadorPendienteId = null;
  }
  if (eliminarPartidoPendienteId && !estado.partidos.some((p) => p.id === eliminarPartidoPendienteId)) {
    eliminarPartidoPendienteId = null;
  }
  if (agregarJugadoresPartidoId) {
    const px = estado.partidos.find((p) => p.id === agregarJugadoresPartidoId);
    if (!px || px.jugadorIds.length > 0) agregarJugadoresPartidoId = null;
  }
  const idsGalletasEquipos = new Set(equiposGalletasSorteo.map((g) => g.id));
  equiposSeleccionCache = equiposSeleccionCache.filter((id) => {
    if (idsGalletasEquipos.has(id)) return true;
    const j = estado.jugadores.find((x) => x.id === id);
    return j != null && !esJugadorSoloContabilidad(j);
  });
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = `
    <header class="app-header">
      <div class="app-header-marca">
        <img
          src="${urlLogoCabecera()}"
          alt="${escapeAttr(nombreClubCabecera || "Logo")}"
          class="club-logo-cabecera"
          width="200"
          height="200"
          decoding="async"
          onerror="this.style.display='none'"
        />
        <div class="app-header-titulos">
          ${nombreClubCabecera ? `<p class="club-nombre-cabecera">${escapeHtml(nombreClubCabecera)}</p>` : ""}
          <h1>Administración de canchas</h1>
          ${
            isSupabaseConfigured()
              ? `<div class="app-header-userrow"><span class="app-header-user">${escapeHtml(getUsuarioCabecera())}</span><button type="button" class="secondary app-header-logout" id="btn-cerrar-sesion">Cerrar sesión</button></div>`
              : ""
          }
        </div>
      </div>
      <p>${
        isSupabaseConfigured()
          ? "Los datos se guardan en <strong>Supabase</strong> (misma base para web y app móvil). Usá <strong>Respaldo</strong> para exportar o importar un <code>.json</code>."
          : "Abonos, partidos y equipos. Sin Supabase, los datos viven en este navegador; usá <strong>Respaldo</strong> para un archivo y abrirlo en otro equipo. Configurá <code>.env</code> con Supabase para guardar en la nube."
      }</p>
      <div class="precios">
        <span>En <strong>Partidos</strong> elegís <strong>Cancha 1</strong> o <strong>Cancha 2</strong> e indicás el <strong>monto por jugador</strong> al registrar cada partido.</span>
      </div>
    </header>
    <nav class="tabs" role="tablist">
      ${tabsVisibles()
        .map(
          (t) =>
            `<button type="button" role="tab" data-tab="${t}" class="${tab === t ? "active" : ""}">${labelTab(t)}</button>`
        )
        .join("")}
    </nav>
    ${mensaje ? `<div class="msg ${mensaje.type}">${escapeHtml(mensaje.text)}</div>` : ""}
    <main>${panelContent()}</main>
    ${renderModalEliminarJugador()}
    ${renderModalEliminarPartido()}
    ${renderModalAgregarJugadoresPartido()}
  `;

  app.querySelectorAll("nav.tabs[role='tablist'] button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabAnterior = tab;
      tab = (btn as HTMLButtonElement).dataset.tab as TabPrincipal;
      if (tabAnterior === "partidos" && tab !== "partidos") {
        partidoGalletasBorrador = [];
        partidoFormBorrador = null;
      }
      mensaje = null;
      eliminarJugadorPendienteId = null;
      eliminarPartidoPendienteId = null;
      agregarJugadoresPartidoId = null;
      respaldoPendiente = null;
      render();

      if (tab === "informe" || tab === "informe-partidos") {
        const tabEsperado = tab;
        void (async () => {
          if (isSupabaseConfigured()) {
            try {
              const e = await recargarEstadoDesdeSupabase();
              if (tab !== tabEsperado) return;
              estado = e;
              render();
            } catch {
              if (tab !== tabEsperado) return;
              setMsg("error", "No se pudo recargar datos desde Supabase.");
              render();
            }
            return;
          }
          if (tabEsperado !== "informe") return;
          const fromProject = await tryCargarDesdeJsonProyecto();
          if (tab !== "informe") return;
          if (fromProject && estadoTieneContenido(fromProject)) {
            estado = fromProject;
            void guardar(estado);
            render();
          }
        })();
      }
    });
  });

  bindPanelEvents(app);

  app.querySelector("#btn-cerrar-sesion")?.addEventListener("click", async () => {
    await cerrarSesion();
    renderPantallaLogin();
  });

  if (tab === "equipos" && !equiposSorteoWarmupListo) {
    queueMicrotask(() => {
      intentarCalentarMotorEquipos();
    });
  }

  if (eliminarJugadorPendienteId) {
    const cerrarModalEliminar = () => {
      eliminarJugadorPendienteId = null;
      render();
    };
    app.querySelector("#btn-eliminar-cancelar")?.addEventListener("click", cerrarModalEliminar);
    app.querySelector("#btn-eliminar-confirmar")?.addEventListener("click", () => {
      const id = eliminarJugadorPendienteId;
      if (!id) return;
      estado = eliminarJugador(estado, id);
      eliminarJugadorPendienteId = null;
      if (editandoId === id) editandoId = null;
      persist();
      setMsg("ok", "Jugador eliminado.");
      render();
    });
    const backdrop = app.querySelector("#modal-eliminar-jugador");
    backdrop?.addEventListener("click", (e) => {
      if (e.target === backdrop) cerrarModalEliminar();
    });
    document.addEventListener(
      "keydown",
      function modalEliminarEscape(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        if (!eliminarJugadorPendienteId) return;
        document.removeEventListener("keydown", modalEliminarEscape);
        eliminarJugadorPendienteId = null;
        render();
      },
      { once: true }
    );
    app.querySelector<HTMLButtonElement>("#btn-eliminar-cancelar")?.focus();
  }

  if (eliminarPartidoPendienteId) {
    const cerrarModalPartido = () => {
      eliminarPartidoPendienteId = null;
      render();
    };
    app.querySelector("#btn-eliminar-partido-cancelar")?.addEventListener("click", cerrarModalPartido);
    app.querySelector("#btn-eliminar-partido-confirmar")?.addEventListener("click", () => {
      const id = eliminarPartidoPendienteId;
      if (!id) return;
      estado = eliminarPartido(estado, id);
      eliminarPartidoPendienteId = null;
      persist();
      setMsg("ok", "Partido eliminado y saldos reintegrados.");
      render();
    });
    const backdropPartido = app.querySelector("#modal-eliminar-partido");
    backdropPartido?.addEventListener("click", (e) => {
      if (e.target === backdropPartido) cerrarModalPartido();
    });
    document.addEventListener(
      "keydown",
      function modalEliminarPartidoEscape(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        if (!eliminarPartidoPendienteId) return;
        document.removeEventListener("keydown", modalEliminarPartidoEscape);
        eliminarPartidoPendienteId = null;
        render();
      },
      { once: true }
    );
    app.querySelector<HTMLButtonElement>("#btn-eliminar-partido-cancelar")?.focus();
  }

  if (agregarJugadoresPartidoId) {
    const modalAg = app.querySelector("#modal-agregar-jugadores-partido");
    const formAg = app.querySelector<HTMLFormElement>("#form-agregar-jugadores-partido");
    const cerrarModalAgregarJp = (): void => {
      agregarJugadoresPartidoId = null;
      render();
    };
    const contadorAg = formAg?.querySelector("#modal-agregar-jp-contador");
    const actualizarContadorAgregarJp = (): void => {
      if (!formAg || !contadorAg) return;
      const n = formAg.querySelectorAll<HTMLInputElement>('input[name="pj-add"]:checked').length;
      contadorAg.textContent = `Marcados: ${n}`;
      contadorAg.classList.remove("equipos-count-ok", "equipos-count-parcial");
      if (n > 0) contadorAg.classList.add("equipos-count-parcial");
    };
    formAg?.addEventListener("change", (ev) => {
      if ((ev.target as HTMLElement).matches('input[name="pj-add"]')) actualizarContadorAgregarJp();
    });
    actualizarContadorAgregarJp();
    app.querySelector("#btn-agregar-jp-cancelar")?.addEventListener("click", cerrarModalAgregarJp);
    formAg?.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = agregarJugadoresPartidoId;
      if (!id || !formAg) return;
      const jugadorIds = [...formAg.querySelectorAll<HTMLInputElement>('input[name="pj-add"]:checked')].map((c) => c.value);
      const pModal = estado.partidos.find((x) => x.id === id);
      const montoAddRaw = formAg.querySelector<HTMLInputElement>("#monto-add-jp")?.value?.trim() ?? "";
      const montoExplicito =
        pModal && pModal.montoPorJugador <= 0 && montoAddRaw !== ""
          ? Math.round(Number(montoAddRaw))
          : undefined;
      const colorMap: Record<string, ColorEquipoPartido> = {};
      formAg.querySelectorAll<HTMLSelectElement>("select[data-pj-add-color-id]").forEach((s) => {
        const jid = s.dataset.pjAddColorId;
        if (!jid) return;
        const v = s.value;
        if (v === "rojo" || v === "azul") colorMap[jid] = v;
      });
      const colores: Record<string, ColorEquipoPartido> = {};
      for (const jid of jugadorIds) {
        const c = colorMap[jid];
        if (c !== "rojo" && c !== "azul") {
          setMsg("error", "Cada jugador debe tener camiseta roja o azul.");
          render();
          return;
        }
        colores[jid] = c;
      }
      const resAdd =
        formAg.querySelector<HTMLSelectElement>("#resultado-encuentro-add-jp")?.value?.trim() ?? "";
      let resultadoEncuentro: ResultadoEncuentroPartido | undefined = undefined;
      if (resAdd === "rojo" || resAdd === "azul" || resAdd === "empate") resultadoEncuentro = resAdd;
      const r = agregarJugadoresAPartido(estado, id, jugadorIds, montoExplicito, colores, resultadoEncuentro);
      if (!r.ok) {
        setMsg("error", r.error);
        render();
        return;
      }
      estado = r.estado;
      agregarJugadoresPartidoId = null;
      persist();
      setMsg("ok", "Jugadores agregados al partido y montos descontados.");
      render();
    });
    modalAg?.addEventListener("click", (e) => {
      if (e.target === modalAg) cerrarModalAgregarJp();
    });
    document.addEventListener(
      "keydown",
      function modalAgregarJpEscape(ev: KeyboardEvent) {
        if (ev.key !== "Escape") return;
        if (!agregarJugadoresPartidoId) return;
        document.removeEventListener("keydown", modalAgregarJpEscape);
        agregarJugadoresPartidoId = null;
        render();
      },
      { once: true }
    );
    app.querySelector<HTMLButtonElement>("#btn-agregar-jp-cancelar")?.focus();
  }
}

function labelTab(t: string): string {
  const m: Record<string, string> = {
    jugadores: "Jugadores",
    abonos: "Abonos",
    partidos: "Partidos",
    equipos: "Equipos",
    informe: "Informe Financiero",
    "informe-partidos": "Informe Partidos",
    respaldo: "Respaldo",
  };
  return m[t] ?? t;
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function panelContent(): string {
  switch (tab) {
    case "jugadores":
      return panelJugadores();
    case "abonos":
      return panelAbonos();
    case "partidos":
      return panelPartidos();
    case "equipos":
      return panelEquipos();
    case "informe":
      return panelInforme();
    case "informe-partidos":
      return panelInformePartidos();
    case "respaldo":
      return panelRespaldo();
    default:
      return "";
  }
}

function panelRespaldo(): string {
  const pendienteHtml =
    respaldoPendiente !== null && puedeEditarRespaldoCompleto()
      ? `
    <div class="panel panel-respaldo-preview">
      <h3>Archivo listo: ${escapeHtml(respaldoPendiente.nombre)}</h3>
      <p style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--muted)">
        Contiene <strong>${respaldoPendiente.estado.jugadores.length}</strong> jugadores,
        <strong>${respaldoPendiente.estado.abonos.length}</strong> movimientos de saldo y
        <strong>${respaldoPendiente.estado.partidos.length}</strong> partidos registrados.
      </p>
      <p class="modal-aviso" style="margin-bottom:0.85rem">Al confirmar se <strong>reemplaza por completo</strong> el estado actual${
        isSupabaseConfigured() ? " en <strong>Supabase</strong> y en la copia local del navegador." : " en este navegador (y el JSON del proyecto si usás <code>npm run dev</code>)."
      }</p>
      <div class="modal-actions" style="justify-content:flex-start">
        <button type="button" class="primary modal-btn-peligro" id="btn-confirmar-respaldo">Sí, restaurar estos datos</button>
        <button type="button" class="secondary" id="btn-cancelar-respaldo">Cancelar</button>
      </div>
    </div>`
      : respaldoPendiente !== null && !puedeEditarRespaldoCompleto()
        ? `
    <div class="panel panel-respaldo-preview">
      <p class="msg">Tu rol no permite importar un respaldo completo.</p>
      <button type="button" class="secondary" id="btn-cancelar-respaldo">Cerrar aviso</button>
    </div>`
        : "";

  const previaUrl = temaDesdeUrl() !== null;
  const activo = temaEfectivo() === "futbol" ? "Cancha (verde)" : "Clásico (azul oscuro)";
  return `
    <div class="panel">
      <h2>Apariencia</h2>
      <p style="margin:0 0 0.6rem;font-size:0.9rem;color:var(--muted);line-height:1.45">
        El proyecto usa por defecto el tema <strong>Cancha</strong> (verdes). Para probar el otro sin guardar: agregá <code>?tema=clasico</code> a la URL y recargá; para volver al verde: <code>?tema=cancha</code> o quitá el parámetro.
      </p>
      <p style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--muted);line-height:1.45">
        Ahora ves: <strong>${activo}</strong>.
        ${
          previaUrl
            ? " Estás en <strong>vista previa por URL</strong>; para fijar preferencia en este navegador usá los botones."
            : " Si elegiste tema clásico, esa preferencia se guarda en este navegador; si no, se mantiene el predeterminado cancha."
        }
      </p>
      <div class="form-row" style="align-items:center;flex-wrap:wrap;gap:0.5rem">
        <button type="button" class="primary" data-tema-guardar="clasico">Guardar tema clásico</button>
        <button type="button" class="primary" data-tema-guardar="cancha">Guardar tema cancha</button>
      </div>
    </div>
    <div class="panel">
      <h2>Respaldo en archivo (.json)</h2>
      ${
        isSupabaseConfigured()
          ? `<p style="margin:0 0 0.65rem;font-size:0.9rem;color:var(--muted);line-height:1.45">
        Con <strong>Supabase</strong> activo, cada cambio se guarda en la nube. El respaldo en <code>.json</code> sirve para exportar, migrar o restaurar por completo (también escribe en Supabase al confirmar).
      </p>`
          : `<p style="margin:0 0 0.65rem;font-size:0.9rem;color:var(--muted);line-height:1.45">
        <strong>Archivo del proyecto (<code>public/datos-canchas.json</code>):</strong> al abrir la página se intenta cargar ese JSON. Cada cambio que guardás también se escribe ahí <strong>solo con <code>npm run dev</code></strong> (servidor de Vite).
      </p>
      <p style="margin:0 0 0.65rem;font-size:0.88rem;color:var(--muted);line-height:1.45">
        Si abrís la app sin servidor de desarrollo (solo archivos estáticos) o perdés la carpeta del proyecto, el navegador no puede escribir en el disco del proyecto: seguí usando <strong>Descargar respaldo</strong> / <strong>Restaurar</strong> abajo.
      </p>`
      }
      <ul style="margin:0 0 1rem;padding-left:1.2rem;font-size:0.88rem;color:var(--muted);line-height:1.5">
        <li><strong>Descargar respaldo:</strong> copia extra en <code>.json</code> por si perdés el proyecto o usás otro PC.</li>
        <li><strong>Restaurar desde archivo:</strong> importá un respaldo; revisá el resumen y confirmá.</li>
      </ul>
      <div class="form-row" style="align-items:center;margin-bottom:0.75rem">
        <button type="button" class="primary" id="btn-descargar-respaldo">Descargar respaldo</button>
      </div>
      ${
        puedeEditarRespaldoCompleto()
          ? `<div class="form-row" style="align-items:center;flex-wrap:wrap;gap:0.5rem">
        <input type="file" id="input-importar-respaldo" accept=".json,application/json" style="max-width:100%" />
      </div>`
          : `<p style="margin:0 0 0.75rem;font-size:0.88rem;color:var(--muted)">Importar un archivo y reemplazar todo el estado solo está disponible para el rol <strong>administrador</strong>.</p>`
      }
      <p style="margin:0.5rem 0 0;font-size:0.8rem;color:var(--muted)">Estado actual en memoria: ${estado.jugadores.length} jugadores, ${estado.abonos.length} movimientos, ${estado.partidos.length} partidos.</p>
    </div>
    ${
      isSupabaseConfigured() && puedeEditarRespaldoCompleto()
        ? `
    <div class="panel">
      <h2>Actualizar Supabase</h2>
      <p style="margin:0 0 0.75rem;font-size:0.9rem;color:var(--muted);line-height:1.45">
        Volvé a escribir en la nube el <strong>estado que ves ahora</strong> en la app (útil si falló un guardado por red o querés asegurarte de que la base coincide con esta sesión).
      </p>
      <div class="form-row" style="align-items:center">
        <button type="button" class="primary" id="btn-actualizar-supabase-respaldo"${
          subiendoSupabaseDesdeRespaldo ? " disabled" : ""
        }>${subiendoSupabaseDesdeRespaldo ? "Enviando…" : "Actualizar datos en Supabase"}</button>
      </div>
    </div>`
        : ""
    }
    ${pendienteHtml}`;
}

function ordenarJugadoresParaLista(lista: Jugador[]): Jugador[] {
  const copia = lista.slice();
  const dir = ordenJugadoresDir === "asc" ? 1 : -1;
  if (ordenJugadoresCampo === "saldo") {
    copia.sort((a, b) => dir * (a.saldo - b.saldo));
  } else {
    copia.sort((a, b) => dir * a.nombre.localeCompare(b.nombre, "es"));
  }
  return copia;
}

function ordenarJugadoresParaInforme(lista: Jugador[]): Jugador[] {
  const copia = lista.slice();
  const paso = ((informeOrdenPaso % 4) + 4) % 4;
  if (paso === 0) copia.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  else if (paso === 1) copia.sort((a, b) => b.nombre.localeCompare(a.nombre, "es"));
  else if (paso === 2) copia.sort((a, b) => a.saldo - b.saldo);
  else copia.sort((a, b) => b.saldo - a.saldo);
  return copia;
}

function sumaAbonosJugador(estado: EstadoApp, jugadorId: string): number {
  return estado.abonos
    .filter((a) => a.jugadorId === jugadorId && !a.anulado)
    .reduce((s, a) => s + a.monto, 0);
}

/** Encabezado corto de columna por fecha de partido (distribución tipo planilla). */
function fmtEtiquetaColumnaPartido(fechaIso: string): string {
  try {
    return new Date(fechaIso).toLocaleDateString("es-CL", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return fechaIso.slice(0, 10);
  }
}

function panelInformePartidos(): string {
  const ranking = rankingPartidosPorJugador(estado).filter((row) => {
    const j = estado.jugadores.find((x) => x.id === row.jugadorId);
    return j != null && !esJugadorSoloContabilidad(j);
  });
  if (ranking.length === 0) {
    return `<div class="panel panel-informe-partidos">
      <h2>Informe de partidos jugados</h2>
      <p style="margin:0;color:var(--muted);line-height:1.5">
        No hay jugadores con partidos que entren en el ranking. Solo cuentan partidos con <strong>resultado</strong> (ganó rojo, ganó azul o empate) y <strong>camiseta</strong> roja o azul por jugador, registrados en <strong>Partidos</strong>.
      </p>
    </div>`;
  }
  const filas = ranking
    .map((row, idx) => {
      const j = estado.jugadores.find((x) => x.id === row.jugadorId)!;
      return `<tr class="informe-matriz-fila">
        <td class="informe-matriz-num informe-matriz-col-idx">${idx + 1}</td>
        <td class="informe-matriz-nombre">${escapeHtml(j.nombre)}</td>
        <td class="informe-matriz-num">${row.ganados}</td>
        <td class="informe-matriz-num">${row.empates}</td>
        <td class="informe-matriz-num">${row.perdidos}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="panel panel-informe-partidos">
      <h2>Informe de partidos jugados</h2>
      <p class="informe-intro" style="margin-top:0">
        Ranking según partidos con resultado y camiseta guardados. Orden: <strong>más ganados</strong>, luego <strong>más empates</strong> y, si siguen empatados, <strong>menos derrotas</strong> arriba.
        No aparecen jugadores sin ningún partido que cumpla eso (p. ej. solo monto en lista sin resultado).
      </p>
      <div class="informe-matriz-scroll">
        <table class="informe-matriz informe-matriz--partidos" role="grid">
          <thead>
            <tr>
              <th scope="col" class="informe-matriz-col-idx">#</th>
              <th scope="col" class="informe-matriz-th-nombre">Jugador</th>
              <th scope="col" class="informe-matriz-num-h">Ganados</th>
              <th scope="col" class="informe-matriz-num-h">Empatados</th>
              <th scope="col" class="informe-matriz-num-h">Perdidos</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>`;
}

function panelInforme(): string {
  const jugadores = ordenarJugadoresParaInforme(estado.jugadores);
  if (jugadores.length === 0) {
    return `<div class="panel"><h2>Informe financiero</h2><p style="color:var(--muted)">No hay jugadores para mostrar.</p></div>`;
  }

  const pasoOrden = ((informeOrdenPaso % 4) + 4) % 4;
  const hintsOrden = ["A→Z", "Z→A", "$ ↑", "$ ↓"];
  const ariaOrden = [
    "Orden: nombre de la A a la Z. Activá para invertir a Z a A.",
    "Orden: nombre de la Z a la A. Activá para ordenar saldo de menor a mayor.",
    "Orden: saldo de menor a mayor. Activá para ordenar saldo de mayor a menor.",
    "Orden: saldo de mayor a menor. Activá para volver a nombre A a Z.",
  ];

  const partidos = estado.partidos.slice().sort((a, b) => {
    const c = a.fecha.localeCompare(b.fecha);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });

  const victorias = contarVictoriasPorJugador(estado);

  const thFechas =
    partidos.length === 0
      ? `<th scope="col" class="informe-matriz-col-fecha informe-matriz-muted">—</th>`
      : partidos
          .map(
            (p) =>
              `<th scope="col" class="informe-matriz-col-fecha" title="${escapeHtml(fmtFecha(p.fecha))} · ${escapeHtml(fmtCanchaPartido(p.cancha))}">${escapeHtml(fmtEtiquetaColumnaPartido(p.fecha))}</th>`
          )
          .join("");

  const filasJug = jugadores
    .map((j, idx) => {
      let totalJugado = 0;
      const celdasP =
        partidos.length === 0
          ? `<td class="informe-matriz-num informe-matriz-muted">—</td>`
          : partidos
              .map((p) => {
                const desc = descuentoPartidoSobreJugador(p, j.id);
                if (desc > 0) totalJugado += desc;
                return `<td class="informe-matriz-num">${desc > 0 ? escapeHtml(fmtMoney(desc)) : ""}</td>`;
              })
              .join("");
      const deuda = j.saldo < 0 ? " informe-matriz-fila-deuda" : "";
      return `<tr class="informe-matriz-fila${deuda}">
        <td class="informe-matriz-num informe-matriz-col-idx">${idx + 1}</td>
        <td class="informe-matriz-nombre">${escapeHtml(j.nombre)}</td>
        <td class="informe-matriz-num informe-victorias" title="Partidos ganados (resultado y camiseta guardados; no cuenta empates)">${victorias[j.id] ?? 0}</td>
        <td class="informe-matriz-num">${escapeHtml(fmtMoney(sumaAbonosJugador(estado, j.id)))}</td>
        ${celdasP}
        <td class="informe-matriz-num">${escapeHtml(fmtMoney(totalJugado))}</td>
        <td class="informe-matriz-num ${saldoClass(j.saldo)}">${escapeHtml(fmtMoney(j.saldo))}</td>
      </tr>`;
    })
    .join("");

  const recaudadoPorPartido = partidos.map((p) => totalRecaudadoPartido(p));
  const celdasRecaudado =
    partidos.length === 0
      ? `<td class="informe-matriz-num informe-matriz-muted">—</td>`
      : recaudadoPorPartido.map((m) => `<td class="informe-matriz-num">${escapeHtml(fmtMoney(m))}</td>`).join("");
  const celdasArriendo =
    partidos.length === 0
      ? `<td class="informe-matriz-num informe-matriz-muted">—</td>`
      : partidos.map((p) => `<td class="informe-matriz-num">${escapeHtml(fmtMoney(p.valorArriendo))}</td>`).join("");
  const celdasNeto =
    partidos.length === 0
      ? `<td class="informe-matriz-num informe-matriz-muted">—</td>`
      : partidos.map((p, i) => {
          const net = recaudadoPorPartido[i] - p.valorArriendo;
          return `<td class="informe-matriz-num">${escapeHtml(fmtMoney(net))}</td>`;
        })
        .join("");

  const sumaAdeudado = jugadores.reduce((s, j) => s + Math.max(0, -j.saldo), 0);
  /** Igual que la suma de la columna «Abonos» (solo jugadores actuales; no cuenta movimientos huérfanos). */
  const totalAbonos = estado.jugadores.reduce((s, j) => s + sumaAbonosJugador(estado, j.id), 0);
  const totalArriendosCancha = estado.partidos.reduce((s, p) => s + p.valorArriendo, 0);
  const abonosMenosArriendos = totalAbonos - totalArriendosCancha;
  const resumenNetoClass =
    abonosMenosArriendos < 0
      ? " informe-resumen-linea--neg"
      : abonosMenosArriendos > 0
        ? " informe-resumen-linea--pos"
        : "";

  return `
    <div class="panel panel-informe">
      <h2>Informe financiero</h2>
      <p class="informe-intro">
        Matriz por <strong>jugador</strong>: tocá la columna <strong>#</strong> para alternar orden (nombre A→Z / Z→A, saldo menor→mayor / mayor→menor).
        Columnas: <strong>Victorias</strong> (partidos con resultado y camiseta roja/azul guardados en <strong>Partidos</strong>; no suma empates), abonos, descuento por <strong>partido</strong> (fecha; incluye monto de lista + cargos por <strong>galletas</strong>), total jugado y saldo.
        Abajo: recaudado por partido, <strong>arriendo</strong> y diferencia por columna.
      </p>
      <div class="informe-matriz-scroll">
        <table class="informe-matriz" role="grid">
          <thead>
            <tr>
              <th scope="col" class="informe-matriz-col-idx informe-matriz-th-orden" data-informe-ciclo-orden tabindex="0" role="button" aria-label="${escapeHtml(ariaOrden[pasoOrden])}" title="Orden: ${escapeHtml(hintsOrden[pasoOrden])}. Clic para el siguiente criterio.">#<span class="informe-orden-hint" aria-hidden="true">${escapeHtml(hintsOrden[pasoOrden])}</span></th>
              <th scope="col" class="informe-matriz-th-nombre">Jugador</th>
              <th scope="col" class="informe-matriz-num-h" title="Solo cuenta partidos con resultado distinto de empate y camiseta guardada">Victorias</th>
              <th scope="col" class="informe-matriz-num-h">Abonos</th>
              ${thFechas}
              <th scope="col" class="informe-matriz-num-h">Total jugado</th>
              <th scope="col" class="informe-matriz-num-h">Saldo</th>
            </tr>
          </thead>
          <tbody>${filasJug}</tbody>
          <tfoot>
            <tr class="informe-matriz-tfoot informe-matriz-tfoot-recaudado">
              <td colspan="4" class="informe-matriz-pie-etiq">Total recaudado (por partido)</td>
              ${celdasRecaudado}
              <td class="informe-matriz-pie-dash">—</td>
              <td class="informe-matriz-pie-dash">—</td>
            </tr>
            <tr class="informe-matriz-tfoot informe-matriz-tfoot-arriendo">
              <td colspan="4" class="informe-matriz-pie-etiq">Arriendo cancha</td>
              ${celdasArriendo}
              <td class="informe-matriz-pie-dash">—</td>
              <td class="informe-matriz-pie-dash">—</td>
            </tr>
            <tr class="informe-matriz-tfoot informe-matriz-tfoot-neto">
              <td colspan="4" class="informe-matriz-pie-etiq">Recaudado − arriendo</td>
              ${celdasNeto}
              <td class="informe-matriz-pie-dash">—</td>
              <td class="informe-matriz-pie-dash">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="informe-resumen-totales" aria-label="Totales del informe">
        <div class="informe-resumen-linea"><strong>Total abonos</strong> ${escapeHtml(fmtMoney(totalAbonos))}</div>
        <div class="informe-resumen-linea"><strong>Total arriendos</strong> ${escapeHtml(fmtMoney(totalArriendosCancha))}</div>
        <div class="informe-resumen-linea${resumenNetoClass}"><strong>Abonos − arriendos</strong> ${escapeHtml(fmtMoney(abonosMenosArriendos))}</div>
        <div class="informe-resumen-linea informe-resumen-linea--deuda"><strong>Adeudado</strong> ${escapeHtml(fmtMoney(sumaAdeudado))}</div>
      </div>
    </div>`;
}

function panelJugadores(): string {
  const dis = !puedeEscribirEnPestanaActual() ? " disabled" : "";
  const filas = ordenarJugadoresParaLista(estado.jugadores)
    .map((j) => {
      const pos = j.posiciones.map((p) => POS_LABEL[p]).join(", ");
      const acciones = puedeEscribirEnPestanaActual()
        ? `<button type="button" class="secondary" data-edit="${j.id}">Editar</button>
            <button type="button" class="secondary danger" data-del="${j.id}">Eliminar</button>`
        : `<span class="jugadores-acciones-vacio" aria-hidden="true">–</span>`;
      return `
        <tr>
          <td>${escapeHtml(j.nombre)}</td>
          <td>${escapeHtml(pos)}</td>
          <td title="Destreza 1–10">${j.destreza}</td>
          <td class="${saldoClass(j.saldo)}">${fmtMoney(j.saldo)}</td>
          <td class="inline-actions inline-actions--jugadores">${acciones}</td>
        </tr>`;
    })
    .join("");

  const editForm =
    editandoId !== null
      ? (() => {
          const j = estado.jugadores.find((x) => x.id === editandoId);
          if (!j) return "";
          const checks = POSICIONES.map(
            (p) => `
            <label><input type="checkbox" name="edit-pos" value="${p}" ${j.posiciones.includes(p) ? "checked" : ""} /> ${POS_LABEL[p]}</label>`
          ).join("");
          return `
          <div class="panel">
            <h2>Editar jugador</h2>
            <form id="form-editar">
              <input type="hidden" name="id" value="${escapeHtml(j.id)}" />
              <div class="form-row">
                <label>Nombre
                  <input type="text" name="nombre" value="${escapeHtml(j.nombre)}" required />
                </label>
                <label>Destreza (1–10)
                  <input type="number" name="destreza" min="1" max="10" step="1" value="${j.destreza}" required />
                </label>
                <label>Saldo ($)
                  <input type="number" name="saldo" step="1" value="${j.saldo}" required />
                </label>
              </div>
              <div class="pos-checks">${checks}</div>
              <button type="submit" class="primary"${dis}>Guardar</button>
              <button type="button" class="secondary" id="cancel-edit">Cancelar</button>
            </form>
          </div>`;
        })()
      : "";

  return `
    <div class="panel">
      <h2>Nuevo jugador</h2>
      ${
        isSupabaseConfigured() && !puedeEscribirEnPestanaActual()
          ? `<p class="msg" style="margin:0 0 0.75rem">${
              esLectorApp()
                ? "Solo consulta: no podés modificar jugadores."
                : "Como operador solo podés editar en las pestañas Partidos y Equipos; acá es solo lectura."
            }</p>`
          : ""
      }
      <form id="form-nuevo-jugador">
        <div class="form-row">
          <label>Nombre
            <input type="text" name="nombre" required placeholder="Ej. Juan Pérez"${dis} />
          </label>
          <label>Destreza (1–10)
            <input type="number" name="destreza" min="1" max="10" step="1" value="5" required${dis} />
          </label>
        </div>
        <p style="margin:0 0 0.5rem;font-size:0.85rem;color:var(--muted)">El saldo queda en cero hasta que registres <strong>abonos</strong> en la pestaña Abonos (o ajustes al editar el jugador).</p>
        <p style="margin:0 0 0.5rem;font-size:0.85rem;color:var(--muted)">Posiciones que puede jugar (para armar equipos):</p>
        <div class="pos-checks">
          ${POSICIONES.map(
            (p) =>
              `<label><input type="checkbox" name="pos" value="${p}" ${p === "volante" ? "checked" : ""}${dis} /> ${POS_LABEL[p]}</label>`
          ).join("")}
        </div>
        <button type="submit" class="primary"${dis}>Agregar jugador</button>
      </form>
    </div>
    ${editForm}
    <div class="panel">
      <h2>Listado</h2>
      <p style="margin:0 0 0.35rem;font-size:0.8rem;color:var(--muted)">Ordenar por</p>
      <nav class="tabs tabs-inline" role="tablist" aria-label="Criterio de orden del listado">
        <button type="button" role="tab" data-orden-lista="nombre" class="${ordenJugadoresCampo === "nombre" ? "active" : ""}">Nombre</button>
        <button type="button" role="tab" data-orden-lista="saldo" class="${ordenJugadoresCampo === "saldo" ? "active" : ""}">Saldo</button>
      </nav>
      <p class="jugadores-orden-dir">Dirección</p>
      <nav class="tabs tabs-inline" role="tablist" aria-label="Dirección del orden">
        <button type="button" role="tab" data-orden-dir="asc" class="${ordenJugadoresDir === "asc" ? "active" : ""}">Ascendente</button>
        <button type="button" role="tab" data-orden-dir="desc" class="${ordenJugadoresDir === "desc" ? "active" : ""}">Descendente</button>
      </nav>
      ${
        estado.jugadores.length === 0
          ? "<p style='color:var(--muted)'>No hay jugadores aún.</p>"
          : `<table class="jugadores-tabla">
        <thead><tr><th>Nombre</th><th>Posiciones</th><th>Destreza</th><th>Saldo</th><th class="jugadores-th-acciones"></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`
      }
    </div>`;
}

function panelAbonos(): string {
  const jugOrd = estado.jugadores.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const opts = jugOrd.map((j) => `<option value="${j.id}">${escapeHtml(j.nombre)} — ${fmtMoney(j.saldo)}</option>`).join("");

  const selCuad =
    cuadraturaJugadorSeleccionId && jugOrd.some((j) => j.id === cuadraturaJugadorSeleccionId)
      ? cuadraturaJugadorSeleccionId
      : jugOrd[0]?.id ?? null;
  const optsCuadratura = jugOrd
    .map(
      (j) =>
        `<option value="${escapeHtml(j.id)}"${j.id === selCuad ? " selected" : ""}>${escapeHtml(j.nombre)}</option>`
    )
    .join("");

  let cuadraturaBloque = "";
  if (selCuad) {
    const jSel = estado.jugadores.find((x) => x.id === selCuad);
    const lineas = lineasCuadraturaJugador(estado, selCuad);
    let acum = 0;
    const filas = lineas
      .map((ln) => {
        acum += ln.movimiento;
        const movClass =
          ln.movimiento < 0 ? " saldo-neg" : ln.movimiento > 0 ? " saldo-ok" : "";
        const saldoRowClass = acum < 0 ? " saldo-neg" : acum < 5000 ? " saldo-bajo" : " saldo-ok";
        const tipoTxt = ln.tipo === "abono" ? "Abono" : "Partido";
        return `<tr>
        <td>${escapeHtml(fmtFecha(ln.fechaIso))}</td>
        <td>${tipoTxt}</td>
        <td class="cuadratura-detalle">${ln.detalle}</td>
        <td class="cuadratura-num${movClass}">${fmtMoney(ln.movimiento)}</td>
        <td class="cuadratura-num${saldoRowClass}">${fmtMoney(acum)}</td>
      </tr>`;
      })
      .join("");
    const saldoFicha = jSel?.saldo ?? 0;
    const coincide = saldoFicha === acum;
    const pieDiff = coincide
      ? ""
      : `<p class="cuadratura-aviso-diff" style="margin:0.65rem 0 0;font-size:0.85rem;color:var(--warn)">
          El <strong>saldo en la ficha</strong> (${escapeHtml(fmtMoney(saldoFicha))}) no coincide con la suma de esta tabla (${escapeHtml(
            fmtMoney(acum)
          )}). Suele pasar si se editó el saldo a mano, hay movimientos anulados u origen de datos distinto.
        </p>`;
    cuadraturaBloque = `
    <div class="panel">
      <h2>Cuadratura por jugador</h2>
      <p style="margin:0 0 0.65rem;font-size:0.85rem;color:var(--muted);line-height:1.45">
        Detalle cronológico de <strong>abonos / ajustes</strong> (sin anulados) y <strong>cargos por partidos</strong> (cuota en lista + galletas a tu nombre), con <strong>saldo acumulado</strong> fila a fila.
      </p>
      <div class="form-row" style="max-width:28rem">
        <label>Jugador
          <select id="sel-cuadratura-jugador">${optsCuadratura}</select>
        </label>
      </div>
      <div class="cuadratura-scroll">
        <table class="cuadratura-jugador-tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Detalle</th>
              <th class="cuadratura-th-num">Movimiento</th>
              <th class="cuadratura-th-num">Saldo acum.</th>
            </tr>
          </thead>
          <tbody>
            ${
              filas ||
              `<tr><td colspan="5" style="color:var(--muted)">Sin movimientos en abonos ni partidos para este jugador.</td></tr>`
            }
          </tbody>
          <tfoot>
            <tr class="cuadratura-tfoot-total">
              <td colspan="3"><strong>Total según tabla</strong> (debe coincidir con último saldo acum.)</td>
              <td class="cuadratura-num"></td>
              <td class="cuadratura-num ${acum < 0 ? "saldo-neg" : acum < 5000 ? "saldo-bajo" : "saldo-ok"}"><strong>${fmtMoney(acum)}</strong></td>
            </tr>
            <tr class="cuadratura-tfoot-ficha">
              <td colspan="3"><strong>Saldo en ficha del jugador</strong></td>
              <td class="cuadratura-num" colspan="2"><strong class="${saldoClass(saldoFicha)}">${fmtMoney(saldoFicha)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${pieDiff}
    </div>`;
  } else {
    cuadraturaBloque = `
    <div class="panel">
      <h2>Cuadratura por jugador</h2>
      <p style="margin:0;color:var(--muted);font-size:0.9rem">Agregá al menos un jugador para ver la cuadratura.</p>
    </div>`;
  }

  const historial = estado.abonos.slice(0, 40).map((m) => {
    const j = estado.jugadores.find((x) => x.id === m.jugadorId);
    const nombre = j ? j.nombre : m.jugadorId;
    const nota = m.nota ? ` — ${m.nota}` : "";
    const anulado = m.anulado === true;
    const sufijo = anulado ? " (anulado)" : "";
    const botones =
      puedeEscribirEnPestanaActual() && j
        ? anulado
          ? `<button type="button" class="secondary historial-abono-restaurar" data-restaurar-abono="${escapeHtml(m.id)}">Restaurar en saldo</button>`
          : `<button type="button" class="secondary danger historial-abono-anular" data-anular-abono="${escapeHtml(m.id)}">Anular (revertir saldo)</button>`
        : "";
    const liClass = anulado ? "historial-abono-fila historial-abono-fila--anulado" : "historial-abono-fila";
    return `<li class="${liClass}"><span class="historial-abono-texto">${fmtFecha(m.fecha)} · ${escapeHtml(nombre)}: ${fmtMoney(m.monto)}${escapeHtml(nota)}${escapeHtml(sufijo)}</span><span class="historial-abono-acciones">${botones}</span></li>`;
  });

  const disAb = !puedeEscribirEnPestanaActual() ? " disabled" : "";
  return `
    <div class="panel">
      <h2>Abono o ajuste de saldo</h2>
      ${
        isSupabaseConfigured() && !puedeEscribirEnPestanaActual()
          ? `<p class="msg" style="margin:0 0 0.65rem">${
              esLectorApp()
                ? "Solo consulta: no podés registrar ni anular movimientos."
                : "Como operador solo podés editar en Partidos y Equipos; acá es solo lectura."
            }</p>`
          : ""
      }
      <p style="margin:0 0 0.65rem;font-size:0.85rem;color:var(--muted)">Monto positivo suma al saldo; monto negativo lo resta. No uses cero.</p>
      <p style="margin:0 0 0.65rem;font-size:0.85rem;color:var(--muted)">En el historial podés <strong>anular</strong> un movimiento (revierte el efecto en el saldo) o <strong>restaurarlo</strong> si lo anulaste por error.</p>
      <form id="form-abono">
        <div class="form-row">
          <label>Jugador
            <select name="jugadorId" required${disAb}>${opts || "<option value=''>Sin jugadores</option>"}</select>
          </label>
          <label>Monto ($)
            <input type="number" name="monto" step="1" required placeholder="Ej. 20000 o -5000"${disAb} />
          </label>
        </div>
        <label>Nota (opcional)
          <input type="text" name="nota" placeholder="Ej. Transferencia abril"${disAb} />
        </label>
        <div style="margin-top:0.75rem">
          <button type="submit" class="primary" ${estado.jugadores.length && puedeEscribirEnPestanaActual() ? "" : "disabled"}>Registrar movimiento</button>
        </div>
      </form>
    </div>
    <div class="panel">
      <h2>Historial de movimientos</h2>
      <ul class="historial historial-abonos" style="list-style:none;padding-left:0">${historial.length ? historial.join("") : "<li>Sin movimientos.</li>"}</ul>
    </div>
    ${cuadraturaBloque}`;
}

function panelPartidos(): string {
  const disP = !puedeEscribirEnPestanaActual() ? " disabled" : "";
  const listaOrd = jugadoresPartidosYEquipos(estado.jugadores)
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const defFh = defaultFechaHoraPartido();
  const b = partidoFormBorrador;
  const fechaPartidoInput = b?.fechaD?.trim() ? b.fechaD : defFh.fecha;
  const horaPartidoInput = b && String(b.hora).trim() !== "" ? b.hora : defFh.hora;
  const canchaSeleccionada =
    b && canchaPartidoFormValueValid(b.cancha) ? b.cancha : "1";
  const montoPartidoValor = b ? b.montoPartido : "";
  const valorArriendoInput = b ? b.valorArriendo : "";
  const idsEnLista = new Set(listaOrd.map((j) => j.id));
  const pjMarcados = new Set((b?.jugadorIds ?? []).filter((id) => idsEnLista.has(id)));
  const coloresBorrador = b?.coloresPorJugador ?? {};
  const resultadoSel = b?.resultadoEncuentro ?? "";
  const marcaRes = (v: string) => (resultadoSel === v ? " selected" : "");
  const opts = listaOrd
    .map((j, idx) => {
      const defColor: ColorEquipoPartido =
        coloresBorrador[j.id] ?? (idx % 2 === 0 ? "rojo" : "azul");
      const selR = defColor === "rojo" ? " selected" : "";
      const selA = defColor === "azul" ? " selected" : "";
      const chk = pjMarcados.has(j.id) ? " checked" : "";
      return `<div class="partido-jugador-fila">
        <label class="partido-jugador-check"><input type="checkbox" name="pj" value="${escapeHtml(j.id)}"${chk}${disP} />
        ${escapeHtml(j.nombre)} <span class="${saldoClass(j.saldo)}">(${fmtMoney(j.saldo)})</span></label>
        <select data-pj-color-id="${escapeHtml(j.id)}" name="pj-color" class="partido-pj-camiseta" aria-label="Camiseta de ${escapeHtml(j.nombre)}"${disP}>
          <option value="rojo"${selR}>Rojo</option>
          <option value="azul"${selA}>Azul</option>
        </select>
      </div>`;
    })
    .join("");
  const defaultPagaId = listaOrd[0]?.id ?? "";
  if (listaOrd.length === 0) partidoGalletasBorrador = [];
  else {
    const idsOk = new Set(listaOrd.map((j) => j.id));
    for (const b of partidoGalletasBorrador) {
      if (!idsOk.has(b.cargoAJugadorId)) b.cargoAJugadorId = defaultPagaId;
    }
  }
  const optsPagaSelect = (sel: string) =>
    listaOrd
      .map(
        (j) =>
          `<option value="${escapeHtml(j.id)}"${j.id === sel ? " selected" : ""}>${escapeHtml(j.nombre)}</option>`
      )
      .join("");
  const filasGalletasHtml =
    listaOrd.length === 0
      ? ""
      : partidoGalletasBorrador
          .map(
            (b) => `
        <div class="galleta-fila-partido" data-galleta-id="${escapeHtml(b.id)}">
          <label class="galleta-fila-partido-check"><input type="checkbox" class="galleta-incluir" ${
            b.incluida ? "checked" : ""
          }${disP} /> Jugó</label>
          <input type="text" class="galleta-nombre" name="galleta-nombre-${escapeHtml(b.id)}" placeholder="Nombre galleta" value="${escapeHtml(b.nombre)}" autocomplete="off"${disP} />
          <input type="number" class="galleta-monto" name="galleta-monto-${escapeHtml(b.id)}" min="0" step="1" placeholder="0 permitido" value="${escapeHtml(b.monto)}"${disP} />
          <label class="galleta-fila-partido-paga">Carga a
            <select class="galleta-paga" name="galleta-paga-${escapeHtml(b.id)}"${disP}>${optsPagaSelect(b.cargoAJugadorId)}</select>
          </label>
          <button type="button" class="secondary galleta-quitar-partido" data-galleta-quitar="${escapeHtml(b.id)}"${disP}>Quitar</button>
        </div>`
          )
          .join("");

  const hist = estado.partidos.slice(0, 30).map((p) => {
    const cols = p.coloresEquipoPorJugador;
    const nombresVisibles = p.jugadorIds
      .map((id) => {
        const j = estado.jugadores.find((x) => x.id === id);
        if (!j || esJugadorSoloContabilidad(j)) return null;
        const c = cols?.[id];
        const badge = c ? badgeColorEquipoHtml(c) : "";
        return `${escapeHtml(j.nombre)}${badge}`;
      })
      .filter((x): x is string => x != null);
    const galletasDesc = (p.galletas ?? []).map((g) => {
      const payer = estado.jugadores.find((x) => x.id === g.cargoAJugadorId);
      const pn = payer ? payer.nombre : "?";
      return `Galleta «${g.nombre}» ${fmtMoney(g.monto)} (${pn})`;
    });
    const partes: string[] = [];
    if (nombresVisibles.length > 0) partes.push(nombresVisibles.join(", "));
    const resH = textoResultadoEncuentro(p);
    if (resH) partes.push(escapeHtml(`Resultado: ${resH}`));
    if (galletasDesc.length > 0) partes.push(escapeHtml(galletasDesc.join("; ")));
    const nombresHtml =
      partes.length > 0
        ? partes.join(" · ")
        : escapeHtml(
            p.jugadorIds.length === 0 && (p.galletas ?? []).length === 0
              ? "Sin jugadores (solo arriendo / fecha)"
              : "—"
          );
    const btnAgregar =
      p.jugadorIds.length === 0 && puedeEscribirEnPestanaActual()
        ? `<button type="button" class="secondary historial-partido-agregar" data-agregar-jugadores-partido="${escapeHtml(p.id)}">Agregar jugadores</button>`
        : "";
    const btnEliminar = puedeBorrarPartido()
      ? `<button type="button" class="secondary danger historial-partido-eliminar" data-eliminar-partido="${escapeHtml(p.id)}">Eliminar</button>`
      : "";
    const txtMonto =
      p.montoPorJugador > 0 ? `${fmtMoney(p.montoPorJugador)} c/u` : "monto pendiente (al agregar jugadores)";
    return `<li class="historial-partido-fila">
      <span class="historial-partido-txt">${fmtFecha(p.fecha)} · ${escapeHtml(fmtCanchaPartido(p.cancha))} · ${txtMonto} · arriendo ${fmtMoney(p.valorArriendo)} · ${nombresHtml}</span>
      <span class="historial-partido-acciones">${btnAgregar}${btnEliminar}</span>
    </li>`;
  });

  return `
    <div class="panel">
      <h2>Registrar partido jugado</h2>
        ${
          soloLectura()
            ? `<p class="msg" style="margin:0 0 0.75rem">Solo consulta: no podés registrar ni modificar partidos.</p>`
            : ""
        }
        <p style="margin:0 0 0.75rem;font-size:0.88rem;color:var(--muted)">
        Podés registrar solo <strong>fecha, hora, cancha, arriendo</strong> sin marcar jugadores (cancha ya pagada; después usá <strong>Agregar jugadores</strong> en el historial).
        El <strong>monto por jugador</strong> es opcional hasta que marques jugadores de la lista; al marcarlos, tenés que indicarlo.
        Si hay jugadores marcados, se descontará el monto a cada uno; el saldo puede quedar en cero o negativo.
        El <strong>resultado del encuentro</strong> (rojo / azul / empate) lo podés elegir <strong>también sin jugadores en la lista</strong>: queda guardado y se ve en el historial. La columna <strong>Victorias</strong> del Informe solo suma cuando ese partido tiene jugadores con camiseta y resultado (los empates no suman).
        Junto a cada jugador elegís <strong>camiseta roja o azul</strong> (como en Equipos) cuando los marques.
        <strong>Galletas</strong> son invitados sin ficha: marcá <strong>Jugó</strong>, nombre, monto y qué jugador de la lista absorbe ese cobro (suma al total de «jugaron»).
        El arriendo es el costo del día (informe). Los campos calculados muestran el total por los marcados y <strong>total descuentos − arriendo</strong>.
      </p>
      <form id="form-partido" lang="es">
        <div class="form-row form-row--partido-fecha">
          <label>Fecha
            <input type="date" name="fecha-d" value="${escapeHtml(fechaPartidoInput)}" required${disP} />
          </label>
          <label>Hora <span class="label-hint">(24 h, por defecto 21:00)</span>
            <input
              type="text"
              class="input-hora-24"
              name="hora"
              value="${escapeHtml(horaPartidoInput)}"
              required
              maxlength="5"
              placeholder="21:00"
              inputmode="numeric"
              autocomplete="off"
              spellcheck="false"${disP}
            />
          </label>
        </div>
        <div class="form-row">
          <label>Cancha
            <select name="cancha" required${disP}>
              <option value="1"${canchaSeleccionada === "1" ? " selected" : ""}>Cancha 1</option>
              <option value="2"${canchaSeleccionada === "2" ? " selected" : ""}>Cancha 2</option>
              <option value="desafio-vs"${canchaSeleccionada === "desafio-vs" ? " selected" : ""}>Desafio VS</option>
              <option value="desafio-futbol-11"${canchaSeleccionada === "desafio-futbol-11" ? " selected" : ""}>Desafio Futbol 11</option>
            </select>
          </label>
          <label>Monto por jugador ($) <span class="label-hint" id="partidos-monto-hint">(opcional sin jugadores)</span>
            <input type="number" name="montoPartido" id="partidos-monto-por-jugador" step="1" min="0" placeholder="Ej. 4000" value="${escapeHtml(montoPartidoValor)}"${disP} />
          </label>
          <label>Arriendo cancha ($)
            <input type="number" name="valorArriendo" step="1" min="0" required placeholder="Ej. 80000" value="${escapeHtml(valorArriendoInput)}"${disP} />
          </label>
          <label>Total descuentos (marcados) ($)
            <input type="text" readonly class="partido-calculo" id="partidos-total-descuentos" tabindex="-1" aria-live="polite" value="${fmtMoney(0)}" />
          </label>
          <label>Total descuentos − Arriendo ($)
            <input type="text" readonly class="partido-calculo" id="partidos-diff-arriendo" tabindex="-1" aria-live="polite" value="${fmtMoney(0)}" />
          </label>
          <label>Resultado del encuentro <span class="label-hint">(opcional; sirve sin jugadores en lista)</span>
            <select name="resultadoEncuentro"${disP}>
              <option value=""${marcaRes("")}>Sin registrar</option>
              <option value="empate"${marcaRes("empate")}>Empate</option>
              <option value="rojo"${marcaRes("rojo")}>Ganó camiseta roja</option>
              <option value="azul"${marcaRes("azul")}>Ganó camiseta azul</option>
            </select>
          </label>
        </div>
        <p id="partidos-contador-pj" class="equipos-seleccion-count" aria-live="polite">Jugadores marcados: 0</p>
        <p style="margin:0 0 0.35rem;font-size:0.85rem;color:var(--muted)">Jugaron (lista + galletas marcadas):</p>
        <div class="jugador-checks jugador-checks--partido">${opts || "<span style='color:var(--muted)'>Agrega jugadores primero.</span>"}</div>
        ${
          listaOrd.length === 0
            ? ""
            : `<div class="galletas-partido-bloque">
          <p style="margin:0.65rem 0 0.35rem;font-size:0.85rem;color:var(--muted)">Galletas (opcional)</p>
          <div id="galletas-partido-list" class="galletas-partido-list">${filasGalletasHtml}</div>
          <button type="button" class="secondary" id="btn-agregar-galleta-partido"${disP}>+ Agregar galleta</button>
        </div>`
        }
        <button type="submit" class="primary"${disP}>Registrar partido</button>
      </form>
    </div>
    <div class="panel">
      <h2>Historial de partidos</h2>
      <ul class="historial historial-partidos" style="list-style:none;padding-left:0">${hist.length ? hist.join("") : "<li>Sin partidos registrados.</li>"}</ul>
    </div>`;
}

function defaultFechaHoraPartido(): { fecha: string; hora: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return {
    fecha: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: "21:00",
  };
}

/** Hora en texto 24 h (sin AM/PM). Acepta ej. 9:05 o 09:05. */
function normalizarHora24(texto: string): string | null {
  const t = texto.trim().replace(/\s/g, "");
  const parts = t.split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (!/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function panelEquipos(): string {
  const disSorteo = !puedeInteractuarSorteoEquipos() ? " disabled" : "";
  const disReglas = !puedeEscribirEnPestanaActual() ? " disabled" : "";
  const totalNecesarios = encuentroPorEquipo * 2;
  const jugEq = jugadoresPartidosYEquipos(estado.jugadores);
  const poolSorteo = jugEq.length + equiposGalletasSorteo.length;
  const puedeArmarEquipos = puedeInteractuarSorteoEquipos() && poolSorteo >= totalNecesarios;
  const opts = jugEq
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((j) => {
      const pos = j.posiciones.map((p) => POS_LABEL[p]).join(", ");
      const checked = equiposSeleccionCache.includes(j.id) ? " checked" : "";
      return `<label><input type="checkbox" name="eq" value="${j.id}"${checked}${disSorteo} /> ${escapeHtml(j.nombre)} <span style="color:var(--muted);font-size:0.82rem">(${escapeHtml(pos)} · dest. ${j.destreza})</span></label>`;
    })
    .join("");
  const filasGalletasEquipos = equiposGalletasSorteo
    .map(
      (g) => `
    <label class="equipos-galleta-sorteo-fila">
      <input type="checkbox" name="eq" value="${escapeHtml(g.id)}" checked disabled${disSorteo} aria-checked="true" />
      <span>${escapeHtml(g.nombre)} <span style="color:var(--muted);font-size:0.82rem">(Volante · dest. 5 · solo sorteo)</span></span>
    </label>`
    )
    .join("");
  const tituloGalletasSorteo = filasGalletasEquipos
    ? `<p class="equipos-galletas-sorteo-subtitulo">Galletas (solo sorteo)</p>`
    : "";
  const bloqueChecksJugadores =
    !opts && !filasGalletasEquipos
      ? "<span style='color:var(--muted)'>Agrega jugadores con sus posiciones.</span>"
      : `${opts}${tituloGalletasSorteo}${filasGalletasEquipos}`;

  const selectEncuentro = ENCUENTRO_OPCIONES.map(
    (n) =>
      `<option value="${n}"${n === encuentroPorEquipo ? " selected" : ""}>${n} vs ${n}</option>`
  ).join("");

  const optsJugadoresReglas = jugEq
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((j) => `<option value="${escapeHtml(j.id)}">${escapeHtml(j.nombre)}</option>`)
    .join("");

  const reglasVisibles = estado.reglasEquiposSeparacion.filter((r) => {
    const ja = estado.jugadores.find((j) => j.id === r.jugadorIdA);
    const jb = estado.jugadores.find((j) => j.id === r.jugadorIdB);
    if (ja && esJugadorSoloContabilidad(ja)) return false;
    if (jb && esJugadorSoloContabilidad(jb)) return false;
    return true;
  });

  const listaReglasEquipos =
    reglasVisibles.length === 0
      ? `<li class="equipos-reglas-vacio">Ninguna regla cargada.</li>`
      : reglasVisibles
          .map((r) => {
            const na =
              estado.jugadores.find((j) => j.id === r.jugadorIdA)?.nombre ?? "(jugador borrado)";
            const nb =
              estado.jugadores.find((j) => j.id === r.jugadorIdB)?.nombre ?? "(jugador borrado)";
            return `<li><span class="equipos-reglas-par">${escapeHtml(na)}</span> y <span class="equipos-reglas-par">${escapeHtml(nb)}</span> — distintos equipos
            <button type="button" class="secondary equipos-reglas-quitar" data-quitar-regla="${escapeHtml(r.id)}"${disReglas}>Quitar</button></li>`;
          })
          .join("");

  const textoReglasEnResultado =
    esLectorApp() && isSupabaseConfigured()
      ? ""
      : ` Las <strong>reglas especiales</strong> (pares que no pueden ir juntos) se respetan en ambas opciones.`;
  const equiposHtml =
    ultimoEquipos !== null
      ? `
    <div class="panel">
      <h2>Resultado (${encuentroPorEquipo} vs ${encuentroPorEquipo})</h2>
      <p style="margin:0 0 0.75rem;font-size:0.88rem;color:var(--muted)">
        Se muestran <strong>dos opciones</strong> de reparto (mismos criterios en ambas). Equipo A y B llevan camiseta <strong>roja o azul</strong> al azar en cada opción.
        El sorteo es <strong>aleatorio</strong> entre repartos válidos; se busca equilibrar <strong>defensas</strong> y <strong>volantes</strong> entre equipos (como máximo una de diferencia en cada rol). En <strong>arquero</strong> y <strong>delantero</strong> puede haber más disparidad entre equipos.${textoReglasEnResultado}
      </p>
      ${htmlBloqueOpcionEquipos(1, ultimoEquipos.opcion1, ultimoEquipos.camisetaAOp1)}
      <div class="equipos-opcion-separador" role="presentation" aria-hidden="true"></div>
      ${htmlBloqueOpcionEquipos(2, ultimoEquipos.opcion2, ultimoEquipos.camisetaAOp2)}
      <button type="button" class="secondary" id="btn-otra-vez" style="margin-top:0.75rem"${disSorteo}>Volver a sortear con la misma selección</button>
    </div>`
      : "";

  const bloqueReglas =
    esLectorApp() && isSupabaseConfigured()
      ? ""
      : `
      <details class="equipos-reglas-glosa">
        <summary class="equipos-reglas-summary">Reglas especiales (no juntar en el mismo equipo)</summary>
        <div class="equipos-reglas-body">
          <p class="equipos-reglas-ayuda">Las reglas se guardan con tus datos. Solo cuentan cuando <strong>los dos</strong> jugadores están entre los elegidos para el sorteo.</p>
          <ul class="equipos-reglas-lista">${listaReglasEquipos}</ul>
          <form id="form-reglas-equipos" class="equipos-reglas-form">
            <div class="form-row equipos-reglas-fila">
              <label>Jugador 1
                <select name="regla-jugador-a" required${disReglas}>${optsJugadoresReglas || "<option value=\"\">—</option>"}</select>
              </label>
              <label>Jugador 2
                <select name="regla-jugador-b" required${disReglas}>${optsJugadoresReglas || "<option value=\"\">—</option>"}</select>
              </label>
              <button type="submit" class="secondary" ${jugEq.length >= 2 && puedeEscribirEnPestanaActual() ? "" : "disabled"}>Agregar regla</button>
            </div>
          </form>
        </div>
      </details>`;

  return `
    <div class="panel">
      <h2>Armar equipos</h2>
      ${
        soloLectura()
          ? `<p class="msg" style="margin:0 0 0.75rem">Podés elegir jugadores y sortear equipos aquí; el resultado no se guarda en el servidor.</p>`
          : ""
      }
      <p style="margin:0 0 0.75rem;font-size:0.88rem;color:var(--muted)">
        ${
          esLectorApp() && isSupabaseConfigured()
            ? `La repartición entre equipo A y B es <strong>al azar</strong>. Se intenta equilibrar cuántos van con rol de <strong>defensa</strong> y <strong>volante</strong> en cada equipo; en <strong>arquero</strong> y <strong>delantero</strong> no se fuerza el mismo reparto. Si <strong>nadie</strong> declaró arquero entre los elegidos, cualquiera puede ir al arco. Las dos opciones del resultado son dos sorteos distintos con el mismo criterio.`
            : `La repartición de jugadores entre A y B es <strong>al azar</strong>, respetando solo las <strong>reglas especiales</strong> (abajo). Se intenta equilibrar cuántos van con rol de <strong>defensa</strong> y <strong>volante</strong> en cada equipo; en <strong>arquero</strong> y <strong>delantero</strong> no se fuerza el mismo reparto entre equipos. Si <strong>nadie</strong> declaró arquero entre los elegidos, cualquiera puede ir al arco.
        Las dos opciones que ves son dos sorteos distintos con el mismo criterio; la segunda suele tener mejor equilibrio de suma de destrezas.`
        }
      </p>
      ${bloqueReglas}
      <form id="form-equipos">
        <div class="form-row equipos-encuentro-y-galletas">
          <label class="equipos-label-encuentro">Tamaño del encuentro
            <select id="sel-encuentro" name="encuentro"${disSorteo}>${selectEncuentro}</select>
          </label>
          <div class="equipos-galletas-toolbar">
            <label class="equipos-galletas-num">N.º galletas
              <input type="number" id="equipos-num-galletas-sorteo" min="1" max="30" value="1" step="1"${disSorteo} />
            </label>
            <button type="button" class="secondary" id="btn-equipos-agregar-galletas"${disSorteo}>Agregar galletas</button>
            <button type="button" class="secondary" id="btn-equipos-borrar-galletas"${disSorteo}${
              equiposGalletasSorteo.length === 0 ? " disabled" : ""
            }>Borrar galletas</button>
          </div>
        </div>
        <p style="margin:0.75rem 0 0.35rem;font-size:0.85rem;color:var(--muted)">Jugadores inscritos (necesitás ${totalNecesarios}):</p>
        <p id="equipos-contador" class="equipos-seleccion-count${equiposSeleccionCache.length === totalNecesarios ? " equipos-count-ok" : equiposSeleccionCache.length > 0 ? " equipos-count-parcial" : ""}" aria-live="polite">Seleccionados: ${equiposSeleccionCache.length} de ${totalNecesarios}</p>
        <div class="jugador-checks" style="max-height:280px">${bloqueChecksJugadores}</div>
        <button type="submit" class="primary" ${puedeArmarEquipos ? "" : "disabled"}>Sortear equipos</button>
      </form>
    </div>
    ${equiposHtml}`;
}

function lineLi(l: LineUp): string {
  return `<li><span class="pos-badge">${POS_LABEL[l.posicion]}</span> ${escapeHtml(l.jugador.nombre)} <span style="color:var(--muted);font-size:0.82rem">(${l.jugador.destreza}/10)</span></li>`;
}

function camisetaComplemento(c: CamisetaEquipo): CamisetaEquipo {
  return c === "rojo" ? "azul" : "rojo";
}

function etiquetaCamiseta(c: CamisetaEquipo): string {
  return c === "rojo" ? "Rojo" : "Azul";
}

function iconoCamisetaHtml(c: CamisetaEquipo): string {
  const cls =
    c === "rojo"
      ? "equipo-camiseta-swatch equipo-camiseta-swatch--rojo"
      : "equipo-camiseta-swatch equipo-camiseta-swatch--azul";
  return `<span class="${cls}" title="${etiquetaCamiseta(c)}" aria-hidden="true"></span>`;
}

function claseCardCamiseta(c: CamisetaEquipo): string {
  return c === "rojo" ? "equipo-card equipo-card--camiseta-rojo" : "equipo-card equipo-card--camiseta-azul";
}

function htmlBloqueOpcionEquipos(
  num: 1 | 2,
  opcion: { equipoA: LineUp[]; equipoB: LineUp[] },
  camisetaA: CamisetaEquipo
): string {
  const cB = camisetaComplemento(camisetaA);
  const filtroLine = (ls: LineUp[]): LineUp[] =>
    ls.filter((l) => !esJugadorSoloContabilidad(l.jugador));
  const eqAf = filtroLine(opcion.equipoA);
  const eqBf = filtroLine(opcion.equipoB);
  const sA = totalDestrezaEquipo(eqAf);
  const sB = totalDestrezaEquipo(eqBf);
  const listaA = ordenarLineUpPorPosicion(eqAf).map(lineLi).join("");
  const listaB = ordenarLineUpPorPosicion(eqBf).map(lineLi).join("");
  const comp = describirComposicionEquipos(eqAf, eqBf);
  return `
    <section class="equipos-opcion" aria-labelledby="titulo-opcion-equipos-${num}">
      <h3 class="equipos-opcion-titulo" id="titulo-opcion-equipos-${num}">Opción ${num}</h3>
      <p style="margin:0 0 0.35rem;font-size:0.88rem;color:var(--muted)">
        <strong>Composición:</strong> ${escapeHtml(comp)}.
      </p>
      <p style="margin:0 0 0.75rem;font-size:0.88rem;color:var(--muted)">
        Suma destrezas: equipo A (${etiquetaCamiseta(camisetaA)})${iconoCamisetaHtml(camisetaA)} <strong>${sA}</strong>
        · equipo B (${etiquetaCamiseta(cB)})${iconoCamisetaHtml(cB)} <strong>${sB}</strong>
        (diferencia ${Math.abs(sA - sB)})
      </p>
      <div class="equipos-cancha" role="img" aria-label="Cancha: equipo A a la izquierda, equipo B a la derecha">
        <div class="equipos-cancha-lineas" aria-hidden="true"></div>
        <div class="equipos-cancha-arco equipos-cancha-arco--izq" aria-hidden="true"></div>
        <div class="equipos-cancha-arco equipos-cancha-arco--der" aria-hidden="true"></div>
        <div class="equipos-grid equipos-cancha-grid">
          <div class="${claseCardCamiseta(camisetaA)} equipo-cancha-panel">
            <h3>Equipo A <span class="equipo-camiseta-label">(${etiquetaCamiseta(camisetaA)})</span>${iconoCamisetaHtml(camisetaA)}</h3>
            <ul>${listaA}</ul>
          </div>
          <div class="${claseCardCamiseta(cB)} equipo-cancha-panel">
            <h3>Equipo B <span class="equipo-camiseta-label">(${etiquetaCamiseta(cB)})</span>${iconoCamisetaHtml(cB)}</h3>
            <ul>${listaB}</ul>
          </div>
        </div>
      </div>
    </section>`;
}

function bindPanelEvents(root: HTMLElement): void {
  root.querySelectorAll("button[data-orden-lista]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = (btn as HTMLButtonElement).dataset.ordenLista;
      if (v === "nombre" || v === "saldo") {
        ordenJugadoresCampo = v;
        render();
      }
    });
  });

  root.querySelectorAll("button[data-orden-dir]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = (btn as HTMLButtonElement).dataset.ordenDir;
      if (d === "asc" || d === "desc") {
        ordenJugadoresDir = d;
        render();
      }
    });
  });

  const thInformeOrden = root.querySelector("[data-informe-ciclo-orden]");
  if (thInformeOrden) {
    const avanzarOrdenInforme = (): void => {
      informeOrdenPaso = (informeOrdenPaso + 1) % 4;
      render();
    };
    thInformeOrden.addEventListener("click", avanzarOrdenInforme);
    thInformeOrden.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault();
        avanzarOrdenInforme();
      }
    });
  }

  root.querySelector("#form-nuevo-jugador")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const nombre = String(fd.get("nombre") ?? "").trim();
    const destreza = normalizarDestreza(fd.get("destreza"));
    const pos = fd.getAll("pos").filter(Boolean) as Posicion[];
    if (!nombre) {
      setMsg("error", "Ingresa un nombre.");
      render();
      return;
    }
    estado = agregarJugador(estado, nombre, pos.length ? pos : ["volante"], destreza);
    persist();
    setMsg("ok", "Jugador agregado.");
    render();
  });

  root.querySelector("#form-editar")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const id = String(fd.get("id"));
    const nombre = String(fd.get("nombre") ?? "").trim();
    const destreza = normalizarDestreza(fd.get("destreza"));
    const saldo = normalizarSaldo(fd.get("saldo"));
    const pos = fd.getAll("edit-pos").filter(Boolean) as Posicion[];
    if (!nombre) {
      setMsg("error", "Ingresa un nombre.");
      render();
      return;
    }
    estado = actualizarJugador(estado, id, {
      nombre,
      destreza,
      saldo,
      posiciones: pos.length ? pos : ["volante"],
    });
    editandoId = null;
    persist();
    setMsg("ok", "Jugador actualizado.");
    render();
  });

  root.querySelector("#cancel-edit")?.addEventListener("click", () => {
    editandoId = null;
    mensaje = null;
    render();
  });

  root.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editandoId = (btn as HTMLButtonElement).dataset.edit ?? null;
      mensaje = null;
      render();
    });
  });

  root.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.del;
      if (!id) return;
      eliminarPartidoPendienteId = null;
      agregarJugadoresPartidoId = null;
      eliminarJugadorPendienteId = id;
      render();
    });
  });

  root.querySelector("#sel-cuadratura-jugador")?.addEventListener("change", (e) => {
    cuadraturaJugadorSeleccionId = (e.target as HTMLSelectElement).value || null;
    render();
  });

  root.querySelector("#form-abono")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const jugadorId = String(fd.get("jugadorId"));
    const monto = Number(fd.get("monto"));
    const nota = String(fd.get("nota") ?? "").trim() || undefined;
    const r = registrarAbono(estado, jugadorId, monto, nota);
    if (!r.ok) {
      setMsg("error", r.error);
      render();
      return;
    }
    estado = r.estado;
    persist();
    (e.target as HTMLFormElement).reset();
    setMsg("ok", "Movimiento registrado.");
    render();
  });

  root.querySelectorAll("[data-anular-abono]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.anularAbono;
      if (!id) return;
      const r = anularMovimientoAbono(estado, id);
      if (!r.ok) {
        setMsg("error", r.error);
        render();
        return;
      }
      estado = r.estado;
      persist();
      setMsg("ok", "Movimiento anulado: el saldo del jugador fue revertido.");
      render();
    });
  });

  root.querySelectorAll("[data-restaurar-abono]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.restaurarAbono;
      if (!id) return;
      const r = restaurarMovimientoAbono(estado, id);
      if (!r.ok) {
        setMsg("error", r.error);
        render();
        return;
      }
      estado = r.estado;
      persist();
      setMsg("ok", "Movimiento restaurado: el monto volvió a aplicarse al saldo.");
      render();
    });
  });

  const formPartido = root.querySelector<HTMLFormElement>("#form-partido");
  if (formPartido) {
    const contadorPj = formPartido.querySelector("#partidos-contador-pj");
    const totalDescEl = formPartido.querySelector<HTMLInputElement>("#partidos-total-descuentos");
    const diffArriendoEl = formPartido.querySelector<HTMLInputElement>("#partidos-diff-arriendo");
    const sincronizarResumenesPartido = (): void => {
      syncPartidoGalletasBorradorDesdeDom(formPartido);
      const nPj = formPartido.querySelectorAll<HTMLInputElement>('input[name="pj"]:checked').length;
      let sumGalletas = 0;
      let nGalletasMarcadas = 0;
      for (const b of partidoGalletasBorrador) {
        if (!b.incluida) continue;
        nGalletasMarcadas += 1;
        const gm = Math.round(Number(b.monto));
        if (Number.isFinite(gm) && gm > 0) sumGalletas += gm;
      }
      const nTotal = nPj + nGalletasMarcadas;
      const montoInput = formPartido.querySelector<HTMLInputElement>("#partidos-monto-por-jugador");
      const montoHint = formPartido.querySelector("#partidos-monto-hint");
      if (montoInput) {
        montoInput.required = nPj > 0;
        montoInput.min = nPj > 0 ? "1" : "0";
      }
      if (montoHint) {
        montoHint.textContent =
          nPj > 0 ? "(requerido con jugadores en lista)" : "(opcional sin jugadores en lista)";
      }
      if (contadorPj) {
        const detalle =
          nGalletasMarcadas > 0 ? ` (${nPj} en lista + ${nGalletasMarcadas} galleta(s))` : "";
        contadorPj.textContent = `Jugadores marcados: ${nTotal}${detalle}`;
        contadorPj.classList.remove("equipos-count-ok", "equipos-count-parcial");
        if (nTotal > 0) contadorPj.classList.add("equipos-count-parcial");
      }
      const montoRaw = Math.round(Number(formPartido.querySelector<HTMLInputElement>('input[name="montoPartido"]')?.value));
      const montoOk = Number.isFinite(montoRaw) && montoRaw > 0 ? montoRaw : 0;
      const totalDescuentos = montoOk * nPj + sumGalletas;
      const arriendoRaw = Math.round(Number(formPartido.querySelector<HTMLInputElement>('input[name="valorArriendo"]')?.value));
      const arriendoOk = Number.isFinite(arriendoRaw) && arriendoRaw >= 0 ? arriendoRaw : 0;
      const diferencia = totalDescuentos - arriendoOk;
      if (totalDescEl) totalDescEl.value = fmtMoney(totalDescuentos);
      if (diffArriendoEl) {
        diffArriendoEl.value = fmtMoney(diferencia);
        diffArriendoEl.classList.remove("partido-calculo-diff-neg", "partido-calculo-diff-pos", "partido-calculo-diff-cero");
        if (diferencia < 0) diffArriendoEl.classList.add("partido-calculo-diff-neg");
        else if (diferencia > 0) diffArriendoEl.classList.add("partido-calculo-diff-pos");
        else diffArriendoEl.classList.add("partido-calculo-diff-cero");
      }
    };
    formPartido.addEventListener("change", (ev) => {
      const t = ev.target as HTMLElement;
      if (
        t.matches('input[name="pj"]') ||
        t.matches("select[data-pj-color-id]") ||
        t.matches('select[name="resultadoEncuentro"]') ||
        t.closest("[data-galleta-id]")
      ) {
        sincronizarResumenesPartido();
      }
    });
    formPartido.addEventListener("input", (ev) => {
      const t = ev.target as HTMLElement;
      if (
        t.matches('input[name="montoPartido"]') ||
        t.matches('input[name="valorArriendo"]') ||
        t.closest("[data-galleta-id]")
      ) {
        sincronizarResumenesPartido();
      }
    });
    formPartido.addEventListener("click", (ev) => {
      const q = (ev.target as HTMLElement).closest("[data-galleta-quitar]") as HTMLElement | null;
      if (!q || !formPartido.contains(q)) return;
      ev.preventDefault();
      const gid = q.dataset.galletaQuitar;
      if (!gid) return;
      syncPartidoGalletasBorradorDesdeDom(formPartido);
      partidoGalletasBorrador = partidoGalletasBorrador.filter((x) => x.id !== gid);
      render();
    });
    sincronizarResumenesPartido();
  }

  root.querySelector("#btn-agregar-galleta-partido")?.addEventListener("click", () => {
    const listaOrd = jugadoresPartidosYEquipos(estado.jugadores)
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (!listaOrd.length) return;
    const fp = root.querySelector<HTMLFormElement>("#form-partido");
    if (fp) syncPartidoGalletasBorradorDesdeDom(fp);
    partidoGalletasBorrador.push({
      id: nuevoId(),
      incluida: true,
      nombre: "",
      monto: "0",
      cargoAJugadorId: idJugadorGalletaNuevaDefecto(listaOrd),
    });
    render();
  });

  root.querySelector("#form-partido")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    syncPartidoGalletasBorradorDesdeDom(form);
    const fd = new FormData(form);
    const fechaD = String(fd.get("fecha-d") ?? "");
    const horaRaw = String(fd.get("hora") ?? "");
    const canchaRaw = String(fd.get("cancha") ?? "");
    const cancha = parseCanchaPartidoFormValue(canchaRaw);
    if (cancha == null) {
      setMsg("error", "Elegí una cancha válida.");
      render();
      return;
    }
    const montoStr = String(fd.get("montoPartido") ?? "").trim();
    const montoPartido = montoStr === "" ? 0 : Math.round(Number(montoStr));
    const checks = form.querySelectorAll<HTMLInputElement>('input[name="pj"]:checked');
    const jugadorIds = [...checks].map((c) => c.value);
    const galletasMarcadas = partidoGalletasBorrador.filter((b) => b.incluida);
    if (jugadorIds.length > 0 && (!Number.isFinite(montoPartido) || montoPartido <= 0)) {
      setMsg("error", "Con jugadores de la lista marcados, ingresá un monto por jugador mayor a cero.");
      render();
      return;
    }
    if (jugadorIds.length === 0 && (!Number.isFinite(montoPartido) || montoPartido < 0)) {
      setMsg("error", "Sin jugadores en la lista, el monto puede quedar vacío (se toma como cero) o ser cero o mayor.");
      render();
      return;
    }
    const galletasSubmit: GalletaPartido[] = [];
    const idsLista = new Set(jugadoresPartidosYEquipos(estado.jugadores).map((j) => j.id));
    for (const b of galletasMarcadas) {
      const nombre = b.nombre.trim();
      const gm = Math.round(Number(b.monto));
      if (!nombre) {
        setMsg("error", "Completá el nombre de cada galleta marcada como «Jugó».");
        render();
        return;
      }
      if (!Number.isFinite(gm) || gm < 0) {
        setMsg("error", `Ingresá un monto válido (cero o mayor) para la galleta «${nombre}».`);
        render();
        return;
      }
      if (!b.cargoAJugadorId || !idsLista.has(b.cargoAJugadorId)) {
        setMsg("error", `Elegí a qué jugador cargar el monto de «${nombre}».`);
        render();
        return;
      }
      galletasSubmit.push({
        id: nuevoId(),
        nombre,
        monto: gm,
        cargoAJugadorId: b.cargoAJugadorId,
      });
    }
    if (!fechaD) {
      setMsg("error", "Completá la fecha.");
      render();
      return;
    }
    const hora = normalizarHora24(horaRaw);
    if (!hora) {
      setMsg("error", "Hora inválida. Usá formato 24 h sin AM/PM (ej. 08:00 o 14:30).");
      render();
      return;
    }
    const local = new Date(`${fechaD}T${hora}:00`);
    if (Number.isNaN(local.getTime())) {
      setMsg("error", "Fecha u hora no válida.");
      render();
      return;
    }
    const iso = local.toISOString();
    const valorArriendo = Math.round(Number(fd.get("valorArriendo")));
    const colorMap: Record<string, ColorEquipoPartido> = {};
    form.querySelectorAll<HTMLSelectElement>("select[data-pj-color-id]").forEach((s) => {
      const jid = s.dataset.pjColorId;
      if (!jid) return;
      const v = s.value;
      if (v === "rojo" || v === "azul") colorMap[jid] = v;
    });
    const coloresSubmit: Record<string, ColorEquipoPartido> = {};
    for (const id of jugadorIds) {
      const c = colorMap[id];
      if (c !== "rojo" && c !== "azul") {
        setMsg("error", "Cada jugador marcado debe tener camiseta roja o azul.");
        render();
        return;
      }
      coloresSubmit[id] = c;
    }
    const resForm = String(fd.get("resultadoEncuentro") ?? "").trim();
    let resultadoPartido: ResultadoEncuentroPartido | undefined = undefined;
    if (resForm === "rojo" || resForm === "azul" || resForm === "empate") resultadoPartido = resForm;
    const r = registrarPartido(
      estado,
      cancha,
      jugadorIds,
      iso,
      montoPartido,
      valorArriendo,
      galletasSubmit,
      jugadorIds.length > 0 ? coloresSubmit : undefined,
      resultadoPartido
    );
    if (!r.ok) {
      setMsg("error", r.error);
      render();
      return;
    }
    estado = r.estado;
    persist();
    partidoGalletasBorrador = [];
    partidoFormBorrador = null;
    form.querySelectorAll('input[name="pj"]').forEach((c) => {
      (c as HTMLInputElement).checked = false;
    });
    const huboLista = jugadorIds.length > 0;
    const huboGalletas = galletasSubmit.length > 0;
    setMsg(
      "ok",
      !huboLista && !huboGalletas
        ? "Partido registrado (sin jugadores). Podés agregarlos desde el historial con «Agregar jugadores»."
        : "Partido registrado y montos descontados."
    );
    render();
  });

  root.querySelectorAll("[data-eliminar-partido]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.eliminarPartido;
      if (!id) return;
      eliminarJugadorPendienteId = null;
      agregarJugadoresPartidoId = null;
      eliminarPartidoPendienteId = id;
      mensaje = null;
      render();
    });
  });

  root.querySelectorAll("[data-agregar-jugadores-partido]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.agregarJugadoresPartido;
      if (!id) return;
      eliminarJugadorPendienteId = null;
      eliminarPartidoPendienteId = null;
      agregarJugadoresPartidoId = id;
      mensaje = null;
      render();
    });
  });

  root.querySelectorAll("[data-tema-guardar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = (btn as HTMLElement).dataset.temaGuardar;
      guardarTemaPreferido(v === "cancha" ? "futbol" : "default");
      setMsg(
        "ok",
        v === "cancha"
          ? "Tema cancha guardado en este navegador."
          : "Tema clásico guardado en este navegador."
      );
      render();
    });
  });

  root.querySelector("#btn-actualizar-supabase-respaldo")?.addEventListener("click", () => {
    if (!isSupabaseConfigured() || subiendoSupabaseDesdeRespaldo) return;
    subiendoSupabaseDesdeRespaldo = true;
    mensaje = null;
    render();
    void guardar(estado)
      .then(() => {
        setMsg("ok", "Datos actualizados en Supabase.");
      })
      .catch((e) => {
        setMsg(
          "error",
          `No se pudo actualizar Supabase (${errDetalle(e)}). Revisá .env y la clave API (probar anon Legacy si hace falta).`
        );
      })
      .finally(() => {
        subiendoSupabaseDesdeRespaldo = false;
        render();
      });
  });

  root.querySelector("#btn-descargar-respaldo")?.addEventListener("click", () => {
    const json = estadoARespaldoJson(estado);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    a.href = url;
    a.download = `admin-canchas-respaldo-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMsg("ok", "Respaldo descargado. Guardalo en un lugar seguro y podés abrirlo en otro navegador con Restaurar.");
    render();
  });

  root.querySelector("#input-importar-respaldo")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const r = respaldoJsonAEstado(text);
      if (!r.ok) {
        respaldoPendiente = null;
        setMsg("error", r.error);
        render();
        return;
      }
      respaldoPendiente = { nombre: file.name, estado: r.estado };
      setMsg("ok", "Archivo leído. Revisá el resumen debajo y confirmá si querés reemplazar los datos actuales.");
      render();
    } catch {
      respaldoPendiente = null;
      setMsg("error", "No se pudo leer el archivo.");
      render();
    }
  });

  root.querySelector("#btn-confirmar-respaldo")?.addEventListener("click", () => {
    if (!respaldoPendiente) return;
    const nuevo = respaldoPendiente.estado;
    respaldoPendiente = null;
    editandoId = null;
    ultimoEquipos = null;
    equiposSeleccionCache = [];
    equiposGalletasSorteo = [];
    eliminarJugadorPendienteId = null;
    eliminarPartidoPendienteId = null;
    agregarJugadoresPartidoId = null;
    partidoGalletasBorrador = [];
    partidoFormBorrador = null;
    estado = nuevo;
    void guardar(estado)
      .then(() => {
        setMsg(
          "ok",
          isSupabaseConfigured()
            ? "Datos restaurados y guardados en Supabase."
            : "Datos restaurados. Ya están guardados en este navegador."
        );
        render();
      })
      .catch((e) => {
        setMsg(
          "error",
          isSupabaseConfigured()
            ? `Supabase rechazó el guardado (${errDetalle(e)}). Los datos restaurados quedaron en este navegador (copia local). Cuando funcione la API, usá Respaldo → «Actualizar datos en Supabase». Si usás publishable y falla, probá la clave anon en API Keys → Legacy.`
            : "No se pudo guardar en este navegador (almacenamiento lleno o bloqueado)."
        );
        render();
      });
  });

  root.querySelector("#btn-cancelar-respaldo")?.addEventListener("click", () => {
    respaldoPendiente = null;
    mensaje = null;
    render();
  });

  root.querySelector("#sel-encuentro")?.addEventListener("change", () => {
    const form = root.querySelector<HTMLFormElement>("#form-equipos");
    if (form) {
      equiposSeleccionCache = [...form.querySelectorAll<HTMLInputElement>('input[name="eq"]:checked')].map((c) => c.value);
      encuentroPorEquipo = parseEncuentroPorEquipo(
        (form.querySelector("#sel-encuentro") as HTMLSelectElement).value
      );
    }
    mensaje = null;
    render();
  });

  root.querySelector("#btn-equipos-agregar-galletas")?.addEventListener("click", () => {
    if (!puedeInteractuarSorteoEquipos()) return;
    const inp = root.querySelector<HTMLInputElement>("#equipos-num-galletas-sorteo");
    let n = Math.round(Number(inp?.value ?? 1));
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 30) n = 30;
    const base = equiposGalletasSorteo.length;
    const nuevas: { id: string; nombre: string }[] = [];
    for (let i = 0; i < n; i++) {
      nuevas.push({ id: nuevoId(), nombre: `Galleta ${base + i + 1}` });
    }
    equiposGalletasSorteo.push(...nuevas);
    equiposSeleccionCache = [...equiposSeleccionCache, ...nuevas.map((x) => x.id)];
    mensaje = null;
    render();
  });

  root.querySelector("#btn-equipos-borrar-galletas")?.addEventListener("click", () => {
    const gIds = new Set(equiposGalletasSorteo.map((g) => g.id));
    equiposGalletasSorteo = [];
    equiposSeleccionCache = equiposSeleccionCache.filter((id) => !gIds.has(id));
    mensaje = null;
    render();
  });

  const formEquipos = root.querySelector<HTMLFormElement>("#form-equipos");
  if (formEquipos) {
    const actualizarContadorEquipos = (): void => {
      equiposSeleccionCache = [
        ...formEquipos.querySelectorAll<HTMLInputElement>('input[name="eq"]:checked'),
      ].map((c) => c.value);
      const sel = formEquipos.querySelector<HTMLSelectElement>("#sel-encuentro");
      const n = sel ? parseEncuentroPorEquipo(sel.value) : encuentroPorEquipo;
      const necesarios = n * 2;
      const el = formEquipos.querySelector("#equipos-contador");
      if (!el) return;
      el.textContent = `Seleccionados: ${equiposSeleccionCache.length} de ${necesarios}`;
      el.classList.remove("equipos-count-ok", "equipos-count-parcial");
      if (equiposSeleccionCache.length === necesarios) el.classList.add("equipos-count-ok");
      else if (equiposSeleccionCache.length > 0) el.classList.add("equipos-count-parcial");
    };
    formEquipos.addEventListener("change", (e) => {
      if ((e.target as HTMLElement).matches('input[name="eq"]')) actualizarContadorEquipos();
    });
    actualizarContadorEquipos();
  }

  root.querySelector("#form-equipos")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    const encuentro = parseEncuentroPorEquipo(String(fd.get("encuentro")));
    encuentroPorEquipo = encuentro;
    const checks = form.querySelectorAll<HTMLInputElement>('input[name="eq"]:checked');
    const ids = [...checks].map((c) => c.value);
    equiposSeleccionCache = ids;
    const seleccionados = jugadoresSeleccionadosParaSorteo(ids);
    withFutbolWaitCursor(() => {
      const res = armarDosOpcionesEquipos(seleccionados, encuentro, estado.reglasEquiposSeparacion);
      if (!res.ok) {
        setMsg("error", res.error);
        ultimoEquipos = null;
        render();
        return;
      }
      ultimoEquipos = {
        opcion1: res.opcion1,
        opcion2: res.opcion2,
        camisetaAOp1: Math.random() < 0.5 ? "rojo" : "azul",
        camisetaAOp2: Math.random() < 0.5 ? "rojo" : "azul",
      };
      mensaje = null;
      render();
    });
  });

  root.querySelector("#btn-otra-vez")?.addEventListener("click", () => {
    const form = root.querySelector<HTMLFormElement>("#form-equipos");
    if (!form || !ultimoEquipos) return;
    const fd = new FormData(form);
    const encuentro = parseEncuentroPorEquipo(String(fd.get("encuentro")));
    encuentroPorEquipo = encuentro;
    const checks = form.querySelectorAll<HTMLInputElement>('input[name="eq"]:checked');
    const ids = [...checks].map((c) => c.value);
    equiposSeleccionCache = ids;
    const seleccionados = jugadoresSeleccionadosParaSorteo(ids);
    withFutbolWaitCursor(() => {
      const res = armarDosOpcionesEquipos(seleccionados, encuentro, estado.reglasEquiposSeparacion);
      if (!res.ok) {
        setMsg("error", res.error);
        render();
        return;
      }
      ultimoEquipos = {
        opcion1: res.opcion1,
        opcion2: res.opcion2,
        camisetaAOp1: Math.random() < 0.5 ? "rojo" : "azul",
        camisetaAOp2: Math.random() < 0.5 ? "rojo" : "azul",
      };
      render();
    });
  });

  root.querySelector("#form-reglas-equipos")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    const a = String(fd.get("regla-jugador-a") ?? "");
    const b = String(fd.get("regla-jugador-b") ?? "");
    const r = agregarReglaEquiposSeparacion(estado, a, b);
    if (!r.ok) {
      setMsg("error", r.error);
      render();
      return;
    }
    estado = r.estado;
    persist();
    setMsg("ok", "Regla agregada.");
    render();
  });

  root.querySelectorAll(".equipos-reglas-quitar").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.quitarRegla;
      if (!id) return;
      estado = quitarReglaEquiposSeparacion(estado, id);
      persist();
      setMsg("ok", "Regla quitada.");
      render();
    });
  });
}

function renderPantallaLogin(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const logoSrc = escapeAttr(urlLogoCabecera());
  app.innerHTML = `
    <div class="auth-login-screen">
      <div class="auth-login-inner panel">
        <div class="auth-login-logo-wrap">
          <img
            src="${logoSrc}"
            alt=""
            class="auth-login-logo"
            width="240"
            height="240"
            decoding="async"
            onerror="this.style.display='none'"
          />
        </div>
        <p class="auth-login-lead">Iniciá sesión con el usuario y la contraseña que te dio el administrador.</p>
        <form id="form-login-auth" class="auth-login-form">
          <label class="auth-login-field-label">Usuario
            <input type="text" name="usuario" class="auth-login-input" autocomplete="username" required autocapitalize="off" spellcheck="false" />
          </label>
          <label class="auth-login-field-label">Contraseña
            <input type="password" name="password" class="auth-login-input" autocomplete="current-password" required />
          </label>
          <button type="submit" class="primary auth-login-submit">Ingresar</button>
        </form>
        <p id="login-error" class="msg error auth-login-error" style="display:none"></p>
      </div>
    </div>`;
  app.querySelector("#form-login-auth")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    const usuario = String(fd.get("usuario") ?? "");
    const password = String(fd.get("password") ?? "");
    const errEl = app.querySelector("#login-error") as HTMLElement | null;
    if (errEl) {
      errEl.style.display = "none";
      errEl.textContent = "";
    }
    try {
      await iniciarSesionUsuario(usuario, password);
      await bootstrapApp();
    } catch (ex) {
      if (errEl) {
        errEl.textContent = errDetalle(ex);
        errEl.style.display = "block";
      }
    }
  });
}

async function bootstrapApp(): Promise<void> {
  estado = await cargarInicial();
  const aviso = consumirAvisoCargaInicial();
  if (aviso) setMsg(aviso.type, aviso.text);
  nombreClubCabecera = null;
  if (isSupabaseConfigured()) {
    try {
      nombreClubCabecera = await cargarNombreClubDesdeSupabase();
    } catch {
      nombreClubCabecera = null;
    }
  }
  render();
  programarCalentamientoSorteoEquiposIdle();
}

async function bootstrap(): Promise<void> {
  if (isSupabaseConfigured()) {
    await cargarSesionYRol();
    const sb = getSupabase();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) {
      renderPantallaLogin();
      return;
    }
  }
  await bootstrapApp();
}

inicializarTemaDesdeUrlYLocalStorage();
void bootstrap();
