-- =============================================================================
-- MIGRACIÓN 40 — MICRO-ETAPA 5: BLINDAJE DEL TRIGGER DE STOCK SATÉLITE (LECTURA DUAL SKU/BARCODE)
-- =============================================================================
-- Propósito:
--   1. Normalizar la resolución del cliente colaborador (bunker_clientes.lomas_soft_id vs
--      presupuestos.id_cliente) mediante LTRIM(TRIM(...), '0'), permitiendo vincular
--      tanto '583' (Web) como '0583' (Búnker / Portal B2B).
--   2. Hacer dual la búsqueda de recetas en public.recetas (resolviendo NEW.articulo y
--      OLD.articulo a su SKU canónico vía public.articulos y public.bunker_articulos,
--      funcione tanto con código de barras '5689515951' como con SKU 'MPB'), manteniendo
--      intactos los renglones de insumos de kit '135' (Aceite de Coco) y '136' (Miel).
--   3. Blindar la rama TG_OP = 'UPDATE' comparando el SKU canónico resuelto
--      (v_sku_new IS DISTINCT FROM v_sku_old) en lugar de NEW.articulo <> OLD.articulo,
--      para que actualizar el código de barras al SKU del mismo artículo no dispare
--      reversiones ni descuentos espurios.
--   4. Evitar descuentos sobre presupuestos inactivos/anulados y evitar dobles reversiones
--      en DELETE si el saldo satélite del presupuesto ya fue revertido por anulación.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_stock_satelite_por_venta()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_usuario_id INTEGER;
    v_presupuesto_activo BOOLEAN;
    v_estado_presupuesto TEXT;
    v_sku_new TEXT;
    v_sku_old TEXT;
    r_ing RECORD;
    v_consumo NUMERIC(15,4);
    v_diff NUMERIC(15,4);
    v_neto_actual NUMERIC(15,4);
    v_reversion NUMERIC(15,4);
