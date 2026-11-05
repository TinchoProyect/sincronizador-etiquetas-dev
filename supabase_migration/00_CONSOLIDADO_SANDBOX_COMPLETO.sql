-- ============================================================================
-- LAMDA B2B SANDBOX — ESQUEMA CONSOLIDADO COMPLETO (GENERADO AUTOMÁTICAMENTE)
-- Fecha de generación: 2026-11-05T15:22:14.633Z
-- Total de archivos integrados: 39
-- Instrucciones: Pegar y ejecutar en el SQL Editor del proyecto lamda-b2b-sandbox
-- ============================================================================


-- ----------------------------------------------------------------------------
-- ARCHIVO: 01_b2b_portal_schema.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 01_b2b_portal_schema.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- DDL para la estructura de datos en Supabase (Fase 1 - Escalabilidad Jerárquica y Multi-Listas)
-- =====================================================================

-- Habilitar extensión uuid-ossp si no está habilitada
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Perfiles de Clientes B2B (Soporta múltiples usuarios por empresa/tenant)
-- Vincula usuarios de Supabase Auth con los clientes del sistema local.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_perfiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    cliente_id TEXT NOT NULL, -- Código de cliente de la distribuidora (no es UNIQUE para permitir sub-usuarios/colaboradores)
    rol TEXT NOT NULL DEFAULT 'Dueno', -- 'Dueno', 'Colaborador'
    permisos TEXT[] NOT NULL DEFAULT '{}', -- Permisos granulares: 'compras', 'pagos', etc.
    nombre_completo TEXT,
    nombre_empresa TEXT,
    cuit TEXT,
    email TEXT,
    creado_por UUID REFERENCES public.clientes_b2b_perfiles(id) ON DELETE SET NULL, -- Referencia al dueño que lo creó
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en perfiles
ALTER TABLE public.clientes_b2b_perfiles ENABLE ROW LEVEL SECURITY;

-- 1b. Tabla Relacional de Listas de Precios Asignadas por Empresa
-- Vincula directamente el cliente_id (empresa) con las listas de precios autorizadas.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_perfiles_listas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id TEXT NOT NULL, -- Vinculado a la empresa (cliente_id de perfiles)
    lista_id INTEGER NOT NULL, -- ID de lista de precios local
    es_principal BOOLEAN DEFAULT false, -- Identifica la lista base
    fecha_inicio DATE, -- Opcional: Fecha de vigencia desde
    fecha_fin DATE, -- Opcional: Fecha de vigencia hasta
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cliente_id, lista_id)
);

-- Habilitar RLS en la tabla de asignación de listas
ALTER TABLE public.clientes_b2b_perfiles_listas ENABLE ROW LEVEL SECURITY;

-- Indexar por cliente_id y fechas para filtrado rápido
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_perfiles_listas_cliente ON public.clientes_b2b_perfiles_listas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_perfiles_listas_vigencia ON public.clientes_b2b_perfiles_listas(fecha_inicio, fecha_fin);

-- 2. Cuentas Corrientes de Clientes
-- Guarda el historial de facturas, pagos, notas de crédito/débito y saldos.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_cuentas_corrientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id TEXT NOT NULL, -- Código de cliente local
    fecha DATE NOT NULL,
    tipo_comprobante TEXT NOT NULL, -- 'FC', 'RC', 'NC', 'ND'
    numero_comprobante TEXT NOT NULL, -- ej: '0001-00001234'
    debe NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    haber NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    saldo NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    comprobante_url TEXT, -- Enlace de descarga del PDF en storage
    local_movimiento_id INTEGER UNIQUE, -- ID único del movimiento en la base local para sincronización
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en cuentas corrientes
ALTER TABLE public.clientes_b2b_cuentas_corrientes ENABLE ROW LEVEL SECURITY;

-- Indexar por cliente_id y fecha para optimizar consultas de la grilla
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_cc_cliente_id ON public.clientes_b2b_cuentas_corrientes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_b2b_cc_fecha ON public.clientes_b2b_cuentas_corrientes(fecha DESC);

-- 3. Pedidos Cabecera (Autogestión y Carrito)
-- Órdenes generadas por los clientes en el portal.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_pedidos_cabecera (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id TEXT NOT NULL, -- Código de cliente local
    fecha_pedido TIMESTAMPTZ DEFAULT NOW(),
    estado TEXT NOT NULL DEFAULT 'Borrador', -- 'Borrador', 'Confirmado', 'En Preparacion', 'Asignado a Chofer', 'En Camino', 'Entregado'
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    descuento NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    observaciones TEXT,
    sync_estado TEXT NOT NULL DEFAULT 'Pendiente', -- 'Pendiente', 'Sincronizado', 'Error'
    sync_mensaje TEXT, -- Detalle de error si falla la sincronización a la oficina local
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en pedidos cabecera
ALTER TABLE public.clientes_b2b_pedidos_cabecera ENABLE ROW LEVEL SECURITY;

-- Indexar pedidos para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_pedidos_b2b_cliente_id ON public.clientes_b2b_pedidos_cabecera(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_b2b_sync_estado ON public.clientes_b2b_pedidos_cabecera(sync_estado);

-- 4. Pedidos Detalles / Ítems
-- Detalle de los artículos pedidos.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_pedidos_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id UUID NOT NULL REFERENCES public.clientes_b2b_pedidos_cabecera(id) ON DELETE CASCADE,
    producto_codigo TEXT NOT NULL, -- Código de artículo local (ej: '20647')
    producto_descripcion TEXT NOT NULL,
    cantidad NUMERIC(12, 2) NOT NULL,
    precio_unitario NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en pedidos items
ALTER TABLE public.clientes_b2b_pedidos_items ENABLE ROW LEVEL SECURITY;

-- Indexar detalles por pedido_id
CREATE INDEX IF NOT EXISTS idx_pedidos_b2b_items_pedido ON public.clientes_b2b_pedidos_items(pedido_id);

-- 5. Catálogo de Artículos y Precios Personalizados
-- Contiene los artículos del sistema local mapeados a su precio y stock correspondiente a cada lista.
CREATE TABLE IF NOT EXISTS public.clientes_b2b_catalogo_precios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lista_id INTEGER NOT NULL, -- ID de lista de precio local
    producto_codigo TEXT NOT NULL,
    producto_descripcion TEXT NOT NULL,
    precio_final NUMERIC(12, 2) NOT NULL,
    stock_disponible NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    rubro TEXT,
    sub_rubro TEXT,
    busqueda_metadata TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(lista_id, producto_codigo)
);

-- Habilitar RLS en catalogo precios
ALTER TABLE public.clientes_b2b_catalogo_precios ENABLE ROW LEVEL SECURITY;

-- Indexar por lista_id para carga veloz del catálogo
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_lista ON public.clientes_b2b_catalogo_precios(lista_id);

-- =====================================================================
-- 6. Tabla de Invitaciones de Onboarding
-- =====================================================================
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

-- Habilitar RLS en invitaciones
ALTER TABLE public.clientes_b2b_invitaciones ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 02_custom_access_token_hook.sql
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- ARCHIVO: 03_rls_policies.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 03_rls_policies.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Políticas de Seguridad a Nivel de Fila (RLS) con soporte para Roles, Permisos y Multi-Listas
-- =====================================================================

-- =====================================================================
-- Helper para chequear si el usuario es el Dueño de la cuenta
-- =====================================================================
-- (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'

-- =====================================================================
-- Helper para chequear si el usuario tiene un permiso específico
-- =====================================================================
-- (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'

-- =====================================================================
-- 1. Políticas para 'clientes_b2b_perfiles'
-- =====================================================================
DROP POLICY IF EXISTS "Usuarios pueden leer perfiles de su misma empresa" ON public.clientes_b2b_perfiles;
CREATE POLICY "Usuarios pueden leer perfiles de su misma empresa" ON public.clientes_b2b_perfiles
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Duenos pueden gestionar colaboradores de su empresa" ON public.clientes_b2b_perfiles;
CREATE POLICY "Duenos pueden gestionar colaboradores de su empresa" ON public.clientes_b2b_perfiles
    FOR ALL
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
    );

-- =====================================================================
-- 1b. Políticas para 'clientes_b2b_perfiles_listas'
-- =====================================================================
DROP POLICY IF EXISTS "Usuarios pueden leer listas de su empresa" ON public.clientes_b2b_perfiles_listas;
CREATE POLICY "Usuarios pueden leer listas de su empresa" ON public.clientes_b2b_perfiles_listas
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

-- =====================================================================
-- 2. Políticas para 'clientes_b2b_cuentas_corrientes' (Requiere permiso de 'pagos' o ser 'Dueno')
-- =====================================================================
DROP POLICY IF EXISTS "Clientes pueden leer su propia cuenta corriente" ON public.clientes_b2b_cuentas_corrientes;
CREATE POLICY "Clientes pueden leer su propia cuenta corriente" ON public.clientes_b2b_cuentas_corrientes
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'pagos'
        )
    );

-- =====================================================================
-- 3. Políticas para 'clientes_b2b_pedidos_cabecera' (Requiere permiso de 'compras' o ser 'Dueno')
-- =====================================================================
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
    );

