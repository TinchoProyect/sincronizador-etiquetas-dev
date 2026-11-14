/**
 * Helper compartido para la resolucion contable y visibilidad de Cuentas Madre Unificadas en Nodos Barriales.
 * Single Source of Truth consumida por Produccion (Nodos), Logistica (Cta. Cte., Búnker, Sobres) y Facturacion (Bancos, ARCA).
 */

/**
 * Devuelve una clausula SQL `NOT EXISTS (...)` para excluir subcuentas `CB-NODO-...`
 * cuyo Nodo tiene `usar_cuenta_madre_unificada = true` y un `cliente_madre_bunker_id` valido distinto.
 *
 * @param {string} [alias='c'] - Alias de la tabla `public.bunker_clientes` en la consulta.
 * @returns {string} Expresion booleana SQL segura para usar en `WHERE`.
 */
function sqlExcluirSubcuentasNodosUnificadas(alias = 'c') {
    const cleanAlias = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias) ? alias : 'c';
    return `NOT EXISTS (
        SELECT 1
        FROM public.nodos_maestro nm_unif
        WHERE COALESCE(nm_unif.usar_cuenta_madre_unificada, false) = true
          AND nm_unif.cliente_madre_bunker_id IS NOT NULL
          AND nm_unif.bunker_cliente_id = ${cleanAlias}.id
          AND nm_unif.cliente_madre_bunker_id <> ${cleanAlias}.id
    )`;
}

/**
 * Agrega de forma idempotente la referencia operativa `Nodo <Marca>` a una descripcion/concepto contable.
 *
 * @param {string} [descripcion='']
 * @param {string} [nombreMarca='']
 * @returns {string}
 */
function agregarReferenciaNodoADescripcion(descripcion = '', nombreMarca = '') {
    const base = String(descripcion || '').trim();
    const marca = String(nombreMarca || '').trim();
    if (!marca) return base;

    const tag = `Nodo ${marca}`;
    if (!base) return tag;

    const norm = (txt) => txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (norm(base).includes(norm(tag))) {
        return base;
    }
    return `${base} — ${tag}`;
}

/**
 * Resuelve si un cliente Bunker o cuenta corriente corresponde a una subcuenta operativa de Nodo
 * configurada con `usar_cuenta_madre_unificada = true` y cliente madre valido.
 *
 * @param {Object} db - Pool o pg.Client
 * @param {Object} [criterio]
 * @param {number} [criterio.bunkerClienteId]
 * @param {string} [criterio.codigoBunkerCliente]
 * @param {number} [criterio.cuentaCorrienteId]
 * @returns {Promise<Object>} Estado de unificacion contable y ficha madre destino si aplica.
 */
