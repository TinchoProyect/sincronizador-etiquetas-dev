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