DROP POLICY IF EXISTS "Clientes pueden crear sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden crear sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR INSERT
    TO authenticated
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
    );

DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado = 'Borrador'
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado = 'Borrador'
    );

-- =====================================================================
-- 4. Políticas para 'clientes_b2b_pedidos_items'
-- =====================================================================
DROP POLICY IF EXISTS "Clientes pueden leer items de sus propios pedidos" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden leer items de sus propios pedidos" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
        )
    );

DROP POLICY IF EXISTS "Clientes pueden agregar items a sus pedidos en borrador" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden agregar items a sus pedidos en borrador" ON public.clientes_b2b_pedidos_items
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
              AND c.estado = 'Borrador'
        )
    );

DROP POLICY IF EXISTS "Clientes pueden modificar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden modificar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
              AND c.estado = 'Borrador'
        )
    );

DROP POLICY IF EXISTS "Clientes pueden eliminar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden eliminar items de sus pedidos en borrador" ON public.clientes_b2b_pedidos_items
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
              AND c.estado = 'Borrador'
        )
    );

-- =====================================================================
-- 5. Políticas para 'clientes_b2b_catalogo_precios' (Requiere compras y listas)
-- =====================================================================
DROP POLICY IF EXISTS "Clientes pueden ver articulos de sus listas asignadas" ON public.clientes_b2b_catalogo_precios;
CREATE POLICY "Clientes pueden ver articulos de sus listas asignadas" ON public.clientes_b2b_catalogo_precios
    FOR SELECT
    TO authenticated
    USING (
        (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND (auth.jwt() -> 'app_metadata' -> 'listas_precios') @> jsonb_build_array(lista_id)
    );


-- ----------------------------------------------------------------------------
-- ARCHIVO: 04_add_rubro_subrubro.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 04_add_rubro_subrubro.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas rubro y sub_rubro a la tabla clientes_b2b_catalogo_precios
-- =====================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios
ADD COLUMN IF NOT EXISTS rubro TEXT,
ADD COLUMN IF NOT EXISTS sub_rubro TEXT;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 05_add_metadatos_cuentas.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 05_add_metadatos_cuentas.sql
-- Agrega la columna 'metadatos' para almacenar la forma de cobro en Supabase
-- =====================================================================

ALTER TABLE public.clientes_b2b_cuentas_corrientes 
ADD COLUMN IF NOT EXISTS metadatos JSONB DEFAULT NULL;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 06_cloud_onboarding.sql
-- ----------------------------------------------------------------------------
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

-- 4. Registrar el trigger AFTER INSERT en auth.users
DROP TRIGGER IF EXISTS tr_handle_new_b2b_user ON auth.users;
CREATE TRIGGER tr_handle_new_b2b_user
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_b2b_user();

-- 5. Trigger BEFORE INSERT para auto-confirmar el email
CREATE OR REPLACE FUNCTION public.auto_confirm_b2b_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (NEW.raw_user_meta_data ->> 'invitation_token') IS NOT NULL 
       OR (NEW.raw_user_meta_data ->> 'token') IS NOT NULL THEN
        NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auto_confirm_b2b_email ON auth.users;
CREATE TRIGGER tr_auto_confirm_b2b_email
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_confirm_b2b_email();


-- ----------------------------------------------------------------------------
-- ARCHIVO: 07_confirm_email_trigger.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 07_confirm_email_trigger.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Modificación del trigger para auto-confirmar el correo del cliente
-- =====================================================================

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

            -- 6. Autoconfirmar correo en auth.users para evitar fricciones de email
            UPDATE auth.users
            SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
                confirmed_at = COALESCE(confirmed_at, now()),
                updated_at = now()
            WHERE id = new.id;
        END IF;
    END IF;

    RETURN new;
END;
$$;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 08_fix_confirm_email_trigger.sql
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- ARCHIVO: 09_add_busqueda_metadata.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 09_add_busqueda_metadata.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columna busqueda_metadata a la tabla clientes_b2b_catalogo_precios
-- =====================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios ADD COLUMN IF NOT EXISTS busqueda_metadata TEXT;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 10_b2b_retiros.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 10_b2b_retiros.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Creación de la tabla de retiros y políticas RLS para check-in
-- =====================================================================

-- 1. Crear Tabla
CREATE TABLE IF NOT EXISTS public.clientes_b2b_retiros (
    id bigint PRIMARY KEY, -- Mapeado al ID de ordenes_tratamiento local
    cliente_id TEXT NOT NULL, -- Código de cliente Búnker (ej: 'CB-0034')
    codigo_qr_hash text NOT NULL UNIQUE,
    estado_logistico text NOT NULL DEFAULT 'PENDIENTE_CLIENTE',
    fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
    
    -- Datos del Check-in (Cliente)
    responsable_nombre text,
    responsable_apellido text,
    responsable_celular text,
    articulo_numero text,
    descripcion_externa text,
    kilos numeric,
    bultos integer,
    motivo text,
    
    -- Datos de Validación (Chofer / ERP)
    chofer_nombre text,
    fecha_validacion_chofer timestamp with time zone,
    id_domicilio_entrega integer,
    id_ruta integer,
    
    -- Control de Sincronización
    sincronizado_local boolean NOT NULL DEFAULT false,
    fecha_sincronizacion_local timestamp with time zone
);

-- Habilitar Seguridad a Nivel de Fila (RLS)
ALTER TABLE public.clientes_b2b_retiros ENABLE ROW LEVEL SECURITY;

-- 2. Políticas RLS
-- Política de Lectura (El cliente puede ver sus propios retiros)
DROP POLICY IF EXISTS "Clientes pueden leer sus propios retiros" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden leer sus propios retiros" ON public.clientes_b2b_retiros
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

-- Política de Check-in (El cliente puede completar o modificar los datos de sus retiros antes de la validación del chofer, o cancelar)
DROP POLICY IF EXISTS "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'CANCELADO')
    );

-- Política de Eliminación (El cliente puede eliminar físicamente retiros en estado pendiente)
DROP POLICY IF EXISTS "Clientes pueden eliminar sus retiros pendientes" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden eliminar sus retiros pendientes" ON public.clientes_b2b_retiros
    FOR DELETE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'CANCELADO')
    );


-- ----------------------------------------------------------------------------
-- ARCHIVO: 11_add_iva_column_pedidos.sql
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS iva NUMERIC(15, 2) DEFAULT 0.00;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 12_add_facturado_column_pedidos.sql
-- ----------------------------------------------------------------------------
-- Migración 12: Agregar columna de facturación para control de inmutabilidad en el portal .com
ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS facturado BOOLEAN DEFAULT false;
ALTER TABLE public.clientes_b2b_pedidos_cabecera ADD COLUMN IF NOT EXISTS es_edicion BOOLEAN DEFAULT false;

-- Actualizar política RLS para permitir modificación (incluyendo anulación) de pedidos activos no facturados
DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador o pendientes de facturar" ON public.clientes_b2b_pedidos_cabecera;

CREATE POLICY "Clientes pueden modificar sus propios pedidos en borrador o pendientes de facturar" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND (estado = 'Borrador' OR estado = 'En Preparacion' OR estado = 'Pendiente')
        AND (facturado IS NULL OR facturado = false)
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND (estado = 'Borrador' OR estado = 'En Preparacion' OR estado = 'Pendiente' OR estado = 'CANCELLED' OR estado = 'Cancelado')
    );


-- ----------------------------------------------------------------------------
-- ARCHIVO: 13_add_recepcion_columns_pedidos.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 13_add_recepcion_columns_pedidos.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas para control de recepción física y políticas RLS públicas
-- =====================================================================

-- 1. Agregar columnas de recepción a la tabla de cabecera de pedidos
ALTER TABLE public.clientes_b2b_pedidos_cabecera 
ADD COLUMN IF NOT EXISTS recibido_por_nombre TEXT,
ADD COLUMN IF NOT EXISTS recibido_por_apellido TEXT,
ADD COLUMN IF NOT EXISTS recibido_por_telefono TEXT,
ADD COLUMN IF NOT EXISTS recibido_fecha TIMESTAMPTZ;

-- 2. Asegurarse de que el RLS esté activo
ALTER TABLE public.clientes_b2b_pedidos_cabecera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_pedidos_items ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS para lectura y actualización anónima/pública por UUID
-- Permitir seleccionar un pedido específico si se conoce su UUID
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Permitir seleccionar los ítems de un pedido específico si se conoce su UUID
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Permitir a usuarios anónimos o autenticados actualizar los campos de recepción de un pedido
DROP POLICY IF EXISTS "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 14_fix_rls_pedidos_privacy.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 14_fix_rls_pedidos_privacy.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Corrección de políticas RLS para evitar fugas de privacidad entre clientes
-- =====================================================================

-- 1. Limpiar la política de lectura pública global hiper-permisiva creada anteriormente
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;

-- =====================================================================
-- 2. POLÍTICAS DE LECTURA (SELECT)
-- =====================================================================

-- CABECERA: Clientes autenticados SOLO pueden leer sus propios pedidos
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
    );

-- CABECERA: Lectura pública/anónima permitida SOLO para usuarios sin sesión (anon) por UUID
DROP POLICY IF EXISTS "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon
    USING (true);