async function resolverDestinoContableClienteBunker(db, criterio = {}) {
    const bunkerId = criterio.bunkerClienteId ? Number(criterio.bunkerClienteId) : null;
    const codigoBunker = criterio.codigoBunkerCliente ? String(criterio.codigoBunkerCliente).trim() : null;
    const cuentaCorrienteId = criterio.cuentaCorrienteId ? Number(criterio.cuentaCorrienteId) : null;

    const noUnificado = {
        unificada: false,
        nodoId: null,
        codigoNodo: null,
        nombreMarca: null,
        etiquetaNodo: null,
        subcuentaBunkerId: bunkerId,
        subcuentaCodigoBunker: codigoBunker,
        madreBunkerId: null,
        madreCodigoBunker: null,
        madreRazonSocial: null,
        madreClienteNombre: null,
        madreLomasSoftId: null
    };

    if (!db || (!bunkerId && !codigoBunker && !cuentaCorrienteId)) {
        return noUnificado;
    }

    try {
        let codigoResuelto = codigoBunker;
        let bunkerIdResuelto = bunkerId;

        if (cuentaCorrienteId && !codigoResuelto) {
            const ccRes = await db.query(
                `SELECT codigo_bunker_cliente FROM public.factura_cuentas_corrientes WHERE id = $1 LIMIT 1`,
                [cuentaCorrienteId]
            );
            if (ccRes.rows.length > 0) {
                codigoResuelto = String(ccRes.rows[0].codigo_bunker_cliente || '').trim() || null;
            }
        }

        if (!bunkerIdResuelto && !codigoResuelto) {
            return noUnificado;
        }

        const res = await db.query(
            `SELECT nm.id AS nodo_id,
                    nm.codigo_nodo,
                    nm.nombre_marca,
                    COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                    nm.bunker_cliente_id AS subcuenta_bunker_id,
                    nm.codigo_bunker_cliente AS subcuenta_codigo_bunker,
                    nm.cliente_madre_bunker_id AS madre_bunker_id,
                    bc_m.codigo_bunker_cliente AS madre_codigo_bunker,
                    bc_m.razon_social AS madre_razon_social,
                    bc_m.cliente_nombre AS madre_cliente_nombre,
                    bc_m.lomas_soft_id AS madre_lomas_soft_id
             FROM public.nodos_maestro nm
             LEFT JOIN public.bunker_clientes bc_m ON bc_m.id = nm.cliente_madre_bunker_id
             WHERE ($1::int IS NOT NULL AND nm.bunker_cliente_id = $1::int)
                OR ($2::text IS NOT NULL AND UPPER(COALESCE(nm.codigo_bunker_cliente, '')) = UPPER($2::text))
             ORDER BY nm.id ASC
             LIMIT 1`,
            [Number.isFinite(bunkerIdResuelto) ? bunkerIdResuelto : null, codigoResuelto]
        );

        if (res.rows.length === 0) {
            return noUnificado;
        }

        const row = res.rows[0];
        const madreCodigo = String(row.madre_codigo_bunker || '').trim();
        const madreId = row.madre_bunker_id ? Number(row.madre_bunker_id) : null;
        const subId = row.subcuenta_bunker_id ? Number(row.subcuenta_bunker_id) : null;
        const unificada = Boolean(
            row.usar_cuenta_madre_unificada === true &&
            madreId &&
            madreCodigo &&
            (!subId || madreId !== subId)
        );

        return {
            unificada,
            nodoId: Number(row.nodo_id),
            codigoNodo: row.codigo_nodo || null,
            nombreMarca: row.nombre_marca || null,
            etiquetaNodo: row.nombre_marca ? `Nodo ${row.nombre_marca}` : 'Nodo',
            subcuentaBunkerId: subId,
            subcuentaCodigoBunker: row.subcuenta_codigo_bunker || null,
            madreBunkerId: madreId,
            madreCodigoBunker: madreCodigo || null,
            madreRazonSocial: row.madre_razon_social || null,
            madreClienteNombre: row.madre_cliente_nombre || null,
            madreLomasSoftId: row.madre_lomas_soft_id || null
        };
    } catch (err) {
        // Fallback seguro ante tablas o columnas no migradas todavia
        if (err && (err.code === '42703' || err.code === '42P01')) {
            return noUnificado;
        }
        throw err;
    }
}

/**
 * Obtiene o crea la "Cuenta Principal" activa de un cliente Bunker en `factura_cuentas_corrientes`.
 * Acepta `forUpdate: true` cuando se invoca dentro de una transaccion con `pg.Client`.
 *
 * @param {Object} dbClient
 * @param {string} codigoBunkerCliente
 * @param {Object} [opts]
 * @param {boolean} [opts.forUpdate=false]
 * @param {boolean} [opts.crearSiNoExiste=true]
 * @returns {Promise<{ id: number, saldo: number, nombre_cuenta: string, estado: string }|null>}
 */
async function obtenerOCrearCuentaPrincipalBunker(dbClient, codigoBunkerCliente, opts = {}) {
    const cod = String(codigoBunkerCliente || '').trim();
    if (!cod) return null;

    const forUpdateClause = opts.forUpdate ? ' FOR UPDATE' : '';
    const res = await dbClient.query(
        `SELECT id, codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura, estado
         FROM public.factura_cuentas_corrientes
         WHERE codigo_bunker_cliente = $1
         ORDER BY
             CASE WHEN COALESCE(estado, 'ACTIVA') <> 'ARCHIVADA_UNIFICADA' THEN 0 ELSE 1 END,
             CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END,
             id ASC
         LIMIT 1${forUpdateClause}`,
        [cod]
    );

    if (res.rows.length > 0) {
        return res.rows[0];
    }

    if (opts.crearSiNoExiste === false) {
        return null;
    }

    const ins = await dbClient.query(
        `INSERT INTO public.factura_cuentas_corrientes (
            codigo_bunker_cliente, nombre_cuenta, moneda, saldo, estado, saldo_apertura
         ) VALUES ($1, 'Cuenta Principal', 'ARS', 0.00, 'ACTIVA', 0.00)
         RETURNING id, codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura, estado`,
        [cod]
    );
    return ins.rows[0];
}

module.exports = {
    sqlExcluirSubcuentasNodosUnificadas,
    agregarReferenciaNodoADescripcion,
    resolverDestinoContableClienteBunker,
    obtenerOCrearCuentaPrincipalBunker
};
