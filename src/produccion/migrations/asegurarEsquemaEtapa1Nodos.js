'use strict';

/**
 * ============================================================================
 * MIGRACIÓN Y BOOTSTRAP CENTRALIZADO ETAPA 1 — MÓDULO DE NODOS
 * ============================================================================
 * - Erradica el 100% del DDL (CREATE/ALTER/INDEX) de los hot paths HTTP.
 * - Serializa la verificación inicial mediante PostgreSQL advisory lock
 *   (key 884201) para evitar deadlocks (40P01) cuando PM2 inicia en paralelo
 *   los servicios :3004 (producción) y :3005 (logística).
 * - Incluye fast-path read-only: si todas las tablas, columnas e integridad
 *   referencial de Etapa 1 ya existen, retorna sin emitir DDL ni AccessExclusiveLock.
 */

const fs = require('fs');
const db = require('../config/database');
const {
    esquemaEtapa2YaAplicado,
    ejecutarMigracionEsquemaEtapa2Nodos
} = require('./asegurarEsquemaEtapa2Nodos');
const {
    esquemaEtapa3YaAplicado,
    ejecutarMigracionEsquemaEtapa3Nodos
} = require('./asegurarEsquemaEtapa3Nodos');
const {
    esquemaEtapa4YaAplicado,
    ejecutarMigracionEsquemaEtapa4Nodos
} = require('./asegurarEsquemaEtapa4Nodos');
const {
    esquemaEtapa5YaAplicado,
    ejecutarMigracionEsquemaEtapa5Nodos
} = require('./asegurarEsquemaEtapa5Nodos');

const ADVISORY_LOCK_KEY_ETAPA1 = 884201;

const FKS_REQUERIDAS_ETAPA1 = [
    'fk_nodos_maestro_cliente_madre',
    'fk_nodos_maestro_bunker_cliente',
    'fk_nodos_maestro_lista_precio',
    'fk_nodos_maestro_cliente_operativo',
    'fk_nodos_cat_sku_bunker',
    'fk_nodos_cat_ingrediente',
    'fk_nodos_cat_envase',
    'fk_nodos_ofertas_nodo',
    'fk_nodos_ofertas_articulo'
];

const INDICES_REQUERIDOS_ETAPA1 = [
    'unq_nodos_maestro_bunker_cliente_id',
    'unq_nodos_maestro_cliente_operativo_id',
    'idx_nodos_maestro_cliente_madre_id',
    'idx_nodos_cat_ingrediente_origen_id',
    'idx_nodos_cat_insumo_envase_id',
    'idx_nodos_ofertas_nodo_id',
    'idx_nodos_ofertas_articulo_catalogo_id'
];

let _esquemaEtapa1Listo = false;
let _bootstrapEnCursoPromise = null;

function obtenerServiciosNodos() {
    return {
        nodosService: require('../services/nodosBarrialesService'),
        combosService: require('../services/combosCompuestosService'),
        analiticaService: require('../services/nodosAnaliticaService'),
        pagosService: require('../services/nodosPagosBancariosService')
    };
}

function marcarTodosLosServiciosListos() {
    const { nodosService, combosService, analiticaService, pagosService } = obtenerServiciosNodos();
    _esquemaEtapa1Listo = true;
    if (typeof nodosService.marcarEsquemaNodosListo === 'function') {
        nodosService.marcarEsquemaNodosListo(true);
    }
    if (typeof combosService.marcarEsquemaCombosListo === 'function') {
        combosService.marcarEsquemaCombosListo(true);
    }
    if (typeof analiticaService.marcarEsquemaAnaliticaListo === 'function') {
        analiticaService.marcarEsquemaAnaliticaListo(true);
    }
    if (typeof pagosService.marcarEsquemaPagosListo === 'function') {
        pagosService.marcarEsquemaPagosListo(true);
    }
    if (typeof pagosService.obtenerDirectorioComprobantesNodos === 'function') {
        try {
            fs.mkdirSync(pagosService.obtenerDirectorioComprobantesNodos(), { recursive: true });
        } catch (_) {}
    }
}

