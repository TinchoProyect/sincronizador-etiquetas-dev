'use strict';

/**
 * ============================================================================
 * MIGRACIÓN Y BACKFILL RELACIONAL DETERMINISTA ETAPA 2 — NODOS Y COSTOS
 * ============================================================================
 * - Agrega taxonomía estructural en BD (`rol_ingrediente`, `habilitado_solicitud_nodos`),
 *   desempate de vínculo primario en `ingrediente_bunker_articulos`,
 *   parametrización formal en `articulos_produccion_externa_relacion` (LDN 4/5/6),
 *   métricas relacionales de mano de obra (`minutos_mano_obra`, `tarifa_colaborador_id`)
 *   y backfill determinista de `recetas.articulo_sugerido_numero`.
 * - 100% idempotente, cero alteración de precios/costos existentes en el backfill inicial
 *   y verificación fast-path read-only para evitar DDL en hot paths HTTP.
 */

const COLS_APER_ETAPA2 = [
    'linea_negocio',
    'modo_rendimiento',
    'peso_unitario_salida_kg',
    'unidades_por_tanda_default',
    'articulo_premezcla_codigo',
    'ingrediente_espejo_id',
    'tarifa_maquila_default',
    'unidad_tarifa_maquila',
    'merma_default_pct',
    'insumos_fase_externa_json'
];

const INDICES_ETAPA2 = [
    'idx_ingredientes_rol_solicitud',
    'idx_aper_linea_negocio',
    'idx_aper_ingrediente_espejo_id'
];

async function esquemaEtapa2YaAplicado(client) {
    const res = await client.query(
        `SELECT
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ingredientes' AND column_name = 'rol_ingrediente'
            ) AS col_rol_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ingredientes' AND column_name = 'habilitado_solicitud_nodos'
            ) AS col_hab_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'ingrediente_bunker_articulos' AND column_name = 'es_vinculo_costo_primario'
            ) AS col_iba_primario_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bunker_articulos' AND column_name = 'minutos_mano_obra'
            ) AS col_ba_min_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bunker_articulos' AND column_name = 'tarifa_colaborador_id'
            ) AS col_ba_tar_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bunker_lista_articulos' AND column_name = 'minutos_mano_obra'
            ) AS col_bla_min_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bunker_lista_articulos' AND column_name = 'tarifa_colaborador_id'
            ) AS col_bla_tar_ok,
            (
                SELECT COUNT(*)::int FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'articulos_produccion_externa_relacion'
                  AND column_name = ANY($1::text[])
            ) AS cols_aper_cnt,
            (
                SELECT COUNT(*)::int FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = ANY($2::text[])
            ) AS indices_cnt,
            EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'chk_ingredientes_rol_ingrediente'
            ) AS chk_rol_ok`,
        [COLS_APER_ETAPA2, INDICES_ETAPA2]
    );

    const r = res.rows[0] || {};
    return Boolean(
        r.col_rol_ok
        && r.col_hab_ok
        && r.col_iba_primario_ok
        && r.col_ba_min_ok
        && r.col_ba_tar_ok
        && r.col_bla_min_ok
        && r.col_bla_tar_ok
        && r.chk_rol_ok
        && Number(r.cols_aper_cnt || 0) === COLS_APER_ETAPA2.length
        && Number(r.indices_cnt || 0) === INDICES_ETAPA2.length
    );
}

