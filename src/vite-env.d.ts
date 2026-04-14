/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** UUID del club semilla (debe coincidir con la migración SQL). */
  readonly VITE_CLUB_ID?: string;
  /** Archivo en `public/` (ej. logo.png). Solo letras, números, punto, guiones. */
  readonly VITE_APP_LOGO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
