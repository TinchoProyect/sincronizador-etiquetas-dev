-- =====================================================================
-- 43_b2b_ensobrado_doble_token_gobernanza.sql
-- Proyecto: Portal de Clientes B2B — Sistema LAMDA
-- Gobernanza en 2 Niveles para Ensobrado de Efectivo (1 Único Sobre):
--   - Nivel 1 (Dueño / Titular vía token_publico): monto opcional o sugerido,
--     edición libre y delegación por QR / WhatsApp sin duplicar sobres.
--   - Nivel 2 (Colaborador Delegado vía token_colaborador): arranque directo
--     en conteo con monto fijado y bloqueado por el titular.
-- =====================================================================

-- 1. Relajar obligatoriedad de monto_declarado mientras el sobre esté PENDIENTE_ENSOBRADO
ALTER TABLE public.clientes_b2b_pagos_efectivo
    ALTER COLUMN monto_declarado DROP NOT NULL;

DO $$
DECLARE
    v_conname TEXT;
BEGIN
    FOR v_conname IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.clientes_b2b_pagos_efectivo'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%monto_declarado%'
    LOOP
        EXECUTE format('ALTER TABLE public.clientes_b2b_pagos_efectivo DROP CONSTRAINT IF EXISTS %I', v_conname);
    END LOOP;
END $$;

ALTER TABLE public.clientes_b2b_pagos_efectivo
    ADD CONSTRAINT clientes_b2b_pagos_efectivo_monto_declarado_check
    CHECK (
        (estado = 'PENDIENTE_ENSOBRADO' AND (monto_declarado IS NULL OR monto_declarado > 0))
        OR (estado <> 'PENDIENTE_ENSOBRADO' AND monto_declarado IS NOT NULL AND monto_declarado > 0)
    );

-- 2. Columnas de gobernanza y doble token sobre el mismo sobre
ALTER TABLE public.clientes_b2b_pagos_efectivo
    ADD COLUMN IF NOT EXISTS token_colaborador TEXT,
    ADD COLUMN IF NOT EXISTS monto_sugerido_inicial NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS monto_bloqueado BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS monto_fijado_por TEXT,
    ADD COLUMN IF NOT EXISTS monto_fijado_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delegado_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cliente_nombre_snapshot TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_pagos_efectivo_token_colaborador
    ON public.clientes_b2b_pagos_efectivo(token_colaborador)
    WHERE token_colaborador IS NOT NULL;

-- 3. Cerrar actualización/lectura anónima directa sobre la tabla para enforzar RPCs SECURITY DEFINER
DROP POLICY IF EXISTS "Colaborador publico puede consultar su sobre por token" ON public.clientes_b2b_pagos_efectivo;
DROP POLICY IF EXISTS "Colaborador publico puede completar el ensobrado por token" ON public.clientes_b2b_pagos_efectivo;

-- Permitir a titulares autenticados gestionar también sus sobres PENDIENTE_ENSOBRADO
DROP POLICY IF EXISTS "Clientes pueden modificar o cancelar sobres preparados" ON public.clientes_b2b_pagos_efectivo;
CREATE POLICY "Clientes pueden modificar o cancelar sobres preparados" ON public.clientes_b2b_pagos_efectivo
    FOR UPDATE
    TO authenticated
    USING (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado IN ('PREPARADO', 'PENDIENTE_ENSOBRADO')
    )
    WITH CHECK (
        cliente_id = (auth.jwt() -> 'app_metadata' ->> 'cliente_id')
        AND estado IN ('PREPARADO', 'PENDIENTE_ENSOBRADO', 'CANCELADO')
    );