/**
 * Verificación 100% read-only (sin locks DDL) para determinar si Etapa 1 ya fue aplicada.
 */
async function esquemaEtapa1YaAplicado(client) {
    const res = await client.query(
        `SELECT
            (to_regclass('public.nodos_maestro') IS NOT NULL
             AND to_regclass('public.nodos_articulos_catalogo') IS NOT NULL
             AND to_regclass('public.nodos_ofertas_gestor') IS NOT NULL
             AND to_regclass('public.bunker_combos_componentes') IS NOT NULL
             AND to_regclass('public.nodos_tienda_eventos') IS NOT NULL
             AND to_regclass('public.nodos_pedidos_cobros_banco') IS NOT NULL) AS tablas_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'nodos_maestro'
                  AND column_name = 'cliente_operativo_id'
                  AND is_nullable = 'NO'
            ) AS col_cli_op_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'nodos_maestro'
                  AND column_name = 'cliente_madre_bunker_id'
                  AND is_nullable = 'NO'
            ) AS col_madre_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'nodos_maestro'
                  AND column_name = 'bunker_cliente_id'
                  AND is_nullable = 'NO'
            ) AS col_canal_ok,
            EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'nodos_maestro'
                  AND column_name = 'lista_precio_bunker_id'
                  AND is_nullable = 'NO'
            ) AS col_lista_ok,
            (
                SELECT COUNT(*)::int
                FROM pg_constraint
                WHERE contype = 'f'
                  AND conname = ANY($1::text[])
            ) AS fks_presentes,
            (
                SELECT COUNT(*)::int
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = ANY($2::text[])
            ) AS indices_presentes`,
        [FKS_REQUERIDAS_ETAPA1, INDICES_REQUERIDOS_ETAPA1]
    );

    const row = res.rows[0] || {};
    const etapa1Ok = Boolean(
        row.tablas_ok
        && row.col_cli_op_ok
        && row.col_madre_ok
        && row.col_canal_ok
        && row.col_lista_ok
        && Number(row.fks_presentes || 0) === FKS_REQUERIDAS_ETAPA1.length
        && Number(row.indices_presentes || 0) === INDICES_REQUERIDOS_ETAPA1.length
    );
    if (!etapa1Ok) return false;
    const etapa2Ok = await esquemaEtapa2YaAplicado(client);
    if (!etapa2Ok) return false;
    const etapa3Ok = await esquemaEtapa3YaAplicado(client);
    if (!etapa3Ok) return false;
    const etapa4Ok = await esquemaEtapa4YaAplicado(client);
    if (!etapa4Ok) return false;
    return esquemaEtapa5YaAplicado(client);
}

/**
 * Resuelve o crea la fila operativa en `public.clientes` para un nodo existente durante backfill.
 */
