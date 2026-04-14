/** Profundidad de operaciones concurrentes que muestran el cursor de espera. */
let busyDepth = 0;

export function urlCursorBalonSoccer(): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${prefix}soccer-cursor.svg`, document.baseURI).href;
}

/** Hotspot al centro del PNG/SVG (32×32). Fallback `wait` ≈ reloj de arena en Windows. */
function cursorCssValue(): string {
  return `url("${urlCursorBalonSoccer()}") 16 16, wait`;
}

export function beginBusyCursor(): void {
  const html = document.documentElement;
  busyDepth += 1;
  if (busyDepth === 1) {
    html.classList.add("app-procesando");
    html.style.setProperty("--app-busy-cursor", cursorCssValue());
  }
}

export function endBusyCursor(): void {
  busyDepth = Math.max(0, busyDepth - 1);
  if (busyDepth === 0) {
    const html = document.documentElement;
    html.classList.remove("app-procesando");
    html.style.removeProperty("--app-busy-cursor");
  }
}

/** Trabajo síncrono pesado: un frame de pintado y luego el cursor durante `run`. */
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