BEGIN
    -- 1. Obtener usuario_id colaborador normalizando ceros a la izquierda ('583' == '0583')
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        SELECT bc.usuario_id, COALESCE(p.activo, true), COALESCE(p.estado, '')
        INTO v_usuario_id, v_presupuesto_activo, v_estado_presupuesto
        FROM public.presupuestos p
        JOIN public.bunker_clientes bc
          ON COALESCE(NULLIF(LTRIM(TRIM(bc.lomas_soft_id::text), '0'), ''), '0') =
             COALESCE(NULLIF(LTRIM(TRIM(p.id_cliente::text), '0'), ''), '0')
        WHERE p.id = NEW.id_presupuesto
          AND bc.usuario_id IS NOT NULL
        LIMIT 1;
    ELSIF (TG_OP = 'DELETE') THEN
        SELECT bc.usuario_id, COALESCE(p.activo, true), COALESCE(p.estado, '')
        INTO v_usuario_id, v_presupuesto_activo, v_estado_presupuesto
        FROM public.presupuestos p
        JOIN public.bunker_clientes bc
          ON COALESCE(NULLIF(LTRIM(TRIM(bc.lomas_soft_id::text), '0'), ''), '0') =
             COALESCE(NULLIF(LTRIM(TRIM(p.id_cliente::text), '0'), ''), '0')
        WHERE p.id = OLD.id_presupuesto
          AND bc.usuario_id IS NOT NULL
        LIMIT 1;
    END IF;

    IF v_usuario_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- 2. Resolver SKU canónico de NEW.articulo (respetando intactos insumos de kit '135' y '136')
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF TRIM(COALESCE(NEW.articulo, '')) IN ('135', '136') THEN
            v_sku_new := TRIM(NEW.articulo);
        ELSE
            SELECT COALESCE(
                (SELECT TRIM(a.numero)
                 FROM public.articulos a
                 WHERE TRIM(a.numero) = TRIM(NEW.articulo)
                    OR TRIM(a.codigo_barras) = TRIM(NEW.articulo)
                 ORDER BY (TRIM(a.numero) = TRIM(NEW.articulo)) DESC
                 LIMIT 1),
                (SELECT TRIM(ba.articulo_id::text)
                 FROM public.bunker_articulos ba
                 WHERE TRIM(ba.articulo_id::text) = TRIM(NEW.articulo)
                    OR TRIM(ba.codigo_barras::text) = TRIM(NEW.articulo)
                 ORDER BY (TRIM(ba.articulo_id::text) = TRIM(NEW.articulo)) DESC
                 LIMIT 1),
                TRIM(COALESCE(NEW.articulo, ''))
            ) INTO v_sku_new;
        END IF;
    END IF;

    -- 3. Resolver SKU canónico de OLD.articulo (respetando intactos insumos de kit '135' y '136')
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        IF TRIM(COALESCE(OLD.articulo, '')) IN ('135', '136') THEN
            v_sku_old := TRIM(OLD.articulo);
        ELSE
            SELECT COALESCE(
                (SELECT TRIM(a.numero)
                 FROM public.articulos a
                 WHERE TRIM(a.numero) = TRIM(OLD.articulo)
                    OR TRIM(a.codigo_barras) = TRIM(OLD.articulo)
                 ORDER BY (TRIM(a.numero) = TRIM(OLD.articulo)) DESC
                 LIMIT 1),
                (SELECT TRIM(ba.articulo_id::text)
                 FROM public.bunker_articulos ba
                 WHERE TRIM(ba.articulo_id::text) = TRIM(OLD.articulo)
                    OR TRIM(ba.codigo_barras::text) = TRIM(OLD.articulo)
                 ORDER BY (TRIM(ba.articulo_id::text) = TRIM(OLD.articulo)) DESC
                 LIMIT 1),
                TRIM(COALESCE(OLD.articulo, ''))
            ) INTO v_sku_old;
        END IF;
    END IF;

    -- 4. Registrar egreso/ajuste en colaborador_stock_satelite_movimientos
    IF (TG_OP = 'INSERT') THEN
        -- No descontar si el presupuesto nace o está anulado/inactivo, ni para insumos directos 135/136
        IF v_presupuesto_activo = false
           OR UPPER(TRIM(v_estado_presupuesto)) IN ('ANULADO', 'ANULADO POR EL CLIENTE', 'CANCELADO')
           OR v_sku_new IN ('135', '136') THEN
            RETURN NULL;
        END IF;

        FOR r_ing IN (
            SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            WHERE (TRIM(r.articulo_numero) = v_sku_new OR TRIM(r.articulo_numero) = TRIM(NEW.articulo))
              AND ri.ingrediente_id IS NOT NULL
        ) LOOP
            v_consumo := COALESCE(NEW.cantidad, 0) * r_ing.cantidad_receta;
            IF v_consumo <> 0 THEN
                INSERT INTO public.colaborador_stock_satelite_movimientos
                    (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                VALUES
                    (v_usuario_id, r_ing.ingrediente_id, -v_consumo, 'egreso_venta', NEW.id_presupuesto,
                     'Egreso proporcional automático por compra de mezcla ' || v_sku_new);
            END IF;
        END LOOP;

    ELSIF (TG_OP = 'DELETE') THEN
        IF v_sku_old IN ('135', '136') THEN
            RETURN NULL;
        END IF;

        FOR r_ing IN (
            SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
            FROM public.recetas r
            JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
            WHERE (TRIM(r.articulo_numero) = v_sku_old OR TRIM(r.articulo_numero) = TRIM(OLD.articulo))
              AND ri.ingrediente_id IS NOT NULL
        ) LOOP
            v_consumo := COALESCE(OLD.cantidad, 0) * r_ing.cantidad_receta;
            -- Verificar que exista saldo neto negativo pendiente de revertir para este presupuesto e ingrediente
            SELECT COALESCE(SUM(kilos), 0)
            INTO v_neto_actual
            FROM public.colaborador_stock_satelite_movimientos
            WHERE usuario_id = v_usuario_id
              AND ingrediente_id = r_ing.ingrediente_id
              AND presupuesto_id = OLD.id_presupuesto;

            IF v_consumo > 0 AND v_neto_actual < -0.0001 THEN
                v_reversion := LEAST(v_consumo, ABS(v_neto_actual));
                INSERT INTO public.colaborador_stock_satelite_movimientos
                    (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                VALUES
                    (v_usuario_id, r_ing.ingrediente_id, v_reversion, 'devolucion_venta', OLD.id_presupuesto,
                     'Reversión automática por cancelación de línea de mezcla ' || v_sku_old);
            END IF;
        END LOOP;

    ELSIF (TG_OP = 'UPDATE') THEN
        -- Comparar SKU canónico resuelto para que migrar de código de barras a SKU del mismo artículo sea neutro
        IF (v_sku_new IS DISTINCT FROM v_sku_old) THEN
            -- Revertir viejo artículo si no es 135/136
            IF v_sku_old NOT IN ('135', '136') THEN
                FOR r_ing IN (
                    SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
                    FROM public.recetas r
                    JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                    WHERE (TRIM(r.articulo_numero) = v_sku_old OR TRIM(r.articulo_numero) = TRIM(OLD.articulo))
                      AND ri.ingrediente_id IS NOT NULL
                ) LOOP
                    v_consumo := COALESCE(OLD.cantidad, 0) * r_ing.cantidad_receta;
                    IF v_consumo <> 0 THEN
                        INSERT INTO public.colaborador_stock_satelite_movimientos
                            (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                        VALUES
                            (v_usuario_id, r_ing.ingrediente_id, v_consumo, 'devolucion_venta', OLD.id_presupuesto,
                             'Reversión automática por cambio de artículo de mezcla ' || v_sku_old);
                    END IF;
                END LOOP;
            END IF;

            -- Aplicar nuevo artículo si no es 135/136 y presupuesto activo
            IF v_presupuesto_activo = true
               AND UPPER(TRIM(v_estado_presupuesto)) NOT IN ('ANULADO', 'ANULADO POR EL CLIENTE', 'CANCELADO')
               AND v_sku_new NOT IN ('135', '136') THEN
                FOR r_ing IN (
                    SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
                    FROM public.recetas r
                    JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                    WHERE (TRIM(r.articulo_numero) = v_sku_new OR TRIM(r.articulo_numero) = TRIM(NEW.articulo))
                      AND ri.ingrediente_id IS NOT NULL
                ) LOOP
                    v_consumo := COALESCE(NEW.cantidad, 0) * r_ing.cantidad_receta;
                    IF v_consumo <> 0 THEN
                        INSERT INTO public.colaborador_stock_satelite_movimientos
                            (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                        VALUES
                            (v_usuario_id, r_ing.ingrediente_id, -v_consumo, 'egreso_venta', NEW.id_presupuesto,
                             'Egreso proporcional automático por compra de mezcla ' || v_sku_new);
                    END IF;
                END LOOP;
            END IF;
        ELSE
            -- Mismo artículo canónico: solo ajustar si cambió la cantidad
            v_diff := COALESCE(NEW.cantidad, 0) - COALESCE(OLD.cantidad, 0);
            IF (v_diff <> 0 AND v_sku_new NOT IN ('135', '136')) THEN
                FOR r_ing IN (
                    SELECT ri.ingrediente_id, ri.cantidad AS cantidad_receta
                    FROM public.recetas r
                    JOIN public.receta_ingredientes ri ON r.id = ri.receta_id
                    WHERE (TRIM(r.articulo_numero) = v_sku_new OR TRIM(r.articulo_numero) = TRIM(NEW.articulo))
                      AND ri.ingrediente_id IS NOT NULL
                ) LOOP
                    v_consumo := v_diff * r_ing.cantidad_receta;
                    INSERT INTO public.colaborador_stock_satelite_movimientos
                        (usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones)
                    VALUES
                        (v_usuario_id, r_ing.ingrediente_id, -v_consumo, 'egreso_venta', NEW.id_presupuesto,
                         'Ajuste automático de cantidad por compra de mezcla ' || v_sku_new);
                END LOOP;
            END IF;
        END IF;
    END IF;

    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_actualizar_stock_satelite_por_venta ON public.presupuestos_detalles;
CREATE TRIGGER trg_actualizar_stock_satelite_por_venta
AFTER INSERT OR UPDATE OR DELETE ON public.presupuestos_detalles
FOR EACH ROW
EXECUTE FUNCTION public.actualizar_stock_satelite_por_venta();

COMMIT;