async function backfillClienteOperativoParaNodo(client, nodo) {
    if (nodo.cliente_operativo_id) {
        const chk = await client.query(
            'SELECT id, cliente_id FROM public.clientes WHERE id = $1 LIMIT 1',
            [Number(nodo.cliente_operativo_id)]
        );
        if (chk.rows.length > 0) {
            return {
                cliente_operativo_id: Number(chk.rows[0].id),
                cliente_id: Number(chk.rows[0].cliente_id)
            };
        }
    }

    const candidatoCodigo = 9000 + Number(nodo.id);
    const nombreCli = `NODO: ${nodo.nombre_marca}`;
    const apellidoCli = `(${nodo.gestor_nombre || nodo.nombre_marca})`;
    const telCli = nodo.gestor_telefono || '221-555-0100';

    const existPreferido = await client.query(
        'SELECT id, cliente_id FROM public.clientes WHERE cliente_id = $1 LIMIT 1',
        [candidatoCodigo]
    );
    let cliRow = existPreferido.rows[0] || null;

    if (cliRow) {
        const ocupado = await client.query(
            'SELECT id FROM public.nodos_maestro WHERE cliente_operativo_id = $1 AND id <> $2 LIMIT 1',
            [cliRow.id, Number(nodo.id)]
        );
        if (ocupado.rows.length > 0) {
            cliRow = null;
        }
    }

    if (!cliRow) {
        const maxRes = await client.query(
            `SELECT GREATEST(9000, COALESCE(MAX(cliente_id), 9000)) + 1 AS next_cliente_id
             FROM public.clientes
             WHERE cliente_id >= 9000`
        );
        const nextClienteId = Number(maxRes.rows[0]?.next_cliente_id || (9000 + Number(nodo.id)));
        const insCli = await client.query(
            `INSERT INTO public.clientes (cliente_id, nombre, apellido, telefono)
             VALUES ($1, $2, $3, $4)
             RETURNING id, cliente_id`,
            [nextClienteId, nombreCli, apellidoCli, telCli]
        );
        cliRow = insCli.rows[0];
    } else {
        await client.query(
            `UPDATE public.clientes
             SET nombre = $1, apellido = $2, telefono = $3
             WHERE id = $4`,
            [nombreCli, apellidoCli, telCli, cliRow.id]
        );
    }

    return {
        cliente_operativo_id: Number(cliRow.id),
        cliente_id: Number(cliRow.cliente_id)
    };
}