-- ÍTEMS: Clientes autenticados SOLO pueden leer ítems de sus propios pedidos
DROP POLICY IF EXISTS "Clientes pueden leer items de sus propios pedidos" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Clientes pueden leer items de sus propios pedidos" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.clientes_b2b_pedidos_cabecera c 
            WHERE c.id = pedido_id 
              AND c.cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
              AND (
                  (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
                  OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
              )
        )
    );

-- ÍTEMS: Lectura pública/anónima de ítems permitida SOLO para usuarios sin sesión (anon)
DROP POLICY IF EXISTS "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon
    USING (true);


-- =====================================================================
-- 3. POLÍTICAS DE ACTUALIZACIÓN (UPDATE)
-- =====================================================================

-- CABECERA: Clientes autenticados pueden modificar sus propios pedidos en borrador
DROP POLICY IF EXISTS "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Clientes pueden modificar sus propios pedidos en borrador" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado = 'Borrador'
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND (
            (auth.jwt() -> 'app_metadata' ->> 'rol') = 'Dueno'
            OR (auth.jwt() -> 'app_metadata' -> 'permisos') ? 'compras'
        )
        AND estado = 'Borrador'
    );

-- CABECERA: Permitir a usuarios anónimos actualizar recepción por UUID
DROP POLICY IF EXISTS "Permitir actualizacion anonima de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir actualizacion anonima de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

-- CABECERA: Permitir a usuarios autenticados actualizar recepción SOLO si es de su propio cliente
DROP POLICY IF EXISTS "Permitir actualizacion autenticada de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir actualizacion autenticada de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
    );


-- ----------------------------------------------------------------------------
-- ARCHIVO: 15_add_reclamos_columns.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 15_add_reclamos_columns.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas para control de novedades físicas (reclamos) y políticas RLS
-- =====================================================================

-- 1. Agregar columnas de reclamo a la cabecera de pedidos
ALTER TABLE public.clientes_b2b_pedidos_cabecera 
ADD COLUMN IF NOT EXISTS motivo_reclamo_recepcion TEXT,
ADD COLUMN IF NOT EXISTS foto_reclamo_1 TEXT,
ADD COLUMN IF NOT EXISTS foto_reclamo_2 TEXT,
ADD COLUMN IF NOT EXISTS comentarios_recepcion TEXT,
ADD COLUMN IF NOT EXISTS reclamado_fecha TIMESTAMPTZ;

-- 2. Agregar columnas de novedades a los ítems del pedido
ALTER TABLE public.clientes_b2b_pedidos_items
ADD COLUMN IF NOT EXISTS cantidad_recibida NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS motivo_incidencia TEXT,
ADD COLUMN IF NOT EXISTS comentarios TEXT;

-- 3. Habilitar políticas RLS para permitir que clientes anónimos y autenticados actualicen ítems de pedidos
DROP POLICY IF EXISTS "Permitir actualizacion anonima de items por UUID" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir actualizacion anonima de items por UUID" ON public.clientes_b2b_pedidos_items
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 16_add_chofer_delivery_columns.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 16_add_chofer_delivery_columns.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Agregar columnas para registrar por separado la entrega del chofer
-- =====================================================================

ALTER TABLE public.clientes_b2b_pedidos_cabecera 
ADD COLUMN IF NOT EXISTS entregado_chofer_nombre TEXT,
ADD COLUMN IF NOT EXISTS entregado_chofer_fecha TIMESTAMPTZ;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 17_fix_recepcion_rls_uuid.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 17_fix_recepcion_rls_uuid.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite asentar recepción física por UUID a cualquier usuario (anon o autenticado)
-- =====================================================================

-- 1. Eliminar políticas restrictivas de actualización para recepción por UUID
DROP POLICY IF EXISTS "Permitir actualizacion anonima de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir actualizacion autenticada de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera;

-- 2. Crear política unificada de recepción por UUID para usuarios anónimos y autenticados
-- El poseedor del QR físico impreso con el UUID único (secret de 128 bits) tiene la autorización para asentar la recepción
CREATE POLICY "Permitir actualizacion publica de recepcion por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- 3. Asegurar lectura pública de cabecera e ítems por UUID para anon y authenticated
DROP POLICY IF EXISTS "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
CREATE POLICY "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
CREATE POLICY "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon, authenticated
    USING (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 18_fix_b2b_privacy_rls.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 18_fix_b2b_privacy_rls.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Restablece la privacidad total RLS para clientes_b2b_pedidos_cabecera
-- de modo que cada cliente B2B autenticado solo pueda leer sus propios pedidos.
-- =====================================================================

-- 1. Eliminar políticas SELECT obsoletas o permisivas en cabecera
DROP POLICY IF EXISTS "Permitir lectura publica de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Permitir lectura anonima de cabecera por UUID" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera;
DROP POLICY IF EXISTS "Clientes pueden leer sus propios pedidos o por ID" ON public.clientes_b2b_pedidos_cabecera;

-- 2. Crear política SELECT para clientes autenticados (Aislamiento estricto por cliente_id en JWT)
CREATE POLICY "Clientes pueden leer sus propios pedidos" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO authenticated
    USING (
        (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::text = cliente_id::text
        OR
        (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::text = cliente_id::text
    );

-- 3. Crear política SELECT para lectura anónima (QR escaneado en móvil sin iniciar sesión)
CREATE POLICY "Permitir lectura anonima por UUID" ON public.clientes_b2b_pedidos_cabecera
    FOR SELECT
    TO anon
    USING (true);

-- 4. Asegurar RLS en items de pedidos
DROP POLICY IF EXISTS "Permitir lectura publica de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir lectura anonima de items por UUID de cabecera" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Clientes pueden leer los items de sus pedidos" ON public.clientes_b2b_pedidos_items;
DROP POLICY IF EXISTS "Permitir lectura anonima de items" ON public.clientes_b2b_pedidos_items;

CREATE POLICY "Clientes pueden leer los items de sus pedidos" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.clientes_b2b_pedidos_cabecera c
            WHERE c.id = clientes_b2b_pedidos_items.pedido_id
            AND (
                (auth.jwt() -> 'app_metadata' ->> 'cliente_id')::text = c.cliente_id::text
                OR
                (auth.jwt() -> 'user_metadata' ->> 'cliente_id')::text = c.cliente_id::text
            )
        )
    );

CREATE POLICY "Permitir lectura anonima de items" ON public.clientes_b2b_pedidos_items
    FOR SELECT
    TO anon
    USING (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 19_add_familia_articulo_principal.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 19_add_familia_articulo_principal.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Objetivo: Agregar columnas de taxonomía jerárquica (Familia y Atributo Principal)
--           a la tabla de catálogo de precios de clientes B2B.
-- =====================================================================

-- 1. Agregar columnas para la jerarquía del Nomenclador Búnker
ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS familia TEXT,
ADD COLUMN IF NOT EXISTS articulo_principal TEXT;

-- 2. Crear índices para optimización de consultas agrupadas por familia y atributo
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_familia ON public.clientes_b2b_catalogo_precios(familia);
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_art_principal ON public.clientes_b2b_catalogo_precios(articulo_principal);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 20_add_sub_categoria.sql
-- ----------------------------------------------------------------------------
-- ==============================================================================
-- Migración 20: Incorporación de Nivel 3 (sub_categoria) en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS sub_categoria TEXT;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_sub_categoria 
ON public.clientes_b2b_catalogo_precios (sub_categoria);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 21_add_sub_sub_categoria.sql
-- ----------------------------------------------------------------------------
-- ==============================================================================
-- Migración 21: Incorporación de Nivel 4 (sub_sub_categoria) en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS sub_sub_categoria TEXT;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_sub_sub_categoria 
ON public.clientes_b2b_catalogo_precios (sub_sub_categoria);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 22_add_kilos_unidad_precio_kilo.sql
-- ----------------------------------------------------------------------------
-- ==============================================================================
-- Migración 22: Incorporación de kilos_unidad y precio_kilo en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS kilos_unidad NUMERIC(10, 3) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS precio_kilo NUMERIC(15, 2);

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_kilos_unidad 
ON public.clientes_b2b_catalogo_precios (kilos_unidad);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 23_add_iva_toggle_and_incidence.sql
-- ----------------------------------------------------------------------------
-- ==============================================================================
-- Migración 23: Incorporación de alícuotas de IVA y toggle condicional por lista
-- ==============================================================================

-- 1. Campos de IVA y precios netos en catálogo
ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5, 2) DEFAULT 21.00,
ADD COLUMN IF NOT EXISTS precio_neto NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS precio_kilo_neto NUMERIC(15, 2);

-- 2. Indicador de toggle de IVA en listas asignadas al cliente
ALTER TABLE public.clientes_b2b_perfiles_listas 
ADD COLUMN IF NOT EXISTS permitir_toggle_iva BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_iva_porcentaje 
ON public.clientes_b2b_catalogo_precios (iva_porcentaje);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 24_add_sub_sub_sub_categoria.sql
-- ----------------------------------------------------------------------------
-- ==============================================================================
-- Migración 24: Incorporación de sub_sub_sub_categoria (Nivel 5) en Catálogo B2B
-- ==============================================================================

ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS sub_sub_sub_categoria TEXT;

CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_sub_sub_sub_categoria 
ON public.clientes_b2b_catalogo_precios (sub_sub_sub_categoria);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 25_allow_update_b2b_retiros.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 25_allow_update_b2b_retiros.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite la edición continua del Check-in por parte del cliente
-- mientras el retiro no haya sido validado/retirado por el chofer.
-- =====================================================================

-- Reemplazar política de UPDATE para permitir modificación continua
DROP POLICY IF EXISTS "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros;

CREATE POLICY "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico = 'PENDIENTE_VALIDACION'
    );