async function ejecutarMigracionEsquemaEtapa2Nodos(client) {
    // 1. Columnas estructurales en public.ingredientes
    await client.query(`
        ALTER TABLE public.ingredientes
            ADD COLUMN IF NOT EXISTS rol_ingrediente VARCHAR(32) NOT NULL DEFAULT 'MATERIA_PRIMA',
            ADD COLUMN IF NOT EXISTS habilitado_solicitud_nodos BOOLEAN NOT NULL DEFAULT true;

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ingredientes_rol_ingrediente') THEN
                ALTER TABLE public.ingredientes
                    ADD CONSTRAINT chk_ingredientes_rol_ingrediente
                    CHECK (rol_ingrediente IN ('INSUMO_EMPAQUE', 'MATERIA_PRIMA', 'FORMULA_INTERNA', 'PUENTE_ELABORADO'));
            END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_ingredientes_rol_solicitud
            ON public.ingredientes (rol_ingrediente, habilitado_solicitud_nodos);
    `);

    // 2. Vínculo primario de costo en ingrediente_bunker_articulos
    await client.query(`
        ALTER TABLE public.ingrediente_bunker_articulos
            ADD COLUMN IF NOT EXISTS es_vinculo_costo_primario BOOLEAN NOT NULL DEFAULT false;
    `);

    // 3. Parametrización formal LDN 4/5/6 en articulos_produccion_externa_relacion
    await client.query(`
        ALTER TABLE public.articulos_produccion_externa_relacion
            ADD COLUMN IF NOT EXISTS linea_negocio SMALLINT NOT NULL DEFAULT 4,
            ADD COLUMN IF NOT EXISTS modo_rendimiento VARCHAR(24) NOT NULL DEFAULT 'MERMA_PORCENTUAL',
            ADD COLUMN IF NOT EXISTS peso_unitario_salida_kg NUMERIC(10,4),
            ADD COLUMN IF NOT EXISTS unidades_por_tanda_default INTEGER,
            ADD COLUMN IF NOT EXISTS articulo_premezcla_codigo VARCHAR(80),
            ADD COLUMN IF NOT EXISTS ingrediente_espejo_id INTEGER,
            ADD COLUMN IF NOT EXISTS tarifa_maquila_default NUMERIC(14,2),
            ADD COLUMN IF NOT EXISTS unidad_tarifa_maquila VARCHAR(10) NOT NULL DEFAULT 'kg',
            ADD COLUMN IF NOT EXISTS merma_default_pct NUMERIC(8,2),
            ADD COLUMN IF NOT EXISTS insumos_fase_externa_json JSONB;

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aper_linea_negocio') THEN
                ALTER TABLE public.articulos_produccion_externa_relacion
                    ADD CONSTRAINT chk_aper_linea_negocio CHECK (linea_negocio IN (4, 5, 6));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aper_modo_rendimiento') THEN
                ALTER TABLE public.articulos_produccion_externa_relacion
                    ADD CONSTRAINT chk_aper_modo_rendimiento CHECK (modo_rendimiento IN ('MERMA_PORCENTUAL', 'UNIDADES_POR_TANDA'));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_aper_unidad_tarifa') THEN
                ALTER TABLE public.articulos_produccion_externa_relacion
                    ADD CONSTRAINT chk_aper_unidad_tarifa CHECK (unidad_tarifa_maquila IN ('kg', 'un'));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aper_ingrediente_espejo') THEN
                ALTER TABLE public.articulos_produccion_externa_relacion
                    ADD CONSTRAINT fk_aper_ingrediente_espejo
                    FOREIGN KEY (ingrediente_espejo_id) REFERENCES public.ingredientes(id) ON DELETE RESTRICT;
            END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_aper_linea_negocio
            ON public.articulos_produccion_externa_relacion (linea_negocio);

        CREATE INDEX IF NOT EXISTS idx_aper_ingrediente_espejo_id
            ON public.articulos_produccion_externa_relacion (ingrediente_espejo_id);
    `);

    // 4. Formalización relacional de Mano de Obra en bunker_articulos y bunker_lista_articulos (sin alterar costo_tiempo ni precio_final)
    await client.query(`
        ALTER TABLE public.bunker_articulos
            ADD COLUMN IF NOT EXISTS minutos_mano_obra NUMERIC(10,4),
            ADD COLUMN IF NOT EXISTS tarifa_colaborador_id INTEGER REFERENCES public.colaboradores_tarifas(id) ON DELETE SET NULL;

        ALTER TABLE public.bunker_lista_articulos
            ADD COLUMN IF NOT EXISTS minutos_mano_obra NUMERIC(10,4),
            ADD COLUMN IF NOT EXISTS tarifa_colaborador_id INTEGER REFERENCES public.colaboradores_tarifas(id) ON DELETE SET NULL;
    `);

    // 5. Backfill estructural de rol_ingrediente y habilitado_solicitud_nodos (cero arrays de IDs hardcodeados)
    await client.query(`
        WITH clasificacion AS (
            SELECT i.id,
                   CASE
                       WHEN COALESCE(i.es_insumo, false) = true THEN 'INSUMO_EMPAQUE'
                       WHEN EXISTS (SELECT 1 FROM public.ingrediente_composicion ic WHERE ic.mix_id = i.id)
                            OR i.nombre ILIKE '%Fuera de Servicio%' THEN 'FORMULA_INTERNA'
                       WHEN EXISTS (
                           SELECT 1 FROM public.articulos_produccion_externa_relacion ap
                           WHERE UPPER(BTRIM(ap.articulo_kilo_codigo)) = UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, '')))
                       )
                       OR EXISTS (
                           SELECT 1
                           FROM public.recetas r
                           JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                           JOIN public.ingrediente_composicion ic ON ic.mix_id = ri.ingrediente_id
                           WHERE UPPER(BTRIM(r.articulo_numero)) = UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, '')))
                       ) THEN 'PUENTE_ELABORADO'
                       ELSE 'MATERIA_PRIMA'
                   END AS nuevo_rol,
                   EXISTS (
                       SELECT 1
                       FROM public.receta_ingredientes ri_ext
                       JOIN public.recetas rec_ext ON rec_ext.id = ri_ext.receta_id
                       JOIN public.articulos_produccion_externa_relacion aper_ext
                         ON UPPER(BTRIM(aper_ext.articulo_produccion_codigo)) = UPPER(BTRIM(rec_ext.articulo_numero))
                       WHERE ri_ext.ingrediente_id = i.id
                         AND LOWER(COALESCE(ri_ext.fase_produccion, '')) = 'externa'
                   ) AS usado_en_fase_externa,
                   EXISTS (
                       SELECT 1
                       FROM public.receta_ingredientes ri_com
                       JOIN public.recetas rec_com ON rec_com.id = ri_com.receta_id
                       JOIN public.bunker_articulos ba_com ON UPPER(BTRIM(ba_com.articulo_id)) = UPPER(BTRIM(rec_com.articulo_numero))
                       WHERE ri_com.ingrediente_id = i.id
                         AND COALESCE(ba_com.familia_id, 0) <> 42
                         AND NOT EXISTS (
                             SELECT 1 FROM public.articulos_produccion_externa_relacion aper2
                             WHERE UPPER(BTRIM(aper2.articulo_produccion_codigo)) = UPPER(BTRIM(rec_com.articulo_numero))
                         )
                   ) AS tiene_receta_comercial_propia,
                   EXISTS (
                       SELECT 1 FROM public.bunker_articulos ba_ap
                       WHERE UPPER(BTRIM(ba_ap.articulo_id)) = UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, '')))
                         AND ba_ap.descripcion_generada ILIKE '%Para Mix%'
                   ) AS ap_para_mix,
                   i.nombre
            FROM public.ingredientes i
        )
        UPDATE public.ingredientes ing
        SET rol_ingrediente = c.nuevo_rol,
            habilitado_solicitud_nodos = CASE
                WHEN c.nuevo_rol IN ('INSUMO_EMPAQUE', 'FORMULA_INTERNA') THEN false
                WHEN c.nombre ILIKE '%Test E2E%' THEN false
                WHEN c.nombre ILIKE '%Para Mix%' OR c.ap_para_mix = true THEN false
                WHEN c.usado_en_fase_externa = true AND c.tiene_receta_comercial_propia = false THEN false
                ELSE true
            END
        FROM clasificacion c
        WHERE ing.id = c.id;
    `);

    // 6. Backfill es_vinculo_costo_primario en ingrediente_bunker_articulos
    await client.query(`
        WITH univocos AS (
            SELECT UPPER(BTRIM(articulo_vinculado_numero)) AS sku_upper
            FROM public.ingredientes
            WHERE NULLIF(BTRIM(articulo_vinculado_numero), '') IS NOT NULL
            GROUP BY UPPER(BTRIM(articulo_vinculado_numero))
            HAVING COUNT(*) = 1
        )
        UPDATE public.ingrediente_bunker_articulos iba
        SET es_vinculo_costo_primario = (
            UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) = UPPER(BTRIM(iba.bunker_articulo_id))
            AND EXISTS (
                SELECT 1 FROM univocos u WHERE u.sku_upper = UPPER(BTRIM(iba.bunker_articulo_id))
            )
        )
        FROM public.ingredientes i
        WHERE i.id = iba.ingrediente_id;
    `);

    // 7. Backfill estructurado sobre public.articulos_produccion_externa_relacion (LDN 4, 5, 6)
    await client.query(`
        WITH detalle_up AS (
            SELECT r.id,
                   r.articulo_produccion_codigo AS up_sku,
                   r.articulo_kilo_codigo AS ap_sku,
                   ba_ap.propiedades_dinamicas->'tostadero_simulacion' AS sim,
                   (
                       SELECT ra.articulo_numero
                       FROM public.recetas rec_up
                       JOIN public.receta_articulos ra ON ra.receta_id = rec_up.id
                       WHERE UPPER(BTRIM(rec_up.articulo_numero)) = UPPER(BTRIM(r.articulo_produccion_codigo))
                       ORDER BY ra.id ASC
                       LIMIT 1
                   ) AS entrada_sku,
                   EXISTS (
                       SELECT 1
                       FROM public.recetas rec_up
                       JOIN public.receta_articulos ra ON ra.receta_id = rec_up.id
                       JOIN public.recetas rec_pre ON UPPER(BTRIM(rec_pre.articulo_numero)) = UPPER(BTRIM(ra.articulo_numero))
                       JOIN public.receta_ingredientes ri_pre ON ri_pre.receta_id = rec_pre.id
                       JOIN public.ingredientes ing_pre ON ing_pre.id = ri_pre.ingrediente_id
                       WHERE UPPER(BTRIM(rec_up.articulo_numero)) = UPPER(BTRIM(r.articulo_produccion_codigo))
                         AND ing_pre.rol_ingrediente = 'FORMULA_INTERNA'
                   ) AS entrada_es_premezcla,
                   (
                       SELECT i.id
                       FROM public.ingredientes i
                       WHERE UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) = UPPER(BTRIM(r.articulo_kilo_codigo))
                       ORDER BY i.id ASC
                       LIMIT 1
                   ) AS espejo_id,
                   (
                       SELECT jsonb_agg(
                           jsonb_build_object(
                               'ingrediente_id', ri_ext.ingrediente_id,
                               'nombre_ingrediente', COALESCE(ing_ext.nombre, ri_ext.nombre_ingrediente),
                               'cantidad', ri_ext.cantidad,
                               'unidad_medida', COALESCE(ri_ext.unidad_medida, ing_ext.unidad_medida, 'Kilo')
                           )
                           ORDER BY ri_ext.id ASC
                       )
                       FROM public.recetas rec_ext
                       JOIN public.receta_ingredientes ri_ext ON ri_ext.receta_id = rec_ext.id
                       LEFT JOIN public.ingredientes ing_ext ON ing_ext.id = ri_ext.ingrediente_id
                       WHERE UPPER(BTRIM(rec_ext.articulo_numero)) = UPPER(BTRIM(r.articulo_produccion_codigo))
                         AND LOWER(COALESCE(ri_ext.fase_produccion, '')) = 'externa'
                   ) AS insumos_externos,
                   (
                       SELECT ctr.valor_por_unidad
                       FROM public.colaboradores_tarifas_rendimiento ctr
                       WHERE COALESCE(ctr.activo, true) = true
                         AND UPPER(BTRIM(ctr.articulo_numero)) IN (
                             UPPER(BTRIM(r.articulo_kilo_codigo)),
                             UPPER(BTRIM(r.articulo_produccion_codigo))
                         )
                       ORDER BY CASE WHEN UPPER(BTRIM(ctr.articulo_numero)) = UPPER(BTRIM(r.articulo_kilo_codigo)) THEN 0 ELSE 1 END,
                                ctr.id DESC
                       LIMIT 1
                   ) AS ctr_tarifa,
                   (
                       SELECT LOWER(COALESCE(ctr.unidad_medida, 'kg'))
                       FROM public.colaboradores_tarifas_rendimiento ctr
                       WHERE COALESCE(ctr.activo, true) = true
                         AND UPPER(BTRIM(ctr.articulo_numero)) IN (
                             UPPER(BTRIM(r.articulo_kilo_codigo)),
                             UPPER(BTRIM(r.articulo_produccion_codigo))
                         )
                       ORDER BY CASE WHEN UPPER(BTRIM(ctr.articulo_numero)) = UPPER(BTRIM(r.articulo_kilo_codigo)) THEN 0 ELSE 1 END,
                                ctr.id DESC
                       LIMIT 1
                   ) AS ctr_unidad
            FROM public.articulos_produccion_externa_relacion r
            LEFT JOIN public.bunker_articulos ba_ap ON UPPER(BTRIM(ba_ap.articulo_id)) = UPPER(BTRIM(r.articulo_kilo_codigo))
        )
        UPDATE public.articulos_produccion_externa_relacion aper
        SET linea_negocio = CASE
                WHEN d.entrada_es_premezcla AND COALESCE((d.sim->>'modo_unidad')::boolean, false) = true THEN 5
                WHEN d.entrada_es_premezcla THEN 6
                ELSE 4
            END,
            modo_rendimiento = CASE
                WHEN d.entrada_es_premezcla AND COALESCE((d.sim->>'modo_unidad')::boolean, false) = true THEN 'UNIDADES_POR_TANDA'
                ELSE 'MERMA_PORCENTUAL'
            END,
            peso_unitario_salida_kg = CASE
                WHEN d.entrada_es_premezcla AND COALESCE((d.sim->>'modo_unidad')::boolean, false) = true THEN 0.0500
                ELSE NULL
            END,
            unidades_por_tanda_default = CASE
                WHEN d.entrada_es_premezcla AND COALESCE((d.sim->>'modo_unidad')::boolean, false) = true
                    THEN COALESCE(NULLIF((d.sim->>'cantidad_piezas')::int, 0), 96)
                ELSE NULL
            END,
            articulo_premezcla_codigo = CASE
                WHEN d.entrada_es_premezcla THEN d.entrada_sku
                ELSE NULL
            END,
            ingrediente_espejo_id = COALESCE(aper.ingrediente_espejo_id, d.espejo_id),
            tarifa_maquila_default = COALESCE(
                aper.tarifa_maquila_default,
                NULLIF(d.sim->>'tarifa', '')::numeric(14,2),
                d.ctr_tarifa,
                1050.00
            ),
            unidad_tarifa_maquila = CASE
                WHEN (d.entrada_es_premezcla AND COALESCE((d.sim->>'modo_unidad')::boolean, false) = true)
                     OR LOWER(COALESCE(d.sim->>'unidad_medida_tarifa', d.ctr_unidad, 'kg')) = 'un' THEN 'un'
                ELSE 'kg'
            END,
            merma_default_pct = COALESCE(
                aper.merma_default_pct,
                NULLIF(d.sim->>'merma', '')::numeric(8,2)
            ),
            insumos_fase_externa_json = COALESCE(aper.insumos_fase_externa_json, d.insumos_externos)
        FROM detalle_up d
        WHERE aper.id = d.id;
    `);

    // 8. Backfill relacional de minutos_mano_obra y tarifa_colaborador_id (preservando costo_tiempo y precio_final intactos)
    await client.query(`
        WITH tarifa_activa AS (
            SELECT id, usuario_id, valor_hora
            FROM public.colaboradores_tarifas
            WHERE COALESCE(activo, true) = true
            ORDER BY fecha_desde DESC NULLS LAST, id DESC
            LIMIT 1
        ),
        ref_lista AS (
            SELECT UPPER(BTRIM(bla.articulo_numero)) AS sku_upper,
                   MAX(bla.costo_tiempo) FILTER (WHERE COALESCE(bla.costo_tiempo, 0) > 0) AS mo_ref
            FROM public.bunker_lista_articulos bla
            GROUP BY UPPER(BTRIM(bla.articulo_numero))
        )
        UPDATE public.bunker_articulos ba
        SET tarifa_colaborador_id = COALESCE(
                ba.tarifa_colaborador_id,
                (
                    SELECT ct.id
                    FROM public.colaboradores_tarifas ct
                    WHERE ct.usuario_id = NULLIF(ba.propiedades_dinamicas->>'asistente_colaborador_id', '')::int
                    ORDER BY COALESCE(ct.activo, true) DESC, ct.fecha_desde DESC NULLS LAST, ct.id DESC
                    LIMIT 1
                ),
                (SELECT id FROM tarifa_activa)
            ),
            minutos_mano_obra = COALESCE(
                ba.minutos_mano_obra,
                NULLIF(ba.propiedades_dinamicas->>'asistente_minutos', '')::numeric(10,4),
                CASE
                    WHEN COALESCE(rl.mo_ref, 0) > 0 AND COALESCE((SELECT valor_hora FROM tarifa_activa), 0) > 0
                        THEN ROUND((rl.mo_ref / ((SELECT valor_hora FROM tarifa_activa) / 60.0))::numeric, 4)
                    ELSE NULL
                END
            )
        FROM ref_lista rl
        WHERE UPPER(BTRIM(ba.articulo_id)) = rl.sku_upper
          AND (ba.minutos_mano_obra IS NULL OR ba.tarifa_colaborador_id IS NULL);

        UPDATE public.bunker_articulos ba
        SET tarifa_colaborador_id = COALESCE(
                ba.tarifa_colaborador_id,
                (
                    SELECT ct.id
                    FROM public.colaboradores_tarifas ct
                    WHERE ct.usuario_id = NULLIF(ba.propiedades_dinamicas->>'asistente_colaborador_id', '')::int
                    ORDER BY COALESCE(ct.activo, true) DESC, ct.fecha_desde DESC NULLS LAST, ct.id DESC
                    LIMIT 1
                )
            ),
            minutos_mano_obra = COALESCE(
                ba.minutos_mano_obra,
                NULLIF(ba.propiedades_dinamicas->>'asistente_minutos', '')::numeric(10,4)
            )
        WHERE (ba.minutos_mano_obra IS NULL AND NULLIF(ba.propiedades_dinamicas->>'asistente_minutos', '') IS NOT NULL)
           OR (ba.tarifa_colaborador_id IS NULL AND NULLIF(ba.propiedades_dinamicas->>'asistente_colaborador_id', '') IS NOT NULL);

        WITH tarifa_activa AS (
            SELECT id, valor_hora
            FROM public.colaboradores_tarifas
            WHERE COALESCE(activo, true) = true
            ORDER BY fecha_desde DESC NULLS LAST, id DESC
            LIMIT 1
        )
        UPDATE public.bunker_lista_articulos bla
        SET tarifa_colaborador_id = COALESCE(bla.tarifa_colaborador_id, ba.tarifa_colaborador_id, (SELECT id FROM tarifa_activa)),
            minutos_mano_obra = COALESCE(
                bla.minutos_mano_obra,
                CASE
                    WHEN COALESCE(bla.costo_tiempo, 0) > 0 AND COALESCE((SELECT valor_hora FROM tarifa_activa), 0) > 0
                        THEN ROUND((bla.costo_tiempo / ((SELECT valor_hora FROM tarifa_activa) / 60.0))::numeric, 4)
                    ELSE ba.minutos_mano_obra
                END
            )
        FROM public.bunker_articulos ba
        WHERE UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(bla.articulo_numero))
          AND (COALESCE(bla.costo_tiempo, 0) > 0 OR ba.minutos_mano_obra IS NOT NULL)
          AND (bla.minutos_mano_obra IS NULL OR bla.tarifa_colaborador_id IS NULL);
    `);

    // 9. Backfill determinista de recetas.articulo_sugerido_numero en recetas mono-ingrediente donde hoy es NULL
    await client.query(`
        WITH ri_mono AS (
            SELECT ri.receta_id,
                   COUNT(*) FILTER (WHERE i.rol_ingrediente <> 'INSUMO_EMPAQUE')::int AS mp_cnt,
                   MIN(NULLIF(BTRIM(i.articulo_vinculado_numero), '')) FILTER (WHERE i.rol_ingrediente <> 'INSUMO_EMPAQUE') AS vinc_sku
            FROM public.receta_ingredientes ri
            JOIN public.ingredientes i ON i.id = ri.ingrediente_id
            GROUP BY ri.receta_id
        )
        UPDATE public.recetas r
        SET articulo_sugerido_numero = m.vinc_sku
        FROM ri_mono m
        WHERE r.id = m.receta_id
          AND NULLIF(BTRIM(COALESCE(r.articulo_sugerido_numero, '')), '') IS NULL
          AND m.mp_cnt = 1
          AND m.vinc_sku IS NOT NULL
          AND UPPER(BTRIM(m.vinc_sku)) <> UPPER(BTRIM(r.articulo_numero));
    `);
}

module.exports = {
    COLS_APER_ETAPA2,
    INDICES_ETAPA2,
    esquemaEtapa2YaAplicado,
    ejecutarMigracionEsquemaEtapa2Nodos
};
