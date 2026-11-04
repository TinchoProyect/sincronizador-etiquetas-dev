-- =====================================================================
-- 02_custom_access_token_hook.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Implementación del Hook de Autenticación con soporte para Roles, Permisos y Multi-Listas
-- =====================================================================

-- NOTA: Este hook debe ser registrado en Supabase como auth hook.
-- Requiere que el esquema 'public' sea accesible por el rol de auth hooks.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios de creador para poder leer public.clientes_b2b_perfiles
SET search_path = public, pg_temp
AS $$
DECLARE
  claims jsonb;
  v_cliente_id text;
  v_rol text;
  v_permisos text[];
  v_listas integer[];
  v_user_id uuid;
BEGIN
  -- Recuperar claims y el ID de usuario desde el evento de autenticación
  claims := event -> 'claims';
  v_user_id := (claims ->> 'sub')::uuid;

  -- 1. Buscar el identificador de cliente (cliente_id), rol y permisos granulares en el perfil
  SELECT cliente_id, rol, permisos
  INTO v_cliente_id, v_rol, v_permisos
  FROM public.clientes_b2b_perfiles
  WHERE id = v_user_id;

  -- 2. Si el perfil existe, buscar todas las listas de precios vigentes asignadas a su empresa (cliente_id)
  IF v_cliente_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(lista_id), '{}'::integer[])
    INTO v_listas
    FROM public.clientes_b2b_perfiles_listas
    WHERE cliente_id = v_cliente_id
      AND (fecha_inicio IS NULL OR fecha_inicio <= CURRENT_DATE)
      AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE);

    -- Inyectar las claims en app_metadata (seguro frente a manipulaciones del frontend)
    claims := jsonb_set(claims, '{app_metadata, cliente_id}', to_jsonb(v_cliente_id));
    claims := jsonb_set(claims, '{app_metadata, rol}', to_jsonb(v_rol));
    claims := jsonb_set(claims, '{app_metadata, permisos}', to_jsonb(v_permisos));
    claims := jsonb_set(claims, '{app_metadata, listas_precios}', to_jsonb(v_listas));
    
    -- También los agregamos a user_metadata de forma informativa para el frontend
    claims := jsonb_set(claims, '{user_metadata, cliente_id}', to_jsonb(v_cliente_id));
    claims := jsonb_set(claims, '{user_metadata, rol}', to_jsonb(v_rol));
    claims := jsonb_set(claims, '{user_metadata, permisos}', to_jsonb(v_permisos));
    claims := jsonb_set(claims, '{user_metadata, listas_precios}', to_jsonb(v_listas));
  END IF;

  -- Volver a guardar claims en el objeto event y retornarlo
  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

-- Otorgar permisos de ejecución al rol de supabase auth admin
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
