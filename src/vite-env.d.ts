/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** UUID del club semilla (debe coincidir con la migración SQL). */
  readonly VITE_CLUB_ID?: string;
  /** Archivo en `public/` (ej. logo.png). Solo letras, números, punto, guiones. */
  readonly VITE_APP_LOGO?: string;
  /**
   * Dominio del email sintético para login por usuario (ej. `mi-club.auth`).
   * El usuario `juan` inicia como `juan@mi-club.auth` en Supabase Auth. Debe coincidir con el email al crear usuarios.
   */
  readonly VITE_AUTH_EMAIL_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
