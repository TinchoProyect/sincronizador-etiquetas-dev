-- =====================================================================
-- 08_fix_confirm_email_trigger.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Solución definitiva al error 500 (deadlock/lock recursion) al confirmar email
-- y preservación de las listas de precios asignadas en Clientes Búnker.
-- =====================================================================

-- 1. Crear función BEFORE INSERT para auto-confirmar el email e inyectar app_metadata antes de escribir en disco
CREATE OR REPLACE FUNCTION public.auto_confirm_b2b_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token text;
    v_cliente_id text;
    v_listas int[];
BEGIN
    -- Si el metadato contiene el token de invitación B2B o cliente_id, confirmamos al instante
    v_token := COALESCE(
        NEW.raw_user_meta_data ->> 'token',
        NEW.raw_user_meta_data ->> 'invitation_token'
    );
    v_cliente_id := NEW.raw_user_meta_data ->> 'cliente_id';

    IF v_token IS NOT NULL OR v_cliente_id IS NOT NULL THEN
        NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());

        IF v_cliente_id IS NULL AND v_token IS NOT NULL THEN
            SELECT cliente_id INTO v_cliente_id
            FROM public.clientes_b2b_invitaciones
            WHERE token = v_token
            LIMIT 1;
        END IF;

        IF v_cliente_id IS NOT NULL THEN
            SELECT array_agg(lista_id ORDER BY es_principal DESC, lista_id ASC)
            INTO v_listas
            FROM public.clientes_b2b_perfiles_listas
            WHERE cliente_id = v_cliente_id;

            NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
                'cliente_id', v_cliente_id,
                'rol', 'Dueno',
                'permisos', jsonb_build_array('compras', 'pagos'),
                'listas_precios', COALESCE(to_jsonb(v_listas), jsonb_build_array(1))
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Registrar trigger BEFORE INSERT en auth.users
DROP TRIGGER IF EXISTS tr_auto_confirm_b2b_email ON auth.users;
CREATE TRIGGER tr_auto_confirm_b2b_email
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_confirm_b2b_email();


-- 2. Limpiar el trigger AFTER INSERT eliminando la sentencia UPDATE recursiva y evitando pisar listas reales
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
                COALESCE(NULLIF(TRIM(v_email_portal_nombre), ''), new.raw_user_meta_data ->> 'nombre_completo', v_razon_social),
                v_razon_social,
                new.email
            )
            ON CONFLICT (id) DO UPDATE
            SET cliente_id = EXCLUDED.cliente_id,
                rol = EXCLUDED.rol,
                nombre_completo = COALESCE(NULLIF(TRIM(public.clientes_b2b_perfiles.nombre_completo), ''), EXCLUDED.nombre_completo),
                nombre_empresa = COALESCE(public.clientes_b2b_perfiles.nombre_empresa, EXCLUDED.nombre_empresa),
                email = EXCLUDED.email;

            -- 4. Asignar lista de precios por defecto (lista_id = 1) SOLO si el cliente no tiene ya sus listas Búnker sincronizadas
            IF NOT EXISTS (
                SELECT 1 FROM public.clientes_b2b_perfiles_listas WHERE cliente_id = v_cliente_id
            ) THEN
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
            END IF;

            -- 5. Marcar la invitación como usada
            UPDATE public.clientes_b2b_invitaciones
            SET usado = true
            WHERE token = v_token;
        END IF;
    END IF;

    RETURN new;
END;
$$;
