-- Perfiles por usuario (Auth) + RLS por rol: admin | operador | lector.
-- Ejecutá después de la migración inicial. Creá usuarios en Authentication → Users
-- y una fila en public.perfiles por cada uno (ver comentario al final).

-- ---------------------------------------------------------------------------
-- Tabla perfiles
-- ---------------------------------------------------------------------------

CREATE TABLE public.perfiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs (id) ON DELETE CASCADE,
  rol text NOT NULL CHECK (rol IN ('admin', 'operador', 'lector')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX perfiles_club_idx ON public.perfiles (club_id);

ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

-- Rol de la sesión (SECURITY DEFINER para leer perfiles sin depender de policies recursivas)
CREATE OR REPLACE FUNCTION public.app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.rol
  FROM public.perfiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.app_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_role() TO authenticated;

CREATE POLICY perfiles_select_own ON public.perfiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Quitar políticas MVP (anon / authenticated con club fijo)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS clubs_select_seed ON public.clubs;
DROP POLICY IF EXISTS jugadores_all_seed ON public.jugadores;
DROP POLICY IF EXISTS movimientos_all_seed ON public.movimientos_abono;
DROP POLICY IF EXISTS partidos_all_seed ON public.partidos;
DROP POLICY IF EXISTS pj_all_seed ON public.partido_jugadores;
DROP POLICY IF EXISTS pg_all_seed ON public.partido_galletas;
DROP POLICY IF EXISTS reglas_all_seed ON public.reglas_equipos_separacion;

-- ---------------------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------------------

CREATE POLICY clubs_select_auth ON public.clubs
  FOR SELECT TO authenticated
  USING (
    id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- jugadores
-- ---------------------------------------------------------------------------

CREATE POLICY jugadores_select_auth ON public.jugadores
  FOR SELECT TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IS NOT NULL
  );

CREATE POLICY jugadores_insert_auth ON public.jugadores
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  );

CREATE POLICY jugadores_update_auth ON public.jugadores
  FOR UPDATE TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  )
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  );

CREATE POLICY jugadores_delete_admin ON public.jugadores
  FOR DELETE TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- movimientos_abono (solo admin escribe)
-- ---------------------------------------------------------------------------

CREATE POLICY movimientos_select_auth ON public.movimientos_abono
  FOR SELECT TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IS NOT NULL
  );

CREATE POLICY movimientos_insert_admin ON public.movimientos_abono
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() = 'admin'
  );

CREATE POLICY movimientos_update_admin ON public.movimientos_abono
  FOR UPDATE TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() = 'admin'
  )
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() = 'admin'
  );

CREATE POLICY movimientos_delete_admin ON public.movimientos_abono
  FOR DELETE TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- partidos (operador no puede borrar filas de partidos)
-- ---------------------------------------------------------------------------

CREATE POLICY partidos_select_auth ON public.partidos
  FOR SELECT TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IS NOT NULL
  );

CREATE POLICY partidos_insert_auth ON public.partidos
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  );

CREATE POLICY partidos_update_auth ON public.partidos
  FOR UPDATE TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  )
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  );

CREATE POLICY partidos_delete_admin ON public.partidos
  FOR DELETE TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- partido_jugadores / partido_galletas (admin + operador: mantener hijos al editar)
-- ---------------------------------------------------------------------------

CREATE POLICY pj_select_auth ON public.partido_jugadores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_jugadores.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    AND public.app_user_role() IS NOT NULL
  );

CREATE POLICY pj_write_admin_op ON public.partido_jugadores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_jugadores.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    AND public.app_user_role() IN ('admin', 'operador')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_jugadores.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    AND public.app_user_role() IN ('admin', 'operador')
  );

CREATE POLICY pg_select_auth ON public.partido_galletas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_galletas.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    AND public.app_user_role() IS NOT NULL
  );

CREATE POLICY pg_write_admin_op ON public.partido_galletas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_galletas.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    AND public.app_user_role() IN ('admin', 'operador')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_galletas.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    AND public.app_user_role() IN ('admin', 'operador')
  );

-- ---------------------------------------------------------------------------
-- reglas_equipos_separacion
-- ---------------------------------------------------------------------------

CREATE POLICY reglas_select_auth ON public.reglas_equipos_separacion
  FOR SELECT TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IS NOT NULL
  );

CREATE POLICY reglas_write_admin_op ON public.reglas_equipos_separacion
  FOR ALL TO authenticated
  USING (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  )
  WITH CHECK (
    club_id = '11111111-1111-1111-1111-111111111111'::uuid
    AND public.app_user_role() IN ('admin', 'operador')
  );

-- ---------------------------------------------------------------------------
-- Notas de despliegue
-- ---------------------------------------------------------------------------
-- 1) Habilitá Email en Authentication → Providers (o el proveedor que uses).
-- 2) Creá el usuario y copiá su UUID desde Authentication → Users.
-- 3) Insertá el perfil, por ejemplo primer administrador:
--
--    INSERT INTO public.perfiles (user_id, club_id, rol)
--    VALUES (
--      'UUID-DEL-USUARIO-AUTH'::uuid,
--      '11111111-1111-1111-1111-111111111111'::uuid,
--      'admin'
--    );
--
--    operador → rol 'operador' ; solo lectura → rol 'lector'
--
-- 4) La clave anon del front ya no puede leer datos sin sesión: la app exige login.
-- 5) Para import masivo (npm run import-supabase) usá SUPABASE_SERVICE_ROLE_KEY
--    en .env (bypass RLS); no expongas esa clave en el navegador.