async function aplicarIntegridadReferencialEtapa1(client) {
    // 1. Nueva columna explícita cliente_operativo_id (reemplaza aritmética frágil 9000 + nodo.id)
    await client.query(`
        ALTER TABLE public.nodos_maestro
            ADD COLUMN IF NOT EXISTS cliente_operativo_id INTEGER;
    `);

    // 2. Backfill determinista antes de aplicar NOT NULL + FKs
    const listaDefaultRes = await client.query(
        `SELECT id FROM public.bunker_listas_precios
         WHERE canal_comercial = 'NODOS' OR LOWER(nombre) LIKE '%nodos barriales%'
         ORDER BY id ASC LIMIT 1`
    );
    const listaDefaultId = listaDefaultRes.rows[0]?.id ? Number(listaDefaultRes.rows[0].id) : null;

    const nodosRes = await client.query(
        `SELECT id, codigo_nodo, nombre_marca, gestor_nombre, gestor_telefono,
                direccion_retiro, barrio_zona, bunker_cliente_id, codigo_bunker_cliente,
                cliente_madre_bunker_id, codigo_bunker_cliente_madre,
                lista_precio_bunker_id, cliente_operativo_id
         FROM public.nodos_maestro
         ORDER BY id ASC`
    );

    const { nodosService } = obtenerServiciosNodos();
    for (const nodo of nodosRes.rows) {
        let bunkerClienteId = nodo.bunker_cliente_id ? Number(nodo.bunker_cliente_id) : null;
        let codigoBunkerCliente = String(nodo.codigo_bunker_cliente || '').trim();
        let clienteMadreId = nodo.cliente_madre_bunker_id ? Number(nodo.cliente_madre_bunker_id) : null;
        let listaPrecioId = nodo.lista_precio_bunker_id ? Number(nodo.lista_precio_bunker_id) : listaDefaultId;

        if (!bunkerClienteId && typeof nodosService.asegurarVinculoContableNodo === 'function') {
            const vinc = await nodosService.asegurarVinculoContableNodo(client, {
                codigo_nodo: nodo.codigo_nodo,
                nombre_marca: nodo.nombre_marca,
                gestor_nombre: nodo.gestor_nombre,
                gestor_telefono: nodo.gestor_telefono,
                direccion_retiro: nodo.direccion_retiro,
                barrio_zona: nodo.barrio_zona,
                cliente_madre_bunker_id: clienteMadreId,
                codigo_bunker_cliente_madre: nodo.codigo_bunker_cliente_madre,
                codigo_bunker_cliente: codigoBunkerCliente
            });
            bunkerClienteId = vinc.bunker_cliente_id;
            codigoBunkerCliente = vinc.codigo_bunker_cliente;
            clienteMadreId = vinc.cliente_madre_bunker_id || bunkerClienteId;
        } else if (bunkerClienteId) {
            // Sincronizar nombre visible de la subcuenta operativa CB-NODO-xxx con nombre_marca actual (ej. Lo de Mati -> Paraíso)
            await client.query(
                `UPDATE public.bunker_clientes
                 SET cliente_nombre = $1
                 WHERE id = $2
                   AND codigo_bunker_cliente LIKE 'CB-NODO-%'
                   AND cliente_nombre IS DISTINCT FROM $1`,
                [`[NODO] ${nodo.nombre_marca} (${nodo.gestor_nombre})`, bunkerClienteId]
            );
            if (!clienteMadreId) {
                clienteMadreId = bunkerClienteId;
            }
        }

        const cliOp = await backfillClienteOperativoParaNodo(client, nodo);

        await client.query(
            `UPDATE public.nodos_maestro
             SET bunker_cliente_id = COALESCE($2, bunker_cliente_id),
                 codigo_bunker_cliente = COALESCE(NULLIF($3, ''), codigo_bunker_cliente),
                 cliente_madre_bunker_id = COALESCE($4, cliente_madre_bunker_id),
                 lista_precio_bunker_id = COALESCE($5, lista_precio_bunker_id),
                 cliente_operativo_id = $6
             WHERE id = $1`,
            [nodo.id, bunkerClienteId, codigoBunkerCliente, clienteMadreId, listaPrecioId, cliOp.cliente_operativo_id]
        );

        if (bunkerClienteId && cliOp.cliente_id) {
            await client.query(
                `UPDATE public.bunker_clientes
                 SET lomas_soft_id = $1
                 WHERE id = $2
                   AND codigo_bunker_cliente LIKE 'CB-NODO-%'
                   AND (lomas_soft_id IS NULL OR lomas_soft_id <> $1)`,
                [String(cliOp.cliente_id), bunkerClienteId]
            );
        }
    }

    // 3. Reemplazar cualquier FK legacy en columnas clave de nodos_* y aplicar FKs + NOT NULL + índices Etapa 1
    await client.query(`
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN
                SELECT DISTINCT conrelid::regclass::text AS tabla, conname
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                WHERE c.contype = 'f'
                  AND c.connamespace = 'public'::regnamespace
                  AND (
                    (c.conrelid = 'public.nodos_maestro'::regclass AND a.attname IN ('cliente_madre_bunker_id', 'bunker_cliente_id', 'lista_precio_bunker_id', 'cliente_operativo_id'))
                    OR (c.conrelid = 'public.nodos_articulos_catalogo'::regclass AND a.attname IN ('sku_nodo', 'ingrediente_origen_id', 'insumo_envase_id'))
                    OR (c.conrelid = 'public.nodos_ofertas_gestor'::regclass AND a.attname IN ('nodo_id', 'articulo_catalogo_id'))
                  )
                  AND c.conname NOT IN (
                    'fk_nodos_maestro_cliente_madre',
                    'fk_nodos_maestro_bunker_cliente',
                    'fk_nodos_maestro_lista_precio',
                    'fk_nodos_maestro_cliente_operativo',
                    'fk_nodos_cat_sku_bunker',
                    'fk_nodos_cat_ingrediente',
                    'fk_nodos_cat_envase',
                    'fk_nodos_ofertas_nodo',
                    'fk_nodos_ofertas_articulo'
                  )
            LOOP
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tabla, r.conname);
            END LOOP;
        END $$;
    `);

    await client.query(`
        ALTER TABLE public.nodos_maestro
            ALTER COLUMN cliente_madre_bunker_id SET NOT NULL,
            ALTER COLUMN bunker_cliente_id SET NOT NULL,
            ALTER COLUMN lista_precio_bunker_id SET NOT NULL,
            ALTER COLUMN cliente_operativo_id SET NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_maestro_bunker_cliente_id
            ON public.nodos_maestro (bunker_cliente_id);

        CREATE UNIQUE INDEX IF NOT EXISTS unq_nodos_maestro_cliente_operativo_id
            ON public.nodos_maestro (cliente_operativo_id);

        CREATE INDEX IF NOT EXISTS idx_nodos_maestro_cliente_madre_id
            ON public.nodos_maestro (cliente_madre_bunker_id);

        CREATE INDEX IF NOT EXISTS idx_nodos_cat_ingrediente_origen_id
            ON public.nodos_articulos_catalogo (ingrediente_origen_id);

        CREATE INDEX IF NOT EXISTS idx_nodos_cat_insumo_envase_id
            ON public.nodos_articulos_catalogo (insumo_envase_id);

        CREATE INDEX IF NOT EXISTS idx_nodos_ofertas_nodo_id
            ON public.nodos_ofertas_gestor (nodo_id);

        CREATE INDEX IF NOT EXISTS idx_nodos_ofertas_articulo_catalogo_id
            ON public.nodos_ofertas_gestor (articulo_catalogo_id);

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_maestro_cliente_madre') THEN
                ALTER TABLE public.nodos_maestro
                    ADD CONSTRAINT fk_nodos_maestro_cliente_madre
                    FOREIGN KEY (cliente_madre_bunker_id) REFERENCES public.bunker_clientes(id) ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_maestro_bunker_cliente') THEN
                ALTER TABLE public.nodos_maestro
                    ADD CONSTRAINT fk_nodos_maestro_bunker_cliente
                    FOREIGN KEY (bunker_cliente_id) REFERENCES public.bunker_clientes(id) ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_maestro_lista_precio') THEN
                ALTER TABLE public.nodos_maestro
                    ADD CONSTRAINT fk_nodos_maestro_lista_precio
                    FOREIGN KEY (lista_precio_bunker_id) REFERENCES public.bunker_listas_precios(id) ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_maestro_cliente_operativo') THEN
                ALTER TABLE public.nodos_maestro
                    ADD CONSTRAINT fk_nodos_maestro_cliente_operativo
                    FOREIGN KEY (cliente_operativo_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_cat_sku_bunker') THEN
                ALTER TABLE public.nodos_articulos_catalogo
                    ADD CONSTRAINT fk_nodos_cat_sku_bunker
                    FOREIGN KEY (sku_nodo) REFERENCES public.bunker_articulos(articulo_id) ON UPDATE CASCADE ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_cat_ingrediente') THEN
                ALTER TABLE public.nodos_articulos_catalogo
                    ADD CONSTRAINT fk_nodos_cat_ingrediente
                    FOREIGN KEY (ingrediente_origen_id) REFERENCES public.ingredientes(id) ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_cat_envase') THEN
                ALTER TABLE public.nodos_articulos_catalogo
                    ADD CONSTRAINT fk_nodos_cat_envase
                    FOREIGN KEY (insumo_envase_id) REFERENCES public.ingredientes(id) ON DELETE RESTRICT;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_ofertas_nodo') THEN
                ALTER TABLE public.nodos_ofertas_gestor
                    ADD CONSTRAINT fk_nodos_ofertas_nodo
                    FOREIGN KEY (nodo_id) REFERENCES public.nodos_maestro(id) ON DELETE CASCADE;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_ofertas_articulo') THEN
                ALTER TABLE public.nodos_ofertas_gestor
                    ADD CONSTRAINT fk_nodos_ofertas_articulo
                    FOREIGN KEY (articulo_catalogo_id) REFERENCES public.nodos_articulos_catalogo(id) ON DELETE CASCADE;
            END IF;
        END $$;
    `);
}

