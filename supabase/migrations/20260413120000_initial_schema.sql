-- Admin canchas: esquema inicial + club semilla + RLS (un club fijo; restringe anon a ese club).
-- Ejecutá este archivo en Supabase → SQL Editor (o con supabase db push).

-- UUID fijo del club por defecto (debe coincidir con VITE_CLUB_ID en el front).
-- Si preferís otro id, cambiá aquí, en las policies y en .env.

-- Tablas ---------------------------------------------------------------------

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.clubs (id, nombre) VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'Club principal');

CREATE TABLE public.jugadores (
  id text PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs (id) ON DELETE CASCADE,
  nombre text NOT NULL,
  posiciones text[] NOT NULL DEFAULT ARRAY['volante']::text[],
  destreza smallint NOT NULL DEFAULT 5 CHECK (destreza BETWEEN 1 AND 10),
  saldo bigint NOT NULL DEFAULT 0,
  es_solo_contabilidad boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jugadores_club_idx ON public.jugadores (club_id);

CREATE TABLE public.movimientos_abono (
  id text PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs (id) ON DELETE CASCADE,
  jugador_id text NOT NULL REFERENCES public.jugadores (id) ON DELETE CASCADE,
  monto bigint NOT NULL,
  fecha timestamptz NOT NULL,
  nota text,
  anulado boolean NOT NULL DEFAULT false
);

CREATE INDEX movimientos_club_idx ON public.movimientos_abono (club_id);
CREATE INDEX movimientos_jugador_idx ON public.movimientos_abono (jugador_id);

CREATE TABLE public.partidos (
  id text PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs (id) ON DELETE CASCADE,
  cancha text NOT NULL CHECK (cancha IN ('1', '2', 'desafio-vs', 'desafio-futbol-11')),
  fecha timestamptz NOT NULL,
  monto_por_jugador bigint NOT NULL,
  valor_arriendo bigint NOT NULL DEFAULT 0,
  resultado_encuentro text CHECK (
    resultado_encuentro IS NULL OR resultado_encuentro IN ('rojo', 'azul', 'empate')
  ),
  jugador_ids text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE INDEX partidos_club_idx ON public.partidos (club_id);

CREATE TABLE public.partido_jugadores (
  partido_id text NOT NULL REFERENCES public.partidos (id) ON DELETE CASCADE,
  jugador_id text NOT NULL REFERENCES public.jugadores (id) ON DELETE CASCADE,
  color_camiseta text NOT NULL CHECK (color_camiseta IN ('rojo', 'azul')),
  PRIMARY KEY (partido_id, jugador_id)
);

CREATE TABLE public.partido_galletas (
  id text PRIMARY KEY,
  partido_id text NOT NULL REFERENCES public.partidos (id) ON DELETE CASCADE,
  nombre text NOT NULL,
  monto bigint NOT NULL,
  cargo_jugador_id text NOT NULL REFERENCES public.jugadores (id) ON DELETE RESTRICT
);

CREATE TABLE public.reglas_equipos_separacion (
  id text PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs (id) ON DELETE CASCADE,
  jugador_a_id text NOT NULL REFERENCES public.jugadores (id) ON DELETE CASCADE,
  jugador_b_id text NOT NULL REFERENCES public.jugadores (id) ON DELETE CASCADE,
  UNIQUE (club_id, jugador_a_id, jugador_b_id),
  CHECK (jugador_a_id <> jugador_b_id)
);

-- RLS --------------------------------------------------------------------------

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_abono ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partido_jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partido_galletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reglas_equipos_separacion ENABLE ROW LEVEL SECURITY;

-- Sustituí el UUID si cambiás el club semilla.
-- anon / authenticated: solo filas del club fijo (MVP). Endurecer con Auth después.

CREATE POLICY clubs_select_seed ON public.clubs
  FOR SELECT TO anon, authenticated
  USING (id = '11111111-1111-1111-1111-111111111111'::uuid);

CREATE POLICY jugadores_all_seed ON public.jugadores
  FOR ALL TO anon, authenticated
  USING (club_id = '11111111-1111-1111-1111-111111111111'::uuid)
  WITH CHECK (club_id = '11111111-1111-1111-1111-111111111111'::uuid);

CREATE POLICY movimientos_all_seed ON public.movimientos_abono
  FOR ALL TO anon, authenticated
  USING (club_id = '11111111-1111-1111-1111-111111111111'::uuid)
  WITH CHECK (club_id = '11111111-1111-1111-1111-111111111111'::uuid);

CREATE POLICY partidos_all_seed ON public.partidos
  FOR ALL TO anon, authenticated
  USING (club_id = '11111111-1111-1111-1111-111111111111'::uuid)
  WITH CHECK (club_id = '11111111-1111-1111-1111-111111111111'::uuid);

CREATE POLICY pj_all_seed ON public.partido_jugadores
  FOR ALL TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_jugadores.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_jugadores.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
  );

CREATE POLICY pg_all_seed ON public.partido_galletas
  FOR ALL TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_galletas.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.partidos p
      WHERE p.id = partido_galletas.partido_id
        AND p.club_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
  );

CREATE POLICY reglas_all_seed ON public.reglas_equipos_separacion
  FOR ALL TO anon, authenticated
  USING (club_id = '11111111-1111-1111-1111-111111111111'::uuid)
  WITH CHECK (club_id = '11111111-1111-1111-1111-111111111111'::uuid);