-- 4. RPC 1: Obtener sobre público por token (discrimina rol DUENO vs COLABORADOR sin filtrar token_publico)
CREATE OR REPLACE FUNCTION public.ensobrado_publico_obtener(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT := NULLIF(TRIM(p_token), '');
    v_sobre public.clientes_b2b_pagos_efectivo%ROWTYPE;
    v_rol TEXT;
    v_cliente_nombre TEXT;
BEGIN
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOKEN_INVALIDO', 'error', 'No se proporcionó un token válido.');
    END IF;

    SELECT *
    INTO v_sobre
    FROM public.clientes_b2b_pagos_efectivo
    WHERE token_publico = v_token
       OR token_colaborador = v_token
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_ENCONTRADO', 'error', 'El enlace es inválido o el sobre ya no se encuentra disponible.');
    END IF;

    IF v_sobre.token_publico = v_token THEN
        v_rol := 'DUENO';
    ELSE
        v_rol := 'COLABORADOR';
    END IF;

    SELECT COALESCE(
        NULLIF(TRIM(v_sobre.cliente_nombre_snapshot), ''),
        (
            SELECT COALESCE(NULLIF(TRIM(p.nombre_empresa), ''), NULLIF(TRIM(p.nombre_completo), ''))
            FROM public.clientes_b2b_perfiles p
            WHERE p.cliente_id = v_sobre.cliente_id
            LIMIT 1
        ),
        v_sobre.cliente_id
    )
    INTO v_cliente_nombre;

    RETURN jsonb_build_object(
        'ok', true,
        'rol_acceso', v_rol,
        'puede_editar_monto', (v_rol = 'DUENO' AND v_sobre.estado = 'PENDIENTE_ENSOBRADO'),
        'puede_delegar', (v_rol = 'DUENO' AND v_sobre.estado = 'PENDIENTE_ENSOBRADO'),
        'sobre', jsonb_build_object(
            'id', v_sobre.id,
            'codigo_sobre', v_sobre.codigo_sobre,
            'cliente_id', v_sobre.cliente_id,
            'cliente_nombre', v_cliente_nombre,
            'monto_declarado', v_sobre.monto_declarado,
            'monto_sugerido_inicial', v_sobre.monto_sugerido_inicial,
            'monto_bloqueado', COALESCE(v_sobre.monto_bloqueado, FALSE) OR (v_rol = 'COLABORADOR'),
            'monto_fijado_por', v_sobre.monto_fijado_por,
            'monto_fijado_at', v_sobre.monto_fijado_at,
            'delegado_at', v_sobre.delegado_at,
            'modalidad_entrega', v_sobre.modalidad_entrega,
            'estado', v_sobre.estado,
            'observaciones_cliente', v_sobre.observaciones_cliente,
            'colaborador_nombre', v_sobre.colaborador_nombre,
            'derivado_por', v_sobre.derivado_por,
            'token_colaborador', CASE WHEN v_rol = 'DUENO' THEN v_sobre.token_colaborador ELSE NULL END
        )
    );
END;
$$;

-- 5. RPC 2: Fijar monto y delegar a colaborador sobre el MISMO sobre (exclusivo token_publico de Dueño)
CREATE OR REPLACE FUNCTION public.ensobrado_dueno_delegar(
    p_token_dueno TEXT,
    p_monto NUMERIC,
    p_colaborador_nombre TEXT DEFAULT NULL,
    p_nota TEXT DEFAULT NULL,
    p_fijado_por TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT := NULLIF(TRIM(p_token_dueno), '');
    v_sobre public.clientes_b2b_pagos_efectivo%ROWTYPE;
    v_tok_colab TEXT;
    v_cliente_nombre TEXT;
    v_fijado_por TEXT;
    v_colab_nombre TEXT;
BEGIN
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOKEN_INVALIDO', 'error', 'Token de titular requerido.');
    END IF;

    IF p_monto IS NULL OR p_monto <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MONTO_INVALIDO', 'error', 'Debes definir un monto mayor a $0 para delegar el sobre.');
    END IF;

    SELECT *
    INTO v_sobre
    FROM public.clientes_b2b_pagos_efectivo
    WHERE token_publico = v_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SOLO_DUENO', 'error', 'Solo el titular del enlace principal puede fijar el monto o delegar el sobre.');
    END IF;

    IF v_sobre.estado <> 'PENDIENTE_ENSOBRADO' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'YA_PROCESADO', 'estado', v_sobre.estado, 'error', format('Este sobre ya pasó a estado %s y no puede modificarse.', v_sobre.estado));
    END IF;

    SELECT COALESCE(
        NULLIF(TRIM(v_sobre.cliente_nombre_snapshot), ''),
        (
            SELECT COALESCE(NULLIF(TRIM(p.nombre_empresa), ''), NULLIF(TRIM(p.nombre_completo), ''))
            FROM public.clientes_b2b_perfiles p
            WHERE p.cliente_id = v_sobre.cliente_id
            LIMIT 1
        ),
        v_sobre.cliente_id
    )
    INTO v_cliente_nombre;

    v_tok_colab := COALESCE(NULLIF(TRIM(v_sobre.token_colaborador), ''), gen_random_uuid()::text);
    v_fijado_por := COALESCE(NULLIF(TRIM(p_fijado_por), ''), v_cliente_nombre, 'Titular');
    v_colab_nombre := COALESCE(NULLIF(TRIM(p_colaborador_nombre), ''), v_sobre.colaborador_nombre, 'Colaborador');

    UPDATE public.clientes_b2b_pagos_efectivo
    SET
        monto_declarado = ROUND(p_monto, 2),
        monto_bloqueado = TRUE,
        monto_fijado_por = v_fijado_por,
        monto_fijado_at = NOW(),
        token_colaborador = v_tok_colab,
        delegado_at = COALESCE(delegado_at, NOW()),
        colaborador_nombre = v_colab_nombre,
        observaciones_cliente = CASE WHEN p_nota IS NOT NULL THEN NULLIF(TRIM(p_nota), '') ELSE observaciones_cliente END,
        cliente_nombre_snapshot = COALESCE(NULLIF(TRIM(cliente_nombre_snapshot), ''), v_cliente_nombre),
        sincronizado_local = FALSE,
        updated_at = NOW()
    WHERE id = v_sobre.id
    RETURNING * INTO v_sobre;

    RETURN jsonb_build_object(
        'ok', true,
        'rol_acceso', 'DUENO',
        'codigo_sobre', v_sobre.codigo_sobre,
        'cliente_id', v_sobre.cliente_id,
        'cliente_nombre', v_cliente_nombre,
        'monto_declarado', v_sobre.monto_declarado,
        'monto_bloqueado', v_sobre.monto_bloqueado,
        'monto_fijado_por', v_sobre.monto_fijado_por,
        'monto_fijado_at', v_sobre.monto_fijado_at,
        'delegado_at', v_sobre.delegado_at,
        'colaborador_nombre', v_sobre.colaborador_nombre,
        'observaciones_cliente', v_sobre.observaciones_cliente,
        'estado', v_sobre.estado,
        'token_colaborador', v_sobre.token_colaborador
    );
END;
$$;

-- 6. RPC 3: Completar ensobrado (Dueño o Colaborador) con bloqueo atómico y verificación exacta de arqueo
CREATE OR REPLACE FUNCTION public.ensobrado_publico_completar(
    p_token TEXT,
    p_monto NUMERIC,
    p_desglose JSONB,
    p_foto_frente_url TEXT,
    p_foto_dorso_url TEXT,
    p_modalidad_entrega TEXT DEFAULT 'CHOFER',
    p_colaborador_nombre TEXT DEFAULT NULL,
    p_observaciones TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT := NULLIF(TRIM(p_token), '');
    v_sobre public.clientes_b2b_pagos_efectivo%ROWTYPE;
    v_rol TEXT;
    v_monto_final NUMERIC(12, 2);
    v_suma_billetes NUMERIC(12, 2) := 0;
    v_desglose_limpio JSONB := '{}'::jsonb;
    v_kv RECORD;
    v_cant_txt TEXT;
    v_cant INTEGER;
    v_denom INTEGER;
    v_modalidad TEXT := UPPER(COALESCE(NULLIF(TRIM(p_modalidad_entrega), ''), 'CHOFER'));
    v_colab_final TEXT;
    v_nota_final TEXT;
BEGIN
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'TOKEN_INVALIDO', 'error', 'Token requerido.');
    END IF;

    SELECT *
    INTO v_sobre
    FROM public.clientes_b2b_pagos_efectivo
    WHERE token_publico = v_token
       OR token_colaborador = v_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NO_ENCONTRADO', 'error', 'El sobre solicitado no existe.');
    END IF;

    IF v_sobre.estado <> 'PENDIENTE_ENSOBRADO' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'YA_PROCESADO', 'estado', v_sobre.estado, 'error', format('Este sobre ya fue cerrado previamente (estado: %s).', v_sobre.estado));
    END IF;

    IF v_sobre.token_publico = v_token THEN
        v_rol := 'DUENO';
    ELSE
        v_rol := 'COLABORADOR';
    END IF;

    IF v_rol = 'COLABORADOR' THEN
        IF v_sobre.monto_declarado IS NULL OR v_sobre.monto_declarado <= 0 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'SIN_MONTO_FIJO', 'error', 'El titular aún no definió un monto fijo para este sobre.');
        END IF;
        IF p_monto IS NOT NULL AND ABS(p_monto - v_sobre.monto_declarado) > 0.009 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'MONTO_BLOQUEADO', 'error', 'El monto fue fijado por el titular y no puede modificarse.');
        END IF;
        v_monto_final := ROUND(v_sobre.monto_declarado, 2);
    ELSE
        IF p_monto IS NULL OR p_monto <= 0 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'MONTO_INVALIDO', 'error', 'Debes indicar un monto mayor a $0.');
        END IF;
        v_monto_final := ROUND(p_monto, 2);
    END IF;

    IF v_modalidad NOT IN ('CHOFER', 'LOCAL') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODALIDAD_INVALIDA', 'error', 'Modalidad de entrega inválida.');
    END IF;

    IF NULLIF(TRIM(p_foto_frente_url), '') IS NULL OR NULLIF(TRIM(p_foto_dorso_url), '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FOTOS_REQUERIDAS', 'error', 'Las fotos de frente y dorso del sobre sellado son obligatorias.');
    END IF;

    IF p_desglose IS NULL OR jsonb_typeof(p_desglose) <> 'object' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DESGLOSE_INVALIDO', 'error', 'Debes informar el desglose de billetes.');
    END IF;

    FOR v_kv IN SELECT key, value FROM jsonb_each(p_desglose) LOOP
        IF v_kv.key !~ '^(10|20|50|100|200|500|1000|2000|10000|20000)$' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'DENOMINACION_INVALIDA', 'error', format('Denominación inválida: %s', v_kv.key));
        END IF;
        v_cant_txt := COALESCE(v_kv.value #>> '{}', '0');
        IF v_cant_txt !~ '^\d+$' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'CANTIDAD_INVALIDA', 'error', 'La cantidad de billetes debe ser un entero no negativo.');
        END IF;
        v_cant := v_cant_txt::INTEGER;
        IF v_cant > 0 THEN
            v_denom := v_kv.key::INTEGER;
            v_suma_billetes := v_suma_billetes + (v_denom::NUMERIC * v_cant::NUMERIC);
            v_desglose_limpio := v_desglose_limpio || jsonb_build_object(v_kv.key, v_cant);
        END IF;
    END LOOP;

    IF ABS(v_suma_billetes - v_monto_final) > 0.009 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'ARQUEO_NO_COINCIDE',
            'error', format('La suma de billetes ($%s) no coincide con el monto a declarar ($%s).', v_suma_billetes, v_monto_final)
        );
    END IF;

    v_colab_final := COALESCE(NULLIF(TRIM(p_colaborador_nombre), ''), v_sobre.colaborador_nombre, CASE WHEN v_rol = 'DUENO' THEN 'Titular' ELSE 'Colaborador' END);
    v_nota_final := NULLIF(TRIM(CONCAT_WS(
        ' | ',
        CASE WHEN NULLIF(TRIM(p_observaciones), '') IS NOT NULL THEN 'Nota: ' || TRIM(p_observaciones) ELSE v_sobre.observaciones_cliente END,
        'Preparado por ' || CASE WHEN v_rol = 'DUENO' THEN 'titular' ELSE 'colaborador' END || ': ' || v_colab_final
    )), '');

    UPDATE public.clientes_b2b_pagos_efectivo
    SET
        monto_declarado = v_monto_final,
        desglose_billetes = v_desglose_limpio,
        foto_frente_url = TRIM(p_foto_frente_url),
        foto_dorso_url = TRIM(p_foto_dorso_url),
        modalidad_entrega = v_modalidad,
        estado = 'PREPARADO',
        observaciones_cliente = COALESCE(v_nota_final, observaciones_cliente),
        colaborador_nombre = v_colab_final,
        sincronizado_local = FALSE,
        updated_at = NOW()
    WHERE id = v_sobre.id
    RETURNING * INTO v_sobre;

    RETURN jsonb_build_object(
        'ok', true,
        'rol_acceso', v_rol,
        'estado', v_sobre.estado,
        'codigo_sobre', v_sobre.codigo_sobre,
        'cliente_id', v_sobre.cliente_id,
        'monto_declarado', v_sobre.monto_declarado,
        'modalidad_entrega', v_sobre.modalidad_entrega,
        'colaborador_nombre', v_sobre.colaborador_nombre
    );
END;
$$;

REVOKE ALL ON FUNCTION public.ensobrado_publico_obtener(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensobrado_dueno_delegar(TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensobrado_publico_completar(TEXT, NUMERIC, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensobrado_publico_obtener(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensobrado_dueno_delegar(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensobrado_publico_completar(TEXT, NUMERIC, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
