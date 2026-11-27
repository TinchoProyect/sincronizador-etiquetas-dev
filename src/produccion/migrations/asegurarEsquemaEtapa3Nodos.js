'use strict';

/**
 * ============================================================================
 * MIGRACIÓN E INTEGRIDAD REFERENCIAL ETAPA 3 — NODOS, RESERVAS E IDEMPOTENCIA
 * ============================================================================
 * - Reserva temporal de stock en pedidos PENDIENTE_TRANSFERENCIA (TTL configurable
 *   en nodos_configuracion_canal.horas_reserva_transferencia_default).
 * - Histórico de precio vecino anterior en nodos_ofertas_gestor.
 * - Idempotencia estricta de egresos en stock_ventas_movimientos por pedido+SKU+origen.
 * - Taxonomía formal tipo_solicitud en nodos_propuestas_fracciones.
 * - 14 Foreign Keys físicas nuevas en propuestas, canastos, pedidos e ítems de Nodos.
 * - Verificación fast-path 100% read-only para evitar DDL en hot paths HTTP.
 */

const FKS_REQUERIDAS_ETAPA3 = [
    'fk_npf_nodo_solicitante',
    'fk_npf_ingrediente_sugerido',
    'fk_npf_insumo_envase_sugerido',
    'fk_npf_articulo_catalogo',
    'fk_npc_nodo_solicitante',
    'fk_npc_articulo_catalogo',
    'fk_npci_propuesta_combo',
    'fk_npci_componente_articulo',
    'fk_nle_nodo',
    'fk_npv_nodo',
    'fk_npv_lote_canasto',
    'fk_npv_presupuesto_local',
    'fk_npi_pedido',
    'fk_npi_articulo_catalogo'
];

const INDICES_REQUERIDOS_ETAPA3 = [
    'idx_npv_reserva_stock_activa',
    'unq_svm_egreso_pedido_sku_origen'
];

async function esquemaEtapa3YaAplicado(client) {
    const res = await client.query(
        `SELECT
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'nodos_pedidos_vecinos' AND column_name = 'reserva_stock_expira_at'
            ) AS col_npv_exp_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'nodos_pedidos_vecinos' AND column_name = 'reserva_stock_estado'
            ) AS col_npv_est_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'nodos_configuracion_canal' AND column_name = 'horas_reserva_transferencia_default'
            ) AS col_ncc_horas_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'nodos_ofertas_gestor' AND column_name = 'precio_venta_vecino_anterior'
            ) AS col_nog_prev_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'stock_ventas_movimientos' AND column_name = 'referencia_pedido_codigo'
            ) AS col_svm_ref_ok,
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'nodos_propuestas_fracciones' AND column_name = 'tipo_solicitud'
            ) AS col_npf_tipo_ok,
            EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_npv_reserva_stock_estado'
            ) AS chk_npv_est_ok,
            EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_npf_tipo_solicitud'
            ) AS chk_npf_tipo_ok,
            (
                SELECT COUNT(*)::int FROM pg_constraint
                WHERE contype = 'f' AND convalidated = true AND conname = ANY($1::text[])
            ) AS fks_cnt,
            (
                SELECT COUNT(*)::int FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = ANY($2::text[])
            ) AS indices_cnt`,
        [FKS_REQUERIDAS_ETAPA3, INDICES_REQUERIDOS_ETAPA3]
    );

    const r = res.rows[0] || {};
    return Boolean(
        r.col_npv_exp_ok
        && r.col_npv_est_ok
        && r.col_ncc_horas_ok
        && r.col_nog_prev_ok
        && r.col_svm_ref_ok
        && r.col_npf_tipo_ok
        && r.chk_npv_est_ok
        && r.chk_npf_tipo_ok
        && Number(r.fks_cnt || 0) === FKS_REQUERIDAS_ETAPA3.length
        && Number(r.indices_cnt || 0) === INDICES_REQUERIDOS_ETAPA3.length
    );
}