-- ----------------------------------------------------------------------------
-- ARCHIVO: 26_allow_cancel_delete_b2b_retiros.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 26_allow_cancel_delete_b2b_retiros.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite a los clientes anular/cancelar o eliminar sus propios retiros pendientes
-- =====================================================================

-- 1. Actualizar Política de UPDATE para permitir estado_logistico = 'CANCELADO'
DROP POLICY IF EXISTS "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden completar el checkin de sus retiros" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'CANCELADO')
    );

-- 2. Política de DELETE (Opcional: permitir al cliente eliminar físicamente retiros en PENDIENTE_CLIENTE)
DROP POLICY IF EXISTS "Clientes pueden eliminar sus retiros pendientes" ON public.clientes_b2b_retiros;
CREATE POLICY "Clientes pueden eliminar sus retiros pendientes" ON public.clientes_b2b_retiros
    FOR DELETE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION', 'CANCELADO')
    );


-- ----------------------------------------------------------------------------
-- ARCHIVO: 27_allow_anon_checkin_by_hash.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 27_allow_anon_checkin_by_hash.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Permite a colaboradores anónimos (sin sesión) completar el check-in
-- de un retiro si cuentan con el codigo_qr_hash criptográfico válido.
-- =====================================================================

-- 1. Política de Lectura Anónima para Retiros por Hash Criptográfico
DROP POLICY IF EXISTS "Acceso anonimo para checkin publico por hash" ON public.clientes_b2b_retiros;
CREATE POLICY "Acceso anonimo para checkin publico por hash" ON public.clientes_b2b_retiros
    FOR SELECT
    TO anon
    USING (
        codigo_qr_hash IS NOT NULL 
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    );

-- 2. Política de Modificación Anónima para Check-in por Hash Criptográfico
DROP POLICY IF EXISTS "Actualizacion anonima para checkin publico por hash" ON public.clientes_b2b_retiros;
CREATE POLICY "Actualizacion anonima para checkin publico por hash" ON public.clientes_b2b_retiros
    FOR UPDATE
    TO anon
    USING (
        codigo_qr_hash IS NOT NULL 
        AND estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    )
    WITH CHECK (
        estado_logistico IN ('PENDIENTE_CLIENTE', 'PENDIENTE_VALIDACION')
    );

-- 3. Política de Lectura Anónima para Catálogo de Productos (Búsqueda de Artículos)
DROP POLICY IF EXISTS "Acceso anonimo para busqueda en catalogo" ON public.clientes_b2b_catalogo_precios;
CREATE POLICY "Acceso anonimo para busqueda en catalogo" ON public.clientes_b2b_catalogo_precios
    FOR SELECT
    TO anon
    USING (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 28_b2b_pagos_efectivo.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 28_b2b_pagos_efectivo.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Gestión y Trazabilidad de Pagos en Efectivo Ensobrados
-- =====================================================================

-- 1. Crear Tabla de Pagos en Efectivo Ensobrados
CREATE TABLE IF NOT EXISTS public.clientes_b2b_pagos_efectivo (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    codigo_sobre TEXT NOT NULL UNIQUE,
    cliente_id TEXT NOT NULL,
    monto_declarado NUMERIC(12, 2) NOT NULL CHECK (monto_declarado > 0),
    desglose_billetes JSONB NOT NULL DEFAULT '{}'::jsonb,
    foto_frente_url TEXT NOT NULL,
    foto_dorso_url TEXT NOT NULL,
    modalidad_entrega TEXT NOT NULL DEFAULT 'CHOFER' CHECK (modalidad_entrega IN ('CHOFER', 'LOCAL')),
    estado TEXT NOT NULL DEFAULT 'PREPARADO' CHECK (estado IN ('PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO', 'OBSERVADO', 'CANCELADO')),
    observaciones_cliente TEXT,
    observaciones_admin TEXT,
    local_movimiento_id INTEGER UNIQUE,
    recibo_url TEXT,
    sincronizado_local BOOLEAN NOT NULL DEFAULT false,
    fecha_sincronizacion_local TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_cliente_id ON public.clientes_b2b_pagos_efectivo(cliente_id);
CREATE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_sync ON public.clientes_b2b_pagos_efectivo(sincronizado_local);
CREATE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_estado ON public.clientes_b2b_pagos_efectivo(estado);
CREATE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_codigo ON public.clientes_b2b_pagos_efectivo(codigo_sobre);

-- Habilitar Seguridad a Nivel de Fila (RLS)
ALTER TABLE public.clientes_b2b_pagos_efectivo ENABLE ROW LEVEL SECURITY;

-- 2. Políticas RLS para Clientes Autenticados
DROP POLICY IF EXISTS "Clientes pueden ver sus propios pagos en efectivo" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Clientes pueden ver sus propios pagos en efectivo" ON public.clientes_b2b_pagos_efectivo
    FOR SELECT
    TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Clientes pueden registrar sus propios pagos en efectivo" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Clientes pueden registrar sus propios pagos en efectivo" ON public.clientes_b2b_pagos_efectivo
    FOR INSERT
    TO authenticated
    WITH CHECK (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Clientes pueden modificar o cancelar sobres preparados" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Clientes pueden modificar o cancelar sobres preparados" ON public.clientes_b2b_pagos_efectivo
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado IN ('PREPARADO')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado IN ('PREPARADO', 'CANCELADO')
    );

-- 3. Crear Bucket de Supabase Storage para Fotos de Sobres
INSERT INTO storage.buckets (id, name, public)
VALUES ('sobres_efectivo', 'sobres_efectivo', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de Storage para el Bucket de Sobres
DROP POLICY IF EXISTS "Acceso publico lectura fotos sobres" ON storage.objects;
CREATE POLICY "Acceso publico lectura fotos sobres" ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'sobres_efectivo');

DROP POLICY IF EXISTS "Clientes autenticados pueden subir fotos de sobres" ON storage.objects;
CREATE POLICY "Clientes autenticados pueden subir fotos de sobres" ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'sobres_efectivo');

DROP POLICY IF EXISTS "Clientes autenticados pueden actualizar fotos de sobres" ON storage.objects;
CREATE POLICY "Clientes autenticados pueden actualizar fotos de sobres" ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'sobres_efectivo');


-- ----------------------------------------------------------------------------
-- ARCHIVO: 29_b2b_derivacion_ensobrado_publico.sql
-- ----------------------------------------------------------------------------
-- =====================================================================
-- 29_b2b_derivacion_ensobrado_publico.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Derivación Pública de Gestión de Ensobrado a Colaboradores
-- =====================================================================

-- 1. Modificar restricciones de clientes_b2b_pagos_efectivo
ALTER TABLE public.clientes_b2b_pagos_efectivo
    ALTER COLUMN foto_frente_url DROP NOT NULL,
    ALTER COLUMN foto_dorso_url DROP NOT NULL;

-- 2. Agregar columnas de derivación y token público
ALTER TABLE public.clientes_b2b_pagos_efectivo
    ADD COLUMN IF NOT EXISTS token_publico TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS colaborador_nombre TEXT,
    ADD COLUMN IF NOT EXISTS colaborador_telefono TEXT,
    ADD COLUMN IF NOT EXISTS derivado_por TEXT,
    ADD COLUMN IF NOT EXISTS fecha_derivacion TIMESTAMPTZ;

-- 3. Actualizar CHECK de estado para admitir PENDIENTE_ENSOBRADO
ALTER TABLE public.clientes_b2b_pagos_efectivo
    DROP CONSTRAINT IF EXISTS clientes_b2b_pagos_efectivo_estado_check;

ALTER TABLE public.clientes_b2b_pagos_efectivo
    ADD CONSTRAINT clientes_b2b_pagos_efectivo_estado_check
    CHECK (estado IN ('PENDIENTE_ENSOBRADO', 'PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO', 'OBSERVADO', 'CANCELADO'));

-- 4. Índice para búsquedas por token público
CREATE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_token ON public.clientes_b2b_pagos_efectivo(token_publico);

-- 5. Políticas RLS Públicas para el Colaborador Anónimo
DROP POLICY IF EXISTS "Colaborador publico puede consultar su sobre por token" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Colaborador publico puede consultar su sobre por token" ON public.clientes_b2b_pagos_efectivo
    FOR SELECT
    TO anon, public
    USING (token_publico IS NOT NULL);

DROP POLICY IF EXISTS "Colaborador publico puede completar el ensobrado por token" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Colaborador publico puede completar el ensobrado por token" ON public.clientes_b2b_pagos_efectivo
    FOR UPDATE
    TO anon, public
    USING (token_publico IS NOT NULL AND estado = 'PENDIENTE_ENSOBRADO')
    WITH CHECK (token_publico IS NOT NULL AND estado IN ('PREPARADO', 'PENDIENTE_ENSOBRADO'));

