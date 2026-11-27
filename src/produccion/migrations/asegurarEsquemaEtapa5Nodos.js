'use strict';

/**
 * ============================================================================
 * MIGRACIÓN Y BOOTSTRAP ETAPA 5 — EXTIRPACIÓN TOTAL DE HEURÍSTICAS DE TEXTO
 * ============================================================================
 * - Incorpora en `public.ingredientes`:
 *   - `activo BOOLEAN NOT NULL DEFAULT true` (marca `#137` y `#138` con `activo = false`
 *     por ID auditado en migración única, reemplazando `ILIKE '%Fuera de Servicio%'`).
 *   - `capacidad_max_kg NUMERIC(10,3)` y `es_envase_fraccionamiento BOOLEAN NOT NULL DEFAULT false`
 *     para sugerir envases desde BD sin arrays/IDs hardcodeados en JS.
 * - Incorpora en `public.bunker_familia_categorias`:
 *   - `es_eje_presentacion BOOLEAN NOT NULL DEFAULT false` con backfill determinista
 *     para que Caso B identifique ejes de presentación sin regex por nombre.
 * - Verificación fast-path 100% read-only para cero DDL en hot paths HTTP.
 */

const INDICES_REQUERIDOS_ETAPA5 = [
    'idx_ingredientes_activo_rol'
];

async function esquemaEtapa5YaAplicado(client) {
    const res = await client.query(
        `SELECT
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ingredientes'
                  AND column_name = 'activo'
                  AND is_nullable = 'NO'
            ) AS col_ing_activo_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ingredientes'
                  AND column_name = 'capacidad_max_kg'
            ) AS col_ing_cap_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'ingredientes'
                  AND column_name = 'es_envase_fraccionamiento'
                  AND is_nullable = 'NO'
            ) AS col_ing_env_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'bunker_familia_categorias'
                  AND column_name = 'es_eje_presentacion'
                  AND is_nullable = 'NO'
            ) AS col_bfc_pres_ok,
            (
                SELECT COUNT(*)::int
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = ANY($1::text[])
            ) AS indices_cnt`,
        [INDICES_REQUERIDOS_ETAPA5]
    );
    const r = res.rows[0] || {};
    return Boolean(
        r.col_ing_activo_ok
        && r.col_ing_cap_ok
        && r.col_ing_env_ok
        && r.col_bfc_pres_ok
        && Number(r.indices_cnt || 0) === INDICES_REQUERIDOS_ETAPA5.length
    );
}

