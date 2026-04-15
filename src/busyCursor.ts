/** Profundidad de operaciones concurrentes que muestran el cursor de espera. */
let busyDepth = 0;

const CURSOR_PX = 32;
const CURSOR_HOTSPOT = 16;

let cachedCursorDataUrl: string | null = null;
let buildInFlight: Promise<string> | null = null;

function busyFileName(): string {
  const custom = (import.meta.env.VITE_BUSY_CURSOR_URL as string | undefined)?.trim();
  return custom && custom.length > 0 ? custom : "mi-balon.png";
}

function busyCursorPath(): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${busyFileName().replace(/^\//, "")}`;
}

/** PNG 32×32 en memoria para el balón que sigue al puntero. */
function buildCursorDataUrlFromImage(): Promise<string> {
  if (cachedCursorDataUrl) return Promise.resolve(cachedCursorDataUrl);
  if (buildInFlight) return buildInFlight;

  buildInFlight = (async () => {
    const src = new URL(busyCursorPath(), document.baseURI).href;
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("cursor image"));
      img.src = src;
    });
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (iw < 1 || ih < 1) throw new Error("cursor image vacía");

    const canvas = document.createElement("canvas");
    canvas.width = CURSOR_PX;
    canvas.height = CURSOR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d");

    ctx.clearRect(0, 0, CURSOR_PX, CURSOR_PX);
    const scale = Math.min(CURSOR_PX / iw, CURSOR_PX / ih);
    const w = iw * scale;
    const h = ih * scale;
    const x = (CURSOR_PX - w) / 2;
    const y = (CURSOR_PX - h) / 2;
    ctx.drawImage(img, x, y, w, h);

    const dataUrl = canvas.toDataURL("image/png");
    cachedCursorDataUrl = dataUrl;
    return dataUrl;
  })().finally(() => {
    buildInFlight = null;
  });

  return buildInFlight;
}

export function preloadBusyCursor(): void {
  void buildCursorDataUrlFromImage().catch(() => {});
}

export function getBusyCursorConfig(): { url: string; hx: number; hy: number } {
  const path = busyCursorPath();
  const url = new URL(path, document.baseURI).href;
  const hs = (import.meta.env.VITE_BUSY_CURSOR_HOTSPOT as string | undefined)?.trim() ?? `${CURSOR_HOTSPOT} ${CURSOR_HOTSPOT}`;
  const parts = hs.split(/[\s,]+/).map((x) => parseInt(x, 10));
  const hx = Number.isFinite(parts[0]) ? parts[0] : CURSOR_HOTSPOT;
  const hy = Number.isFinite(parts[1]) ? parts[1] : CURSOR_HOTSPOT;
  return { url, hx, hy };
}

export function urlCursorBalonSoccer(): string {
  return getBusyCursorConfig().url;
}

const FOLLOWER_ID = "app-busy-cursor-follower";

function ensureFollower(): HTMLElement {
  let el = document.getElementById(FOLLOWER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = FOLLOWER_ID;
    el.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.className = "app-busy-cursor-follower-img";
    el.appendChild(img);
    document.body.appendChild(el);
  }
  el.style.left = `${window.innerWidth / 2}px`;
  el.style.top = `${window.innerHeight / 2}px`;
  return el;
}

function onBusyPointerMove(e: MouseEvent): void {
  const el = document.getElementById(FOLLOWER_ID);
  if (!el) return;
  el.style.left = `${e.clientX}px`;
  el.style.top = `${e.clientY}px`;
}

async function syncFollowerImage(): Promise<void> {
  const el = document.getElementById(FOLLOWER_ID);
  const img = el?.querySelector<HTMLImageElement>(".app-busy-cursor-follower-img");
  if (!img) return;
  try {
    const dataUrl = await buildCursorDataUrlFromImage();
    if (busyDepth < 1) return;
    img.src = dataUrl;
  } catch {
    if (busyDepth < 1) return;
    img.src = new URL(busyCursorPath(), document.baseURI).href;
  }
}

export function beginBusyCursor(): void {
  busyDepth += 1;
  if (busyDepth !== 1) return;
  document.documentElement.classList.add("app-procesando");
  ensureFollower();
  document.addEventListener("pointermove", onBusyPointerMove, { passive: true });
  void syncFollowerImage();
}

export function endBusyCursor(): void {
  busyDepth = Math.max(0, busyDepth - 1);
  if (busyDepth !== 0) return;
  document.removeEventListener("pointermove", onBusyPointerMove);
  document.documentElement.classList.remove("app-procesando");
}

export function runWithBusyCursorSync(run: () => void): void {
  beginBusyCursor();
  requestAnimationFrame(() => {
    try {
      run();
    } finally {
      endBusyCursor();
    }
  });
}

export async function runWithBusyCursorAsync<T>(fn: () => Promise<T>): Promise<T> {
  beginBusyCursor();
  try {
    return await fn();
  } finally {
    endBusyCursor();
  }
}
