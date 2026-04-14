# Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor** → ejecutá en orden:
   - `supabase/migrations/20260413120000_initial_schema.sql`
   - `supabase/migrations/20260414120000_perfiles_roles_rls.sql`  
   La segunda migración crea `public.perfiles`, función `app_user_role()` y reemplaza las políticas MVP (ya no se accede a datos con la clave **anon** sin sesión).
3. **Authentication → Providers**: habilitá **Email** (o el proveedor que uses).
4. **Project Settings → API**: copiá `Project URL` y la clave **anon** `public` para el front.
5. En la raíz del repo: `cp .env.example .env` y completá `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_CLUB_ID` (UUID del club semilla, por defecto `11111111-1111-1111-1111-111111111111`).
6. **Login por nombre de usuario:** en `.env` podés definir `VITE_AUTH_EMAIL_DOMAIN` (ej. `mi-club.auth`). Si no lo ponés, se usa `club.auth`. La app convierte el usuario `admin` en el email **`admin@club.auth`** (o `admin@tu-dominio`) para Supabase Auth.
7. Creá usuarios en **Authentication → Users** → **Add user**: en **Email** escribí exactamente ese formato (`nombreusuario@` + el mismo dominio que en `.env`), más la contraseña. Ejemplo con dominio por defecto: email `operador1@club.auth`, contraseña la que quieras. En la pantalla de la app el usuario solo escribe `operador1`.
8. Por cada usuario, insertá su rol en SQL (reemplazá el UUID por el de *Authentication → Users*):

```sql
INSERT INTO public.perfiles (user_id, club_id, rol)
VALUES (
  'UUID-DEL-USUARIO'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'admin'   -- o 'operador' o 'lector'
);
```

9. `npm install` y `npm run dev`. La app pedirá **usuario y contraseña** cuando Supabase esté configurado.

## Roles

| Rol en BD     | Comportamiento resumido |
|---------------|-------------------------|
| `admin`      | Todas las pestañas; borrar partidos; respaldo completo; reemplazo total en guardado. |
| `operador`   | Ve **todas** las pestañas; solo puede **editar** en **Partidos** y **Equipos** (no borrar partidos); el resto es solo lectura; guardado sin `DELETE` masivo sobre `partidos`. |
| `lector`     | Todas las pestañas en solo lectura; en **Equipos** puede **sortear** pero no ve ni edita reglas; el sorteo sigue respetando las reglas guardadas en la base. |

## Importar un `.json` a la base (CLI)

Definí en `.env` la clave **service_role** (solo en tu máquina; **no** la pongas en Vite):

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_CLUB_ID=11111111-1111-1111-1111-111111111111
```

```bash
npm run import-supabase
```

Por defecto lee `public/datos-canchas.json`. Otro archivo:

```bash
npm run import-supabase -- C:/ruta/respaldo.json
```

**Atención:** borra y vuelve a escribir **todo** el contenido del club en Supabase (mismo modelo que «Actualizar datos en Supabase» con rol admin).

Sin `SUPABASE_SERVICE_ROLE_KEY`, el script intenta la clave anon y **puede fallar** por RLS.
