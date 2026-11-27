'use strict';

/**
 * ============================================================================
 * MIGRACIÓN Y BOOTSTRAP ETAPA 4 — GOBERNANZA EN 3 NIVELES E ÍNDICES DE ESCALA
 * ============================================================================
 * - Agrega `habilitado_lamda BOOLEAN NOT NULL DEFAULT true` en
 *   `public.nodos_ofertas_gestor` (Nivel 2: disponibilidad LAMDA por Nodo,
 *   independiente de Nivel 1 Global `nodos_articulos_catalogo.activo` y de
 *   Nivel 3 Tienda `nodos_ofertas_gestor.publicado_tienda`).
 * - Crea índice compuesto `idx_nog_nodo_hab_pub` para acelerar consultas
 *   modulares y portales `/gestor` y `/tienda`.
 * - Verificación fast-path 100% read-only para cero DDL en hot paths HTTP.
 */

const INDICES_REQUERIDOS_ETAPA4 = [
    'idx_nog_nodo_hab_pub'
];

async function esquemaEtapa4YaAplicado(client) {
    const res = await client.query(
        `SELECT
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'nodos_ofertas_gestor'
                  AND column_name = 'habilitado_lamda'
                  AND is_nullable = 'NO'
            ) AS col_habilitado_ok,
            (
                SELECT COUNT(*)::int
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = ANY($1::text[])
            ) AS indices_cnt`,
        [INDICES_REQUERIDOS_ETAPA4]
    );
    const r = res.rows[0] || {};
    return Boolean(
        r.col_habilitado_ok
        && Number(r.indices_cnt || 0) === INDICES_REQUERIDOS_ETAPA4.length
    );
}

async function ejecutarMigracionEsquemaEtapa4Nodos(client) {
    await client.query(`
        ALTER TABLE public.nodos_ofertas_gestor
            ADD COLUMN IF NOT EXISTS habilitado_lamda BOOLEAN NOT NULL DEFAULT true;

        UPDATE public.nodos_ofertas_gestor
        SET habilitado_lamda = true
        WHERE habilitado_lamda IS NULL;

        ALTER TABLE public.nodos_ofertas_gestor
            ALTER COLUMN habilitado_lamda SET DEFAULT true,
            ALTER COLUMN habilitado_lamda SET NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_nog_nodo_hab_pub
            ON public.nodos_ofertas_gestor (nodo_id, habilitado_lamda, publicado_tienda);
    `);
}

async function asegurarEsquemaEtapa4Nodos(clientOrDb = null, opciones = {}) {
    const db = require('../config/database');
    const log = opciones?.log !== false;
    const ownsClient = !clientOrDb;
    const client = clientOrDb || (await db.connect());
    try {
        const ya = await esquemaEtapa4YaAplicado(client);
        if (ya) {
            if (log) console.log('✅ [ETAPA4-NODOS] Fast-path read-only OK (0 DDL emitidos).');
            return { fast_path: true, aplico_ddl: false };
        }
        if (ownsClient) await client.query('BEGIN');
        await ejecutarMigracionEsquemaEtapa4Nodos(client);
        if (ownsClient) await client.query('COMMIT');
        if (log) console.log('✅ [ETAPA4-NODOS] Columna habilitado_lamda e índice idx_nog_nodo_hab_pub aplicados.');
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
    asegurarEsquemaEtapa4Nodos(null, { log: true })
        .then(async (r) => {
            console.log('Resultado Etapa 4:', JSON.stringify(r));
            await db.end();
            setTimeout(() => process.exit(0), 150).unref();
        })
        .catch(async (err) => {
            console.error('❌ Error migración Etapa 4:', err);
            try { await db.end(); } catch (_) {}
            setTimeout(() => process.exit(1), 150).unref();
        });
}

module.exports = {
    INDICES_REQUERIDOS_ETAPA4,
    esquemaEtapa4YaAplicado,
    ejecutarMigracionEsquemaEtapa4Nodos,
    asegurarEsquemaEtapa4Nodos
};
