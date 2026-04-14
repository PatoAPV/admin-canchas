# Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor** → pegá el contenido de `supabase/migrations/20260413120000_initial_schema.sql` → Run.
3. **Project Settings → API**: copiá `Project URL` y `anon public` key.
4. En la raíz del repo: `cp .env.example .env` y completá `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_CLUB_ID` (el UUID del club semilla del SQL, por defecto `11111111-1111-1111-1111-111111111111`).
5. `npm install` y `npm run dev`.

## Importar un `.json` a la base (CLI)

Con `.env` configurado (mismas variables que la web):

```bash
npm run import-supabase
```

Por defecto lee `public/datos-canchas.json`. Otro archivo:

```bash
npm run import-supabase -- C:/ruta/respaldo.json
```

**Atención:** borra y vuelve a escribir **todo** el contenido del club en Supabase (igual que guardar desde la app).

La app hace **reemplazo completo** de filas del club en cada guardado (mismo modelo que un JSON único). Para producción conviene **Auth + RLS** más estrictas que el MVP con `anon` y club fijo.
