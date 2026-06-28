-- =====================================================================
-- 06_cloud_onboarding.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Estructura para Onboarding, Invitaciones y Creación Automática de Perfiles
-- =====================================================================

-- 1. Tabla de Invitaciones de Clientes B2B
CREATE TABLE IF NOT EXISTS public.clientes_b2b_invitaciones (
    token VARCHAR(64) PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT false,
    razon_social TEXT NOT NULL,
    email_portal TEXT NOT NULL,
    email_portal_nombre TEXT,
    email_portal_cargo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Activar Row Level Security (RLS)
ALTER TABLE public.clientes_b2b_invitaciones ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para anon y authenticated
DROP POLICY IF EXISTS "Permitir SELECT para anon y authenticated" ON public.clientes_b2b_invitaciones;
CREATE POLICY "Permitir SELECT para anon y authenticated" 
    ON public.clientes_b2b_invitaciones
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir UPDATE para anon y authenticated" ON public.clientes_b2b_invitaciones;
CREATE POLICY "Permitir UPDATE para anon y authenticated" 
    ON public.clientes_b2b_invitaciones
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 3. Trigger Function para automatizar la creación del perfil desde la invitación
CREATE OR REPLACE FUNCTION public.handle_new_b2b_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token text;
    v_cliente_id text;
    v_razon_social text;
    v_email_portal text;
    v_email_portal_nombre text;
    v_email_portal_cargo text;
BEGIN
    -- 1. Extraer el token del raw_user_meta_data del nuevo usuario registrado
    v_token := COALESCE(
        new.raw_user_meta_data ->> 'token',
        new.raw_user_meta_data ->> 'invitation_token'
    );

    IF v_token IS NOT NULL THEN
        -- 2. Buscar datos de la invitación (debe estar activa, no usada y no expirada)
        SELECT cliente_id, razon_social, email_portal, email_portal_nombre, email_portal_cargo
        INTO v_cliente_id, v_razon_social, v_email_portal, v_email_portal_nombre, v_email_portal_cargo
        FROM public.clientes_b2b_invitaciones
        WHERE token = v_token 
          AND usado = false 
          AND expires_at > now();

        -- 3. Si existe una invitación válida, crear el perfil y asignaciones
        IF v_cliente_id IS NOT NULL THEN
            -- Insertar/actualizar el perfil del cliente
            INSERT INTO public.clientes_b2b_perfiles (
                id,
                cliente_id,
                rol,
                permisos,
                nombre_completo,
                nombre_empresa,
                email
            ) VALUES (
                new.id,
                v_cliente_id,
                'Dueno',
                ARRAY['compras', 'pagos']::text[],
                COALESCE(v_email_portal_nombre, new.raw_user_meta_data ->> 'nombre_completo'),
                v_razon_social,
                new.email
            )
            ON CONFLICT (id) DO UPDATE
            SET cliente_id = EXCLUDED.cliente_id,
                rol = EXCLUDED.rol,
                nombre_completo = COALESCE(public.clientes_b2b_perfiles.nombre_completo, EXCLUDED.nombre_completo),
                nombre_empresa = COALESCE(public.clientes_b2b_perfiles.nombre_empresa, EXCLUDED.nombre_empresa),
                email = EXCLUDED.email;

            -- 4. Asignar la lista de precios por defecto (lista_id = 1) en clientes_b2b_perfiles_listas
            INSERT INTO public.clientes_b2b_perfiles_listas (
                cliente_id,
                lista_id,
                es_principal,
                fecha_inicio
            ) VALUES (
                v_cliente_id,
                1,
                true,
                current_date
            )
            ON CONFLICT (cliente_id, lista_id) DO NOTHING;

            -- 5. Marcar la invitación como usada
            UPDATE public.clientes_b2b_invitaciones
            SET usado = true
            WHERE token = v_token;
        END IF;
    END IF;

    RETURN new;
END;
$$;

-- 4. Registrar el trigger en auth.users
DROP TRIGGER IF EXISTS tr_handle_new_b2b_user ON auth.users;
CREATE TRIGGER tr_handle_new_b2b_user
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_b2b_user();