async function ejecutarMigracionEsquemaEtapa3Nodos(client) {
    // 1. Reserva temporal de stock en nodos_pedidos_vecinos + TTL default en nodos_configuracion_canal
    await client.query(`
        ALTER TABLE public.nodos_pedidos_vecinos
            ADD COLUMN IF NOT EXISTS reserva_stock_expira_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS reserva_stock_estado VARCHAR(30) NOT NULL DEFAULT 'NINGUNA';

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_npv_reserva_stock_estado') THEN
                ALTER TABLE public.nodos_pedidos_vecinos
                    ADD CONSTRAINT chk_npv_reserva_stock_estado
                    CHECK (reserva_stock_estado IN ('NINGUNA', 'ACTIVA', 'CONFIRMADA', 'LIBERADA', 'EXPIRADA'));
            END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_npv_reserva_stock_activa
            ON public.nodos_pedidos_vecinos (reserva_stock_estado, reserva_stock_expira_at)
            WHERE reserva_stock_estado = 'ACTIVA';

        ALTER TABLE public.nodos_configuracion_canal
            ADD COLUMN IF NOT EXISTS horas_reserva_transferencia_default NUMERIC(6,2) NOT NULL DEFAULT 24.00;
    `);

    // 2. Snapshot de precio vecino anterior en nodos_ofertas_gestor
    await client.query(`
        ALTER TABLE public.nodos_ofertas_gestor
            ADD COLUMN IF NOT EXISTS precio_venta_vecino_anterior NUMERIC(14,2);
    `);

    // 3. Idempotencia estricta de egresos de stock por pedido + SKU + origen
    await client.query(`
        ALTER TABLE public.stock_ventas_movimientos
            ADD COLUMN IF NOT EXISTS referencia_pedido_codigo VARCHAR(80);

        CREATE UNIQUE INDEX IF NOT EXISTS unq_svm_egreso_pedido_sku_origen
            ON public.stock_ventas_movimientos (
                UPPER(BTRIM(referencia_pedido_codigo)),
                UPPER(BTRIM(articulo_numero)),
                COALESCE(origen_ingreso, '')
            )
            WHERE referencia_pedido_codigo IS NOT NULL AND tipo = 'egreso_venta';
    `);

    // 4. Taxonomía tipo_solicitud en nodos_propuestas_fracciones + backfill determinista
    await client.query(`
        ALTER TABLE public.nodos_propuestas_fracciones
            ADD COLUMN IF NOT EXISTS tipo_solicitud VARCHAR(40) NOT NULL DEFAULT 'NUEVA_FRACCION';

        UPDATE public.nodos_propuestas_fracciones
        SET tipo_solicitud = CASE
            WHEN articulo_bunker_sugerido_codigo IS NOT NULL AND BTRIM(articulo_bunker_sugerido_codigo) <> ''
                THEN 'HABILITAR_SKU_EXISTENTE'
            ELSE 'NUEVA_FRACCION'
        END
        WHERE tipo_solicitud IS NULL
           OR tipo_solicitud NOT IN ('HABILITAR_SKU_EXISTENTE', 'NUEVA_FRACCION', 'NUEVO_PACK')
           OR (tipo_solicitud = 'NUEVA_FRACCION' AND articulo_bunker_sugerido_codigo IS NOT NULL AND BTRIM(articulo_bunker_sugerido_codigo) <> '');

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_npf_tipo_solicitud') THEN
                ALTER TABLE public.nodos_propuestas_fracciones
                    ADD CONSTRAINT chk_npf_tipo_solicitud
                    CHECK (tipo_solicitud IN ('HABILITAR_SKU_EXISTENTE', 'NUEVA_FRACCION', 'NUEVO_PACK'));
            END IF;
        END $$;
    `);

    // 5. Blindaje con 14 Foreign Keys físicas sobre propuestas, canastos, pedidos e ítems
    await client.query(`
        DO $$
        BEGIN
            -- nodos_propuestas_fracciones
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npf_nodo_solicitante') THEN
                ALTER TABLE public.nodos_propuestas_fracciones
                    ADD CONSTRAINT fk_npf_nodo_solicitante
                    FOREIGN KEY (nodo_solicitante_id) REFERENCES public.nodos_maestro(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npf_ingrediente_sugerido') THEN
                ALTER TABLE public.nodos_propuestas_fracciones
                    ADD CONSTRAINT fk_npf_ingrediente_sugerido
                    FOREIGN KEY (ingrediente_sugerido_id) REFERENCES public.ingredientes(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npf_insumo_envase_sugerido') THEN
                ALTER TABLE public.nodos_propuestas_fracciones
                    ADD CONSTRAINT fk_npf_insumo_envase_sugerido
                    FOREIGN KEY (insumo_envase_sugerido_id) REFERENCES public.ingredientes(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npf_articulo_catalogo') THEN
                ALTER TABLE public.nodos_propuestas_fracciones
                    ADD CONSTRAINT fk_npf_articulo_catalogo
                    FOREIGN KEY (articulo_catalogo_id) REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL;
            END IF;

            -- nodos_propuestas_combos
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npc_nodo_solicitante') THEN
                ALTER TABLE public.nodos_propuestas_combos
                    ADD CONSTRAINT fk_npc_nodo_solicitante
                    FOREIGN KEY (nodo_solicitante_id) REFERENCES public.nodos_maestro(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npc_articulo_catalogo') THEN
                ALTER TABLE public.nodos_propuestas_combos
                    ADD CONSTRAINT fk_npc_articulo_catalogo
                    FOREIGN KEY (articulo_catalogo_id) REFERENCES public.nodos_articulos_catalogo(id) ON DELETE SET NULL;
            END IF;

            -- nodos_propuestas_combos_items
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npci_propuesta_combo') THEN
                ALTER TABLE public.nodos_propuestas_combos_items
                    ADD CONSTRAINT fk_npci_propuesta_combo
                    FOREIGN KEY (propuesta_combo_id) REFERENCES public.nodos_propuestas_combos(id) ON DELETE CASCADE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npci_componente_articulo') THEN
                ALTER TABLE public.nodos_propuestas_combos_items
                    ADD CONSTRAINT fk_npci_componente_articulo
                    FOREIGN KEY (componente_articulo_id) REFERENCES public.bunker_articulos(articulo_id) ON DELETE RESTRICT;
            END IF;

            -- nodos_lotes_estacion
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nle_nodo') THEN
                ALTER TABLE public.nodos_lotes_estacion
                    ADD CONSTRAINT fk_nle_nodo
                    FOREIGN KEY (nodo_id) REFERENCES public.nodos_maestro(id) ON DELETE RESTRICT;
            END IF;

            -- nodos_pedidos_vecinos
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npv_nodo') THEN
                ALTER TABLE public.nodos_pedidos_vecinos
                    ADD CONSTRAINT fk_npv_nodo
                    FOREIGN KEY (nodo_id) REFERENCES public.nodos_maestro(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npv_lote_canasto') THEN
                ALTER TABLE public.nodos_pedidos_vecinos
                    ADD CONSTRAINT fk_npv_lote_canasto
                    FOREIGN KEY (lote_canasto_id) REFERENCES public.nodos_lotes_estacion(id) ON DELETE SET NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npv_presupuesto_local') THEN
                ALTER TABLE public.nodos_pedidos_vecinos
                    ADD CONSTRAINT fk_npv_presupuesto_local
                    FOREIGN KEY (presupuesto_id_local) REFERENCES public.presupuestos(id) ON DELETE SET NULL;
            END IF;

            -- nodos_pedidos_items
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npi_pedido') THEN
                ALTER TABLE public.nodos_pedidos_items
                    ADD CONSTRAINT fk_npi_pedido
                    FOREIGN KEY (pedido_id) REFERENCES public.nodos_pedidos_vecinos(id) ON DELETE CASCADE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_npi_articulo_catalogo') THEN
                ALTER TABLE public.nodos_pedidos_items
                    ADD CONSTRAINT fk_npi_articulo_catalogo
                    FOREIGN KEY (articulo_catalogo_id) REFERENCES public.nodos_articulos_catalogo(id) ON DELETE RESTRICT;
            END IF;
        END $$;
    `);
}

module.exports = {
    FKS_REQUERIDAS_ETAPA3,
    INDICES_REQUERIDOS_ETAPA3,
    esquemaEtapa3YaAplicado,
    ejecutarMigracionEsquemaEtapa3Nodos
};