-- 6. Política de subida pública de fotos al bucket sobres_efectivo para colaboradores
DROP POLICY IF EXISTS "Colaboradores publicos pueden subir fotos de sobres" ON storage.objects;
CREATE POLICY "Colaboradores publicos pueden subir fotos de sobres" ON storage.objects
    FOR INSERT
    TO anon, public
    WITH CHECK (bucket_id = 'sobres_efectivo');


-- ----------------------------------------------------------------------------
-- ARCHIVO: 32_b2b_prepedidos_delegaciones.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 32: Delegación de Pre-Pedidos / Modo Mostrador en Portal B2B
-- =========================================================================

-- 1. Tabla de Delegaciones (Enlaces creados por el dueño)
CREATE TABLE IF NOT EXISTS public.clientes_b2b_delegaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id VARCHAR(50) NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    nombre_empresa VARCHAR(200),
    nombre_colaborador VARCHAR(100) NOT NULL DEFAULT 'Colaborador Mostrador',
    mostrar_precios BOOLEAN NOT NULL DEFAULT false,
    tipo_enlace VARCHAR(20) NOT NULL DEFAULT 'permanente', -- 'permanente' | 'unico'
    listas_ids INT[] DEFAULT '{}',
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_b2b_delegaciones_cliente ON public.clientes_b2b_delegaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_b2b_delegaciones_token ON public.clientes_b2b_delegaciones(token);

-- 2. Tabla de Pre-Pedidos (Borradores cargados por el empleado)
CREATE TABLE IF NOT EXISTS public.clientes_b2b_prepedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delegacion_id UUID REFERENCES public.clientes_b2b_delegaciones(id) ON DELETE SET NULL,
    cliente_id VARCHAR(50) NOT NULL,
    colaborador_nombre VARCHAR(100),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    nota_colaborador TEXT,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_revision', -- 'pendiente_revision' | 'incorporado' | 'descartado'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_prepedidos_cliente ON public.clientes_b2b_prepedidos(cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_b2b_prepedidos_delegacion ON public.clientes_b2b_prepedidos(delegacion_id);

-- 3. Habilitar RLS en ambas tablas
ALTER TABLE public.clientes_b2b_delegaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_prepedidos ENABLE ROW LEVEL SECURITY;

-- Políticas para clientes_b2b_delegaciones:
-- a) Clientes autenticados gestionan sus propias delegaciones:
DROP POLICY IF EXISTS "Clientes autenticados gestionan sus delegaciones" ON public.clientes_b2b_delegaciones;
CREATE POLICY "Clientes autenticados gestionan sus delegaciones" ON public.clientes_b2b_delegaciones
    FOR ALL
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    );

-- b) Acceso público anónimo para consultar delegación por token (solo si está activa):
DROP POLICY IF EXISTS "Acceso publico para validar token de delegacion" ON public.clientes_b2b_delegaciones;
CREATE POLICY "Acceso publico para validar token de delegacion" ON public.clientes_b2b_delegaciones
    FOR SELECT
    TO anon
    USING (
        activo = true
        AND (expires_at IS NULL OR expires_at > now())
    );

-- c) Rol anónimo puede desactivar delegación si era de un solo uso (actualizar activo a false):
DROP POLICY IF EXISTS "Acceso publico para cerrar delegacion de un solo uso" ON public.clientes_b2b_delegaciones;
CREATE POLICY "Acceso publico para cerrar delegacion de un solo uso" ON public.clientes_b2b_delegaciones
    FOR UPDATE
    TO anon
    USING (
        tipo_enlace = 'unico'
        AND activo = true
    )
    WITH CHECK (
        activo = false
    );

-- Políticas para clientes_b2b_prepedidos:
-- a) Clientes autenticados ven y gestionan los pre-pedidos de su comercio:
DROP POLICY IF EXISTS "Clientes autenticados gestionan sus prepedidos" ON public.clientes_b2b_prepedidos;
CREATE POLICY "Clientes autenticados gestionan sus prepedidos" ON public.clientes_b2b_prepedidos
    FOR ALL
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    );

-- b) Rol anónimo puede insertar pre-pedidos (enviar el borrador desde mostrador):
DROP POLICY IF EXISTS "Acceso publico para insertar prepedidos" ON public.clientes_b2b_prepedidos;
CREATE POLICY "Acceso publico para insertar prepedidos" ON public.clientes_b2b_prepedidos
    FOR INSERT
    TO anon
    WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 33_b2b_articulos_habituales.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 33: Artículos Favoritos / Habituales en Portal B2B (.com)
-- =========================================================================

-- 1. Tabla de Artículos Habituales por Cliente
CREATE TABLE IF NOT EXISTS public.clientes_b2b_articulos_habituales (
    id BIGSERIAL PRIMARY KEY,
    cliente_id VARCHAR(50) NOT NULL,
    producto_codigo VARCHAR(100) NOT NULL,
    frecuencia_compra INTEGER NOT NULL DEFAULT 1,
    ultima_compra TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unq_b2b_habituales_cliente_prod UNIQUE (cliente_id, producto_codigo)
);

CREATE INDEX IF NOT EXISTS idx_b2b_habituales_cliente ON public.clientes_b2b_articulos_habituales(cliente_id);
CREATE INDEX IF NOT EXISTS idx_b2b_habituales_prod ON public.clientes_b2b_articulos_habituales(producto_codigo);

-- 2. Habilitar RLS
ALTER TABLE public.clientes_b2b_articulos_habituales ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS:
-- a) Clientes autenticados leen sus propios habituales
DROP POLICY IF EXISTS "Clientes autenticados leen sus habituales" ON public.clientes_b2b_articulos_habituales;
CREATE POLICY "Clientes autenticados leen sus habituales" ON public.clientes_b2b_articulos_habituales
    FOR SELECT
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        OR cliente_id = (auth.jwt() -> 'user_metadata' ->> 'cliente_id')
    );