async function ejecutarMigracionEsquemaEtapa5Nodos(client) {
    // 1. Columnas estructurales en public.ingredientes (sin backfill por texto)
    const yaTeniaColActivoRes = await client.query(`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'ingredientes'
              AND column_name = 'activo'
        ) AS existe
    `);
    const yaTeniaColActivo = Boolean(yaTeniaColActivoRes.rows[0]?.existe);

    await client.query(`
        ALTER TABLE public.ingredientes
            ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS capacidad_max_kg NUMERIC(10,3),
            ADD COLUMN IF NOT EXISTS es_envase_fraccionamiento BOOLEAN NOT NULL DEFAULT false;

        UPDATE public.ingredientes
        SET activo = true
        WHERE activo IS NULL;

        ALTER TABLE public.ingredientes
            ALTER COLUMN activo SET DEFAULT true,
            ALTER COLUMN activo SET NOT NULL,
            ALTER COLUMN es_envase_fraccionamiento SET DEFAULT false,
            ALTER COLUMN es_envase_fraccionamiento SET NOT NULL;
    `);

    if (!yaTeniaColActivo) {
        await client.query(`
            UPDATE public.ingredientes
            SET activo = false,
                habilitado_solicitud_nodos = false
            WHERE id IN (137, 138);
        `);
    }

    // 2. Backfill inicial único de capacidad_max_kg y es_envase_fraccionamiento sobre insumos de empaque
    await client.query(`
        UPDATE public.ingredientes
        SET capacidad_max_kg = CASE id
                WHEN 181 THEN 0.080
                WHEN 180 THEN 0.300
                WHEN 179 THEN 0.600
                WHEN 178 THEN 1.500
                WHEN 177 THEN 5.000
                WHEN 176 THEN 5.000
                WHEN 175 THEN 10.000
                WHEN 182 THEN 12.000
                WHEN 183 THEN 15.000
                ELSE capacidad_max_kg
            END,
            es_envase_fraccionamiento = CASE id
                WHEN 180 THEN true
                WHEN 179 THEN true
                WHEN 178 THEN true
                WHEN 177 THEN true
                ELSE false
            END
        WHERE COALESCE(es_insumo, false) = true
          AND capacidad_max_kg IS NULL
          AND id IN (175, 176, 177, 178, 179, 180, 181, 182, 183);

        CREATE INDEX IF NOT EXISTS idx_ingredientes_activo_rol
            ON public.ingredientes (activo, rol_ingrediente, habilitado_solicitud_nodos);
    `);

    // 3. Booleano estructural es_eje_presentacion en public.bunker_familia_categorias
    const yaTeniaColPresRes = await client.query(`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'bunker_familia_categorias'
              AND column_name = 'es_eje_presentacion'
        ) AS existe
    `);
    const yaTeniaColPres = Boolean(yaTeniaColPresRes.rows[0]?.existe);

    await client.query(`
        ALTER TABLE public.bunker_familia_categorias
            ADD COLUMN IF NOT EXISTS es_eje_presentacion BOOLEAN NOT NULL DEFAULT false;

        UPDATE public.bunker_familia_categorias
        SET es_eje_presentacion = false
        WHERE es_eje_presentacion IS NULL;

        ALTER TABLE public.bunker_familia_categorias
            ALTER COLUMN es_eje_presentacion SET DEFAULT false,
            ALTER COLUMN es_eje_presentacion SET NOT NULL;
    `);

    if (!yaTeniaColPres) {
        await client.query(`
            UPDATE public.bunker_familia_categorias
            SET es_eje_presentacion = true
            WHERE LOWER(BTRIM(categoria)) = 'presentacion';
        `);
    }
}

async function asegurarEsquemaEtapa5Nodos(clientOrDb = null, opciones = {}) {
    const db = require('../config/database');
    const log = opciones?.log !== false;
    const ownsClient = !clientOrDb;
    const client = clientOrDb || (await db.connect());
    try {
        const ya = await esquemaEtapa5YaAplicado(client);
        if (ya) {
            if (log) console.log('✅ [ETAPA5-NODOS] Fast-path read-only OK (0 DDL emitidos).');
            return { fast_path: true, aplico_ddl: false };
        }
        if (ownsClient) await client.query('BEGIN');
        await ejecutarMigracionEsquemaEtapa5Nodos(client);
        if (ownsClient) await client.query('COMMIT');
        if (log) console.log('✅ [ETAPA5-NODOS] Columnas estructurales Etapa 5 aplicadas (cero heurísticas).');
        return { fast_path: false, aplico_ddl: true };
    } catch (err) {
        if (ownsClient) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        throw err;
    } finally {
        if (ownsClient) client.release();
    }
}

if (require.main === module) {
    const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
    const db = require('../config/database');
    asegurarEsquemaEtapa5Nodos(null, { log: true })
        .then(async (r) => {
            console.log('Resultado Etapa 5:', JSON.stringify(r));
            await db.end();
            setTimeout(() => process.exit(0), 150).unref();
        })
        .catch(async (err) => {
            console.error('❌ [ETAPA5-NODOS] Error:', err);
            await db.end().catch(() => {});
            setTimeout(() => process.exit(1), 150).unref();
        });
}

module.exports = {
    INDICES_REQUERIDOS_ETAPA5,
    esquemaEtapa5YaAplicado,
    ejecutarMigracionEsquemaEtapa5Nodos,
    asegurarEsquemaEtapa5Nodos
};