/**
 * Ejecuta de forma idempotente el bootstrap completo de esquema Etapa 1.
 * @param {{ forzar?: boolean, sembrarDemo?: boolean, log?: boolean }} opciones
 */
async function inicializarEsquemaEtapa1Nodos(opciones = {}) {
    const forzar = Boolean(opciones && opciones.forzar === true);
    const sembrarDemo = Boolean(opciones && opciones.sembrarDemo === true);
    const logActivo = opciones?.log !== false;

    if (_esquemaEtapa1Listo && !forzar && !sembrarDemo) {
        return { fast_path: true, desde_memoria: true };
    }

    if (_bootstrapEnCursoPromise && !forzar && !sembrarDemo) {
        return _bootstrapEnCursoPromise;
    }

    const correrBootstrap = async () => {
        const client = await db.connect();
        let lockAdquirido = false;
        let aplicoDdl = false;
        try {
            await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY_ETAPA1]);
            lockAdquirido = true;

            const yaAplicado = (!forzar && !sembrarDemo)
                ? await esquemaEtapa1YaAplicado(client)
                : false;

            if (yaAplicado) {
                marcarTodosLosServiciosListos();
                if (logActivo) {
                    console.log('✅ [BOOTSTRAP-ETAPA1-NODOS] Fast-path read-only OK (0 DDL emitidos).');
                }
                return { fast_path: true, desde_memoria: false, aplico_ddl: false };
            }

            aplicoDdl = true;
            const { nodosService, combosService, analiticaService, pagosService } = obtenerServiciosNodos();

            await client.query('BEGIN');
            // Nota: ejecutarMigracionEsquemaNodosBarriales ya invoca ejecutarMigracionCombosCompuestos(client) antes de normalizar nodos_articulos_catalogo con es_combo.
            await nodosService.ejecutarMigracionEsquemaNodosBarriales(client, { sembrarDemo });
            await analiticaService.ejecutarMigracionAnaliticaNodos(client);
            await pagosService.ejecutarMigracionPagosBancariosNodos(client);
            await aplicarIntegridadReferencialEtapa1(client);
            await ejecutarMigracionEsquemaEtapa2Nodos(client);
            await ejecutarMigracionEsquemaEtapa3Nodos(client);
            await ejecutarMigracionEsquemaEtapa4Nodos(client);
            await ejecutarMigracionEsquemaEtapa5Nodos(client);
            await client.query('COMMIT');

            marcarTodosLosServiciosListos();

            if (typeof nodosService.sincronizarCanastosEstacionNodos === 'function') {
                await nodosService.sincronizarCanastosEstacionNodos();
            }

            if (logActivo) {
                console.log('✅ [BOOTSTRAP-ETAPA1-NODOS] Esquema e integridad referencial Etapa 1 aplicados y verificados.');
            }
            return { fast_path: false, desde_memoria: false, aplico_ddl: aplicoDdl };
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw err;
        } finally {
            if (lockAdquirido) {
                try { await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY_ETAPA1]); } catch (_) {}
            }
            client.release();
        }
    };

    if (!forzar && !sembrarDemo) {
        _bootstrapEnCursoPromise = correrBootstrap().finally(() => {
            _bootstrapEnCursoPromise = null;
        });
        return _bootstrapEnCursoPromise;
    }

    return correrBootstrap();
}

module.exports = {
    ADVISORY_LOCK_KEY_ETAPA1,
    FKS_REQUERIDAS_ETAPA1,
    INDICES_REQUERIDOS_ETAPA1,
    esquemaEtapa1YaAplicado,
    inicializarEsquemaEtapa1Nodos,
    aplicarIntegridadReferencialEtapa1
};