-- b) Acceso anónimo público de lectura (para colaboradores de pre-pedido)
DROP POLICY IF EXISTS "Acceso publico para lectura de habituales" ON public.clientes_b2b_articulos_habituales;
CREATE POLICY "Acceso publico para lectura de habituales" ON public.clientes_b2b_articulos_habituales
    FOR SELECT
    TO anon
    USING (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 34_add_mostrar_sin_iva_delegaciones.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 34: Modalidad de IVA para Enlaces de Delegación en Portal B2B
-- =========================================================================

-- Agregar columna mostrar_sin_iva a clientes_b2b_delegaciones (por defecto false = Con IVA Incluido)
ALTER TABLE public.clientes_b2b_delegaciones 
ADD COLUMN IF NOT EXISTS mostrar_sin_iva BOOLEAN NOT NULL DEFAULT false;


-- ----------------------------------------------------------------------------
-- ARCHIVO: 35_b2b_politicas_comerciales.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migracion 35: Politicas Comerciales y Descuentos Escalonados en Portal B2B
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.clientes_b2b_politicas_comerciales (
    id SERIAL PRIMARY KEY,
    politica_id INTEGER NOT NULL UNIQUE,
    lista_id INTEGER NOT NULL,
    lista_nombre TEXT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    tipo_calculo TEXT NOT NULL DEFAULT 'ESCALA_DIRECTA',
    aplica_sobre TEXT NOT NULL DEFAULT 'NETO',
    activo BOOLEAN NOT NULL DEFAULT true,
    tramos JSONB NOT NULL DEFAULT '[]'::jsonb,
    excepciones JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_b2b_politicas_lista_id ON public.clientes_b2b_politicas_comerciales(lista_id);
CREATE INDEX IF NOT EXISTS idx_b2b_politicas_activo ON public.clientes_b2b_politicas_comerciales(activo);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.clientes_b2b_politicas_comerciales ENABLE ROW LEVEL SECURITY;

-- 1. Politica de lectura para clientes autenticados (solo politicas activas)
DROP POLICY IF EXISTS "Lectura de politicas activas para usuarios autenticados" ON public.clientes_b2b_politicas_comerciales;
CREATE POLICY "Lectura de politicas activas para usuarios autenticados" 
ON public.clientes_b2b_politicas_comerciales
FOR SELECT 
TO authenticated 
USING (activo = true);

-- 2. Politica completa para el rol de servicio / daemon sincronizador
DROP POLICY IF EXISTS "Acceso total para service_role en politicas comerciales" ON public.clientes_b2b_politicas_comerciales;
CREATE POLICY "Acceso total para service_role en politicas comerciales" 
ON public.clientes_b2b_politicas_comerciales
FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 36_add_ver_stock_and_estado.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 36: Visualización de Stock y Estados en Portal B2B
-- =========================================================================

-- 1. Agregar columna ver_stock a perfiles B2B (por defecto false)
ALTER TABLE public.clientes_b2b_perfiles 
ADD COLUMN IF NOT EXISTS ver_stock BOOLEAN DEFAULT FALSE;

-- 2. Agregar columna stock_estado al catálogo B2B (disponible, requiere_produccion, sin_stock)
ALTER TABLE public.clientes_b2b_catalogo_precios 
ADD COLUMN IF NOT EXISTS stock_estado VARCHAR(30) DEFAULT 'disponible';

-- Índice para acelerar consultas filtradas o agrupadas
CREATE INDEX IF NOT EXISTS idx_b2b_catalogo_stock_estado 
ON public.clientes_b2b_catalogo_precios (stock_estado);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 37_b2b_ofertas_dinamicas.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 37: Ofertas Dinámicas y Cuotas Promocionales en Portal B2B
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.clientes_b2b_ofertas_activas (
    id SERIAL PRIMARY KEY,
    oferta_id INTEGER NOT NULL UNIQUE,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    unidad_cuota TEXT NOT NULL DEFAULT 'KILOS',
    cuota_total NUMERIC(12,2) NOT NULL,
    cuota_consumida NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    cuota_disponible NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    condicion_cierre TEXT NOT NULL DEFAULT 'HASTA_AGOTAR_STOCK',
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    tipo_beneficio TEXT NOT NULL DEFAULT 'PORCENTAJE',
    descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    no_acumulable_con_politica BOOLEAN NOT NULL DEFAULT true,
    activo BOOLEAN NOT NULL DEFAULT true,
    estado TEXT NOT NULL DEFAULT 'ACTIVA',
    articulos JSONB NOT NULL DEFAULT '[]'::jsonb,
    listas_ids INTEGER[] NOT NULL DEFAULT '{}',
    excepciones JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_b2b_ofertas_activo_estado ON public.clientes_b2b_ofertas_activas(activo, estado);
CREATE INDEX IF NOT EXISTS idx_b2b_ofertas_listas_ids ON public.clientes_b2b_ofertas_activas USING GIN (listas_ids);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.clientes_b2b_ofertas_activas ENABLE ROW LEVEL SECURITY;

-- 1. Política de lectura para usuarios autenticados (solo ofertas activas)
DROP POLICY IF EXISTS "Lectura de ofertas activas para usuarios autenticados" ON public.clientes_b2b_ofertas_activas;
CREATE POLICY "Lectura de ofertas activas para usuarios autenticados"
ON public.clientes_b2b_ofertas_activas
FOR SELECT
TO authenticated
USING (
    activo = true 
    AND estado = 'ACTIVA' 
    AND cuota_disponible > 0
    AND (fecha_fin IS NULL OR fecha_fin >= NOW())
);

-- 2. Política de acceso total para service_role (sincronizador local)
DROP POLICY IF EXISTS "Acceso total para service_role en ofertas activas" ON public.clientes_b2b_ofertas_activas;
CREATE POLICY "Acceso total para service_role en ofertas activas"
ON public.clientes_b2b_ofertas_activas
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 38_b2b_modulo_colaborador.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 38: Módulo Exclusivo Colaborador (Servicios, Tarifario y Jornadas)
-- Cliente VIP: Matías (CB-0006) / Rol Híbrido Cliente + Prestador de Servicios
-- =========================================================================

-- 1. Tabla de Tarifas Sincronizadas (Horaria y Rendimiento)
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_tarifas (
    id SERIAL PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('HORA', 'RENDIMIENTO')),
    articulo_codigo TEXT,
    articulo_descripcion TEXT,
    unidad_medida TEXT NOT NULL DEFAULT 'kg',
    valor NUMERIC(12, 2) NOT NULL,
    fecha_desde TIMESTAMPTZ,
    fecha_hasta TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_b2b_colab_tarifas_cliente ON public.clientes_b2b_colaboradores_tarifas(cliente_id, activo);

-- 2. Tabla de Jornadas de Depósito / Taller
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_jornadas (
    id SERIAL PRIMARY KEY,
    local_jornada_id INTEGER UNIQUE NOT NULL,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha_ingreso TIMESTAMPTZ NOT NULL,
    fecha_egreso TIMESTAMPTZ,
    horas_totales NUMERIC(6, 2) DEFAULT 0.00,
    minutos_totales INTEGER DEFAULT 0,
    valor_hora_aplicado NUMERIC(12, 2) NOT NULL,
    monto_total NUMERIC(12, 2) NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('EN_CURSO', 'FINALIZADA', 'LIQUIDADA')),
    liquidada_en TIMESTAMPTZ,
    cuenta_corriente_movimiento_id INTEGER,
    observacion_ingreso TEXT,
    observacion_egreso TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_colab_jornadas_cliente_estado ON public.clientes_b2b_colaboradores_jornadas(cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_b2b_colab_jornadas_fecha ON public.clientes_b2b_colaboradores_jornadas(fecha_ingreso DESC);

-- 3. Tabla de Producciones Externas / Carros
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_producciones (
    id SERIAL PRIMARY KEY,
    local_produccion_id INTEGER UNIQUE NOT NULL,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    carro_id INTEGER,
    articulo_padre_id TEXT,
    articulo_padre_descripcion TEXT,
    articulo_fraccionado_id TEXT,
    articulo_fraccionado_descripcion TEXT,
    kilos_entrada NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    kilos_salida NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    kilos_producidos NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    porcentaje_merma NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    fecha_registro TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_b2b_colab_prod_cliente ON public.clientes_b2b_colaboradores_producciones(cliente_id, fecha_registro DESC);

-- 4. Tabla de Solicitudes y Propuestas de Ajuste de Tarifas
CREATE TABLE IF NOT EXISTS public.clientes_b2b_colaboradores_solicitudes (
    id SERIAL PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('TARIFA_HORA', 'TARIFA_RENDIMIENTO')),
    articulo_codigo TEXT,
    articulo_descripcion TEXT,
    valor_propuesto NUMERIC(12, 2) NOT NULL,
    valor_anterior NUMERIC(12, 2),
    unidad_medida TEXT,
    motivo TEXT,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revisado_en TIMESTAMPTZ,
    revisado_por TEXT
);

CREATE INDEX IF NOT EXISTS idx_b2b_colab_solicitudes_cliente ON public.clientes_b2b_colaboradores_solicitudes(cliente_id, estado);

-- =========================================================================
-- SEGURIDAD: Habilitar RLS en todas las tablas expuestas
-- =========================================================================
ALTER TABLE public.clientes_b2b_colaboradores_tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_colaboradores_jornadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_colaboradores_producciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes_b2b_colaboradores_solicitudes ENABLE ROW LEVEL SECURITY;

-- Políticas SELECT: Solo el colaborador autenticado con su cliente_id puede leer sus registros
DROP POLICY IF EXISTS "Colaborador lee sus propias tarifas" ON public.clientes_b2b_colaboradores_tarifas;
CREATE POLICY "Colaborador lee sus propias tarifas" ON public.clientes_b2b_colaboradores_tarifas
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador lee sus propias jornadas" ON public.clientes_b2b_colaboradores_jornadas;
CREATE POLICY "Colaborador lee sus propias jornadas" ON public.clientes_b2b_colaboradores_jornadas
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador lee sus producciones" ON public.clientes_b2b_colaboradores_producciones;
CREATE POLICY "Colaborador lee sus producciones" ON public.clientes_b2b_colaboradores_producciones
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador lee sus solicitudes" ON public.clientes_b2b_colaboradores_solicitudes;
CREATE POLICY "Colaborador lee sus solicitudes" ON public.clientes_b2b_colaboradores_solicitudes
    FOR SELECT TO authenticated
    USING (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

DROP POLICY IF EXISTS "Colaborador inserta solicitudes de tarifas" ON public.clientes_b2b_colaboradores_solicitudes;
CREATE POLICY "Colaborador inserta solicitudes de tarifas" ON public.clientes_b2b_colaboradores_solicitudes
    FOR INSERT TO authenticated
    WITH CHECK (cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id'));

-- Políticas ALL: Service role (backend local) tiene acceso total
DROP POLICY IF EXISTS "Service role gestiona tarifas" ON public.clientes_b2b_colaboradores_tarifas;
CREATE POLICY "Service role gestiona tarifas" ON public.clientes_b2b_colaboradores_tarifas FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role gestiona jornadas" ON public.clientes_b2b_colaboradores_jornadas;
CREATE POLICY "Service role gestiona jornadas" ON public.clientes_b2b_colaboradores_jornadas FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role gestiona producciones" ON public.clientes_b2b_colaboradores_producciones;
CREATE POLICY "Service role gestiona producciones" ON public.clientes_b2b_colaboradores_producciones FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role gestiona solicitudes" ON public.clientes_b2b_colaboradores_solicitudes;
CREATE POLICY "Service role gestiona solicitudes" ON public.clientes_b2b_colaboradores_solicitudes FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 39_b2b_articulos_kits.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 39: Kits de Insumos para Producción Externa (UP / Barritas)
-- Vinculación a nivel USUARIO ESPECÍFICO (clientes_b2b_perfiles)
-- =========================================================================

-- 1. Agregar flag de habilitación de kits a nivel perfil de usuario
ALTER TABLE public.clientes_b2b_perfiles 
ADD COLUMN IF NOT EXISTS habilitar_kits_produccion BOOLEAN DEFAULT false;

-- Habilitar exclusivamente para Matías (CB-0006)
UPDATE public.clientes_b2b_perfiles 
SET habilitar_kits_produccion = true,
    permisos = array_append(array_remove(permisos, 'habilitar_kits_produccion'), 'habilitar_kits_produccion')
WHERE cliente_id = 'CB-0006';

-- 2. Tabla maestra de definición de kits de insumos
CREATE TABLE IF NOT EXISTS public.clientes_b2b_articulos_kits (
    id SERIAL PRIMARY KEY,
    producto_codigo TEXT NOT NULL,
    up_codigo TEXT,
    ingrediente_id INTEGER NOT NULL,
    ingrediente_codigo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    unidad_medida TEXT NOT NULL DEFAULT 'Kilo',
    cantidad_ratio NUMERIC(12, 4) NOT NULL,
    costo_base NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    iva_porcentaje NUMERIC(6, 2) NOT NULL DEFAULT 21.00,
    precio_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_b2b_kit_producto_ingrediente UNIQUE (producto_codigo, ingrediente_id)
);

CREATE INDEX IF NOT EXISTS idx_b2b_articulos_kits_prod ON public.clientes_b2b_articulos_kits(producto_codigo, activo);

-- 3. Habilitar RLS
ALTER TABLE public.clientes_b2b_articulos_kits ENABLE ROW LEVEL SECURITY;

-- 4. Política de lectura: abierta para lectura de kits de catálogo
DROP POLICY IF EXISTS "Lectura de kits para usuarios autenticados" ON public.clientes_b2b_articulos_kits;
DROP POLICY IF EXISTS "Lectura de kits para todos" ON public.clientes_b2b_articulos_kits;
CREATE POLICY "Lectura de kits para todos" 
ON public.clientes_b2b_articulos_kits 
FOR SELECT 
USING (true);

-- Política de escritura: service_role / postgres
DROP POLICY IF EXISTS "Escritura completa para service_role" ON public.clientes_b2b_articulos_kits;
CREATE POLICY "Escritura completa para service_role" 
ON public.clientes_b2b_articulos_kits 
FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- ARCHIVO: 40_b2b_catalogo_fotos_lote.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- 40_b2b_catalogo_fotos_lote.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Inspección Visual de Partidas en Depósito (Fotos Dinámicas por Lote)
-- =========================================================================

-- 1. Agregar columna imagenes_lote al catálogo de precios B2B
ALTER TABLE public.clientes_b2b_catalogo_precios
ADD COLUMN IF NOT EXISTS imagenes_lote JSONB DEFAULT NULL;

-- 2. Crear Bucket Público de Supabase Storage para Fotos de Partidas / Lotes
INSERT INTO storage.buckets (id, name, public)
VALUES ('b2b_lotes_fotos', 'b2b_lotes_fotos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Políticas RLS para lectura pública del Bucket de Fotos de Partidas
DROP POLICY IF EXISTS "Acceso publico lectura fotos partidas b2b" ON storage.objects;
CREATE POLICY "Acceso publico lectura fotos partidas b2b" ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'b2b_lotes_fotos');

DROP POLICY IF EXISTS "Service role gestion completa fotos partidas b2b" ON storage.objects;
CREATE POLICY "Service role gestion completa fotos partidas b2b" ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'b2b_lotes_fotos')
    WITH CHECK (bucket_id = 'b2b_lotes_fotos');


-- ----------------------------------------------------------------------------
-- ARCHIVO: 41_b2b_prepedidos_aprobacion_y_candado.sql
-- ----------------------------------------------------------------------------
-- =========================================================================
-- Migración 41: Pre-Pedidos con Candado de Dispositivo (Device Binding)
-- y Flujo de Revisión/Aprobación Directa sin Login Previo
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- =========================================================================

-- 1. Ampliar tabla public.clientes_b2b_delegaciones con metadatos de contacto,
--    candado criptográfico de dispositivo y permisos de catálogo
ALTER TABLE public.clientes_b2b_delegaciones
ADD COLUMN IF NOT EXISTS telefono_colaborador VARCHAR(40) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS aprobador_nombre VARCHAR(100) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS aprobador_telefono VARCHAR(40) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS dispositivo_vinculado_hash VARCHAR(128) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS dispositivo_vinculado_en TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ver_stock BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS permitir_toggle_iva BOOLEAN NOT NULL DEFAULT true;

-- 2. Ampliar tabla public.clientes_b2b_prepedidos con token de aprobación directa
--    y trazabilidad del pedido confirmado resultante
ALTER TABLE public.clientes_b2b_prepedidos
ADD COLUMN IF NOT EXISTS token_aprobacion VARCHAR(64) UNIQUE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS aprobador_nombre VARCHAR(100) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS aprobador_telefono VARCHAR(40) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS descuento_porcentaje NUMERIC(5,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS total_estimado NUMERIC(14,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS pedido_confirmado_id UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS confirmado_en TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_b2b_prepedidos_token_aprobacion
ON public.clientes_b2b_prepedidos(token_aprobacion);

-- 3. Permitir lectura pública (anon) de ofertas activas y políticas comerciales activas
--    para que la vista de pre-armado de artículos evalúe promociones y bonificaciones por volumen
DROP POLICY IF EXISTS "Lectura publica de politicas activas para prepedidos" ON public.clientes_b2b_politicas_comerciales;
CREATE POLICY "Lectura publica de politicas activas para prepedidos"
ON public.clientes_b2b_politicas_comerciales
FOR SELECT
TO anon
USING (activo = true);

DROP POLICY IF EXISTS "Lectura publica de ofertas activas para prepedidos" ON public.clientes_b2b_ofertas_activas;
CREATE POLICY "Lectura publica de ofertas activas para prepedidos"
ON public.clientes_b2b_ofertas_activas
FOR SELECT
TO anon
USING (
    activo = true
    AND estado = 'ACTIVA'
    AND cuota_disponible > 0
    AND (fecha_fin IS NULL OR fecha_fin >= NOW())
);

-- 4. Permitir lectura de artículos habituales para rol anon (filtrado por cliente_id en consulta)
ALTER TABLE public.clientes_b2b_articulos_habituales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lectura publica de articulos habituales para prepedidos" ON public.clientes_b2b_articulos_habituales;
CREATE POLICY "Lectura publica de articulos habituales para prepedidos"
ON public.clientes_b2b_articulos_habituales
FOR SELECT
TO anon
USING (true);

-- =========================================================================
-- 5. Función RPC SECURITY DEFINER: Validar y Vincular Dispositivo de Operador
-- =========================================================================
CREATE OR REPLACE FUNCTION public.validar_y_vincular_delegacion_b2b(
    p_token TEXT,
    p_ultimos_digitos TEXT DEFAULT NULL,
    p_device_secret TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_del RECORD;
    v_tel_clean TEXT;
    v_ultimos_4 TEXT;
    v_input_4 TEXT;
BEGIN
    IF p_token IS NULL OR trim(p_token) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se proporcionó un token de acceso válido.');
    END IF;

    SELECT *
    INTO v_del
    FROM public.clientes_b2b_delegaciones
    WHERE token = trim(p_token)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'El enlace de acceso no existe o fue revocado.');
    END IF;

    IF NOT v_del.activo THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este enlace de pre-pedido ya fue utilizado o se encuentra desactivado.');
    END IF;

    IF v_del.expires_at IS NOT NULL AND v_del.expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este enlace de pre-pedido ha expirado.');
    END IF;

    v_tel_clean := regexp_replace(COALESCE(v_del.telefono_colaborador, ''), '[^0-9]', '', 'g');

    -- Si la delegación tiene teléfono de operador asignado, aplicar candado de dispositivo (Device Binding)
    IF length(v_tel_clean) >= 4 THEN
        v_ultimos_4 := right(v_tel_clean, 4);

        -- Caso A: El enlace ya tiene un dispositivo vinculado
        IF v_del.dispositivo_vinculado_hash IS NOT NULL AND trim(v_del.dispositivo_vinculado_hash) <> '' THEN
            IF p_device_secret IS NULL OR trim(p_device_secret) <> trim(v_del.dispositivo_vinculado_hash) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'vinculado_otro_dispositivo', true,
                    'error', 'Acceso restringido: este enlace personal es intransferible y ya se encuentra vinculado al teléfono móvil registrado del operador.'
                );
            END IF;
        ELSE
            -- Caso B: Primera apertura (aún sin dispositivo vinculado)
            v_input_4 := regexp_replace(COALESCE(p_ultimos_digitos, ''), '[^0-9]', '', 'g');

            IF v_input_4 IS NULL OR length(v_input_4) <> 4 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'requiere_validacion_telefono', true,
                    'nombre_empresa', v_del.nombre_empresa,
                    'nombre_colaborador', v_del.nombre_colaborador,
                    'telefono_mascara', '***-***-**' || right(v_tel_clean, 2)
                );
            END IF;

            IF v_input_4 <> v_ultimos_4 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'requiere_validacion_telefono', true,
                    'codigo_incorrecto', true,
                    'nombre_empresa', v_del.nombre_empresa,
                    'nombre_colaborador', v_del.nombre_colaborador,
                    'telefono_mascara', '***-***-**' || right(v_tel_clean, 2),
                    'error', 'Los últimos 4 dígitos ingresados no coinciden con el número de teléfono registrado para este operador.'
                );
            END IF;

            -- Si validó los 4 dígitos y envió device_secret, sellar el dispositivo
            IF p_device_secret IS NOT NULL AND length(trim(p_device_secret)) >= 16 THEN
                UPDATE public.clientes_b2b_delegaciones
                SET dispositivo_vinculado_hash = trim(p_device_secret),
                    dispositivo_vinculado_en = NOW(),
                    updated_at = NOW()
                WHERE id = v_del.id;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'delegacion', jsonb_build_object(
            'id', v_del.id,
            'cliente_id', v_del.cliente_id,
            'token', v_del.token,
            'nombre_empresa', v_del.nombre_empresa,
            'nombre_colaborador', v_del.nombre_colaborador,
            'telefono_colaborador', v_del.telefono_colaborador,
            'aprobador_nombre', v_del.aprobador_nombre,
            'aprobador_telefono', v_del.aprobador_telefono,
            'mostrar_precios', v_del.mostrar_precios,
            'mostrar_sin_iva', v_del.mostrar_sin_iva,
            'permitir_toggle_iva', COALESCE(v_del.permitir_toggle_iva, true),
            'ver_stock', COALESCE(v_del.ver_stock, false),
            'tipo_enlace', v_del.tipo_enlace,
            'listas_ids', v_del.listas_ids,
            'activo', v_del.activo
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validar_y_vincular_delegacion_b2b(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- =========================================================================
-- 6. Función RPC SECURITY DEFINER: Obtener Pre-Pedido por Token de Aprobación
-- =========================================================================
CREATE OR REPLACE FUNCTION public.obtener_prepedido_por_token_aprobacion(
    p_token_aprobacion TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prep RECORD;
    v_del RECORD;
    v_listas INT[];
    v_nombre_empresa TEXT;
    v_ver_stock BOOLEAN := false;
BEGIN
    IF p_token_aprobacion IS NULL OR trim(p_token_aprobacion) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Código de revisión inválido.');
    END IF;

    SELECT *
    INTO v_prep
    FROM public.clientes_b2b_prepedidos
    WHERE token_aprobacion = trim(p_token_aprobacion)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'La propuesta de pedido no existe o el enlace es inválido.');
    END IF;

    IF v_prep.delegacion_id IS NOT NULL THEN
        SELECT *
        INTO v_del
        FROM public.clientes_b2b_delegaciones
        WHERE id = v_prep.delegacion_id
        LIMIT 1;
    END IF;

    v_listas := COALESCE(v_del.listas_ids, '{}'::INT[]);
    v_nombre_empresa := COALESCE(v_del.nombre_empresa, 'Comercio B2B');
    v_ver_stock := COALESCE(v_del.ver_stock, false);

    IF array_length(v_listas, 1) IS NULL THEN
        SELECT COALESCE(array_agg(lista_id), '{}'::INT[])
        INTO v_listas
        FROM public.clientes_b2b_perfiles_listas
        WHERE cliente_id = v_prep.cliente_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'prepedido', jsonb_build_object(
            'id', v_prep.id,
            'delegacion_id', v_prep.delegacion_id,
            'cliente_id', v_prep.cliente_id,
            'nombre_empresa', v_nombre_empresa,
            'colaborador_nombre', v_prep.colaborador_nombre,
            'aprobador_nombre', v_prep.aprobador_nombre,
            'aprobador_telefono', v_prep.aprobador_telefono,
            'items', v_prep.items,
            'nota_colaborador', v_prep.nota_colaborador,
            'estado', v_prep.estado,
            'descuento_porcentaje', COALESCE(v_prep.descuento_porcentaje, 0),
            'total_estimado', COALESCE(v_prep.total_estimado, 0),
            'pedido_confirmado_id', v_prep.pedido_confirmado_id,
            'confirmado_en', v_prep.confirmado_en,
            'created_at', v_prep.created_at,
            'listas_ids', v_listas,
            'mostrar_sin_iva', COALESCE(v_del.mostrar_sin_iva, false),
            'ver_stock', v_ver_stock
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_prepedido_por_token_aprobacion(TEXT) TO anon, authenticated, service_role;

-- =========================================================================
-- 7. Función RPC SECURITY DEFINER: Confirmar Pre-Pedido y Convertir en Pedido Oficial
-- =========================================================================
CREATE OR REPLACE FUNCTION public.confirmar_prepedido_aprobador(
    p_token_aprobacion TEXT,
    p_items JSONB,
    p_observaciones TEXT DEFAULT NULL,
    p_descuento_porcentaje NUMERIC DEFAULT 0,
    p_total_final NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prep RECORD;
    v_pedido_id UUID;
    v_item JSONB;
    v_subtotal_calc NUMERIC(14,2) := 0;
    v_total_final NUMERIC(14,2) := 0;
    v_obs_final TEXT;
BEGIN
    IF p_token_aprobacion IS NULL OR trim(p_token_aprobacion) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Token de aprobación inválido.');
    END IF;

    SELECT *
    INTO v_prep
    FROM public.clientes_b2b_prepedidos
    WHERE token_aprobacion = trim(p_token_aprobacion)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se encontró el pre-pedido solicitado.');
    END IF;

    IF v_prep.estado = 'incorporado' AND v_prep.pedido_confirmado_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'ya_confirmado', true,
            'pedido_id', v_prep.pedido_confirmado_id,
            'error', 'Este pre-pedido ya fue aprobado y confirmado anteriormente.'
        );
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'El pedido debe contener al menos un artículo para poder confirmarse.');
    END IF;

    -- Calcular subtotal de respaldo desde los ítems
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_subtotal_calc := v_subtotal_calc + COALESCE((v_item ->> 'subtotal')::NUMERIC, (COALESCE((v_item ->> 'precio_unitario')::NUMERIC, 0) * COALESCE((v_item ->> 'cantidad')::NUMERIC, 0)));
    END LOOP;

    v_total_final := CASE WHEN COALESCE(p_total_final, 0) > 0 THEN p_total_final ELSE v_subtotal_calc END;

    v_obs_final := trim(COALESCE(p_observaciones, ''));
    IF v_obs_final = '' AND v_prep.nota_colaborador IS NOT NULL AND trim(v_prep.nota_colaborador) <> '' THEN
        v_obs_final := '[Pre-armado por ' || COALESCE(v_prep.colaborador_nombre, 'Operador') || ']: ' || trim(v_prep.nota_colaborador);
    ELSIF v_obs_final <> '' AND v_prep.nota_colaborador IS NOT NULL AND trim(v_prep.nota_colaborador) <> '' THEN
        v_obs_final := v_obs_final || ' | [Nota operador]: ' || trim(v_prep.nota_colaborador);
    END IF;

    IF COALESCE(p_descuento_porcentaje, 0) > 0 AND position('Bonif. Comercial' in v_obs_final) = 0 THEN
        v_obs_final := CASE WHEN v_obs_final <> '' THEN v_obs_final || ' • ' ELSE '' END || '(Bonif. Comercial: ' || p_descuento_porcentaje || '% por volumen)';
    END IF;

    -- 1. Insertar cabecera oficial en clientes_b2b_pedidos_cabecera
    INSERT INTO public.clientes_b2b_pedidos_cabecera (
        cliente_id,
        fecha_pedido,
        estado,
        total,
        descuento,
        observaciones,
        sync_estado
    ) VALUES (
        v_prep.cliente_id,
        NOW(),
        'Borrador',
        v_total_final,
        COALESCE(p_descuento_porcentaje, 0),
        NULLIF(v_obs_final, ''),
        'Pendiente'
    )
    RETURNING id INTO v_pedido_id;

    -- 2. Insertar detalle de ítems en clientes_b2b_pedidos_items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.clientes_b2b_pedidos_items (
            pedido_id,
            producto_codigo,
            producto_descripcion,
            cantidad,
            precio_unitario,
            subtotal
        ) VALUES (
            v_pedido_id,
            trim(COALESCE(v_item ->> 'producto_codigo', '')),
            COALESCE(v_item ->> 'producto_descripcion', ''),
            COALESCE((v_item ->> 'cantidad')::NUMERIC, 1),
            COALESCE((v_item ->> 'precio_unitario')::NUMERIC, 0),
            COALESCE((v_item ->> 'subtotal')::NUMERIC, COALESCE((v_item ->> 'precio_unitario')::NUMERIC, 0) * COALESCE((v_item ->> 'cantidad')::NUMERIC, 1))
        );
    END LOOP;

    -- 3. Actualizar estado del pre-pedido
    UPDATE public.clientes_b2b_prepedidos
    SET estado = 'incorporado',
        items = p_items,
        descuento_porcentaje = COALESCE(p_descuento_porcentaje, 0),
        total_estimado = v_total_final,
        pedido_confirmado_id = v_pedido_id,
        confirmado_en = NOW(),
        updated_at = NOW()
    WHERE id = v_prep.id;

    RETURN jsonb_build_object(
        'success', true,
        'pedido_id', v_pedido_id,
        'total_final', v_total_final
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_prepedido_aprobador(TEXT, JSONB, TEXT, NUMERIC, NUMERIC) TO anon, authenticated, service_role;
