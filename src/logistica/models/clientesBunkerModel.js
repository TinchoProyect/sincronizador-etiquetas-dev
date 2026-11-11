/**
 * Modelo de Clientes Búnker
 * Capa de acceso a datos para la tabla public.bunker_clientes.
 * Gestiona el alta local, la edición y el acoplamiento flexible con el ID externo de Lomas Soft.
 */

const { pool } = require('../config/database');

let _indicesClientesPromise = null;
function asegurarIndicesClientesBunker() {
    if (!_indicesClientesPromise) {
        _indicesClientesPromise = (async () => {
            try {
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_portal_inv_cliente_usado
                        ON public.portal_invitaciones (cliente_id) WHERE usado = true;
                    CREATE INDEX IF NOT EXISTS idx_bunker_clp_cliente_id
                        ON public.bunker_cliente_listas_precios (bunker_cliente_id);
                    CREATE INDEX IF NOT EXISTS idx_clientes_domicilios_id_cliente
                        ON public.clientes_domicilios (id_cliente);
                    CREATE INDEX IF NOT EXISTS idx_factura_cc_codigo_bunker
                        ON public.factura_cuentas_corrientes (codigo_bunker_cliente);
                `);
            } catch (err) {
                console.warn('⚠️ [CLIENTES-MODEL] No se pudieron asegurar índices auxiliares:', err.message);
            }
        })();
    }
    return _indicesClientesPromise;
}
setImmediate(() => { asegurarIndicesClientesBunker(); });

class ClientesBunkerModel {
    /**
     * Obtener todos los clientes con agregaciones single-pass en CTEs (cero N+1)
     * e índice liviano de domicilios y vecinos de Nodo para filtrado instantáneo en navegador.
     * @param {Object} params - Parámetros opcionales de búsqueda
     * @param {string} [params.search] - Texto opcional a buscar en backend
     * @returns {Promise<Array>} Lista consolidada de clientes
     */
    static async obtenerTodos({ search } = {}) {
        const cleanSearch = typeof search === 'string' ? search.trim() : '';
        const rawDigits = cleanSearch.replace(/\D+/g, '');
        let normDigits = rawDigits;
        if (normDigits.startsWith('549') && normDigits.length >= 12) normDigits = normDigits.slice(3);
        else if (normDigits.startsWith('54') && normDigits.length >= 11) normDigits = normDigits.slice(2);
        if (normDigits.startsWith('0')) normDigits = normDigits.slice(1);
        const searchDigitsPattern = normDigits.length >= 4 ? `%${normDigits}%` : '__NO_DIGIT_MATCH__';

        const params = [];
        let vecinosMatchExpr = '0';
        if (cleanSearch) {
            params.push(`%${cleanSearch}%`, searchDigitsPattern);
            vecinosMatchExpr = `(
                SELECT COUNT(*)::int
                FROM public.nodos_vecinos nv_s
                WHERE nv_s.nodo_id = nm.id
                  AND COALESCE(nv_s.activo, true) = true
                  AND (
                      nv_s.nombre_completo ILIKE $1
                      OR COALESCE(nv_s.codigo_vecino, '') ILIKE $1
                      OR COALESCE(nv_s.telefono_whatsapp, '') ILIKE $1
                      OR COALESCE(nv_s.telefono_normalizado, '') ILIKE $1
                      OR COALESCE(nv_s.titular_transferencia_habitual, '') ILIKE $1
                      OR COALESCE(nv_s.direccion_calle, '') ILIKE $1
                      OR COALESCE(nv_s.telefono_normalizado, '') LIKE $2
                  )
            )`;
        }

        let query = `
            WITH cc_principal AS (
                SELECT DISTINCT ON (codigo_bunker_cliente)
                    codigo_bunker_cliente,
                    id AS cuenta_corriente_id,
                    saldo
                FROM public.factura_cuentas_corrientes
                WHERE codigo_bunker_cliente IS NOT NULL
                ORDER BY codigo_bunker_cliente,
                         CASE WHEN nombre_cuenta = 'Cuenta Principal' THEN 0 ELSE 1 END,
                         id ASC
            ),
            inv_activas AS (
                SELECT DISTINCT cliente_id
                FROM public.portal_invitaciones
                WHERE usado = true AND cliente_id IS NOT NULL
            ),
            listas_agg AS (
                SELECT clp.bunker_cliente_id,
                       JSON_AGG(JSON_BUILD_OBJECT('id', lp.id, 'nombre', lp.nombre) ORDER BY lp.id) AS listas_precios
                FROM public.bunker_cliente_listas_precios clp
                JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
                GROUP BY clp.bunker_cliente_id
            ),
            doms_agg AS (
                SELECT cd.id_cliente,
                       STRING_AGG(
                           TRIM(COALESCE(cd.alias, '') || ' ' || COALESCE(cd.direccion, '') || ' ' || COALESCE(cd.localidad, '')),
                           ' | '
                       ) AS domicilios_texto
                FROM public.clientes_domicilios cd
                GROUP BY cd.id_cliente
            ),
            vecinos_agg AS (
                SELECT nv.nodo_id,
                       COUNT(*)::int AS cantidad_vecinos,
                       COUNT(*) FILTER (WHERE COALESCE(nv.saldo_actual, 0) > 0.01)::int AS vecinos_con_deuda,
                       COALESCE(SUM(nv.saldo_actual), 0)::numeric(14,2) AS total_saldo_vecinos,
                       JSON_AGG(
                           JSON_BUILD_OBJECT(
                               'id', nv.id,
                               'codigo_vecino', COALESCE(nv.codigo_vecino, ''),
                               'nombre_completo', COALESCE(nv.nombre_completo, ''),
                               'telefono_whatsapp', COALESCE(nv.telefono_whatsapp, ''),
                               'telefono_normalizado', COALESCE(nv.telefono_normalizado, ''),
                               'direccion_calle', COALESCE(nv.direccion_calle, ''),
                               'titular_habitual', COALESCE(nv.titular_transferencia_habitual, '')
                           ) ORDER BY nv.id ASC
                       ) AS vecinos_indice
                FROM public.nodos_vecinos nv
                WHERE COALESCE(nv.activo, true) = true
                GROUP BY nv.nodo_id
            ),
            efvo_nodos_agg AS (
                SELECT npv.nodo_id,
                       COALESCE(SUM(npv.total_vecino), 0)::numeric(14,2) AS efectivo_mano_gestor
                FROM public.nodos_pedidos_vecinos npv
                JOIN public.nodos_lotes_estacion nle ON nle.id = npv.lote_canasto_id
                WHERE COALESCE(nle.liquidacion_cerrada, false) = false
                  AND UPPER(COALESCE(npv.estado_operativo, '')) <> 'ANULADO'
                  AND UPPER(COALESCE(npv.medio_pago, '')) = 'EFECTIVO'
                  AND (COALESCE(npv.impactado_cta_cte_pago, false) = true OR UPPER(COALESCE(npv.estado_pago, '')) = 'COBRADO_EFECTIVO_GESTOR')
                GROUP BY npv.nodo_id
            ),
            nodos_agg AS (
                SELECT nm.id AS nodo_id,
                       nm.bunker_cliente_id,
                       nm.codigo_bunker_cliente,
                       JSON_BUILD_OBJECT(
                           'nodo_id', nm.id,
                           'codigo_nodo', nm.codigo_nodo,
                           'slug', nm.slug,
                           'nombre_marca', nm.nombre_marca,
                           'gestor_nombre', nm.gestor_nombre,
                           'gestor_telefono', nm.gestor_telefono,
                           'barrio_zona', nm.barrio_zona,
                           'color_primario', COALESCE(nm.color_primario, '#16a34a'),
                           'codigo_bunker_cliente_madre', nm.codigo_bunker_cliente_madre,
                           'cliente_madre_bunker_id', nm.cliente_madre_bunker_id,
                           'cliente_madre_nombre', COALESCE(bc_m.razon_social, bc_m.cliente_nombre),
                           'saldo_cuenta_madre', CASE WHEN nm.codigo_bunker_cliente_madre IS NOT NULL THEN COALESCE(cc_m.saldo, 0)::numeric(14,2) ELSE NULL END,
                           'cantidad_vecinos', COALESCE(va.cantidad_vecinos, 0),
                           'vecinos_con_deuda', COALESCE(va.vecinos_con_deuda, 0),
                           'total_saldo_vecinos', COALESCE(va.total_saldo_vecinos, 0)::numeric(14,2),
                           'efectivo_mano_gestor', COALESCE(ea.efectivo_mano_gestor, 0)::numeric(14,2),
                           'vecinos_coincidentes', ${vecinosMatchExpr},
                           'vecinos_indice', COALESCE(va.vecinos_indice, '[]'::json)
                       ) AS nodo_info
                FROM public.nodos_maestro nm
                LEFT JOIN public.bunker_clientes bc_m ON bc_m.id = nm.cliente_madre_bunker_id
                LEFT JOIN cc_principal cc_m ON cc_m.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
                LEFT JOIN vecinos_agg va ON va.nodo_id = nm.id
                LEFT JOIN efvo_nodos_agg ea ON ea.nodo_id = nm.id
            )
            SELECT c.id, c.codigo_bunker_cliente, c.cliente_nombre, c.razon_social, c.lomas_soft_id, c.cuit_cuil, c.condicion_iva, c.domicilio_fiscal, c.provincia, c.estado_clave, c.categoria_monotributo, c.actividad_principal, c.whatsapp_facturas, c.email_facturas, c.canal_envio_preferido, c.email_portal, c.email_portal_nombre, c.email_portal_cargo, c.preferencia_facturacion, COALESCE(c.ver_stock, false) as ver_stock, COALESCE(c.salvavidas_modo, 'HEREDAR_LISTA') as salvavidas_modo, c.created_at, c.updated_at,
                   cc.saldo, cc.cuenta_corriente_id,
                   (ia.cliente_id IS NOT NULL) as onboarding_completado,
                   COALESCE(la.listas_precios, '[]'::json) as listas_precios,
                   TRIM(COALESCE(da_bunker.domicilios_texto, '') || ' ' || COALESCE(da_legacy.domicilios_texto, '')) as domicilios_busqueda,
                   na.nodo_info
            FROM public.bunker_clientes c
            LEFT JOIN cc_principal cc ON cc.codigo_bunker_cliente = c.codigo_bunker_cliente
            LEFT JOIN inv_activas ia ON ia.cliente_id = c.codigo_bunker_cliente
            LEFT JOIN listas_agg la ON la.bunker_cliente_id = c.id
            LEFT JOIN doms_agg da_bunker ON da_bunker.id_cliente = c.id
            LEFT JOIN doms_agg da_legacy
              ON c.lomas_soft_id ~ '^[0-9]+$'
             AND LENGTH(c.lomas_soft_id) < 10
             AND c.lomas_soft_id::integer <> c.id
             AND da_legacy.id_cliente = c.lomas_soft_id::integer
            LEFT JOIN LATERAL (
                SELECT n.nodo_info
                FROM nodos_agg n
                WHERE n.bunker_cliente_id = c.id
                   OR n.codigo_bunker_cliente = c.codigo_bunker_cliente
                LIMIT 1
            ) na ON true
        `;

        if (cleanSearch) {
            query += `
                WHERE c.codigo_bunker_cliente ILIKE $1 
                   OR c.cliente_nombre ILIKE $1 
                   OR c.razon_social ILIKE $1 
                   OR c.lomas_soft_id ILIKE $1
                   OR c.cuit_cuil ILIKE $1
                   OR c.whatsapp_facturas ILIKE $1
                   OR c.email_facturas ILIKE $1
                   OR c.email_portal ILIKE $1
                   OR c.email_portal_nombre ILIKE $1
                   OR c.email_portal_cargo ILIKE $1
                   OR c.domicilio_fiscal ILIKE $1
                   OR COALESCE(da_bunker.domicilios_texto, '') ILIKE $1
                   OR COALESCE(da_legacy.domicilios_texto, '') ILIKE $1
                   OR (na.nodo_info IS NOT NULL AND COALESCE((na.nodo_info->>'vecinos_coincidentes')::int, 0) > 0)
            `;
        }

        query += ` ORDER BY CASE WHEN na.nodo_info IS NOT NULL THEN 0 ELSE 1 END, c.cliente_nombre ASC`;

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Obtener un cliente por su ID interno secuencial (PK)
     * @param {number} id - ID secuencial
     * @returns {Promise<Object|null>} Cliente encontrado o null
     */
    static async obtenerPorId(id) {
        const query = `
            SELECT c.id, c.codigo_bunker_cliente, c.cliente_nombre, c.razon_social, c.lomas_soft_id, c.cuit_cuil, c.condicion_iva, c.domicilio_fiscal, c.provincia, c.estado_clave, c.categoria_monotributo, c.actividad_principal, c.whatsapp_facturas, c.email_facturas, c.canal_envio_preferido, c.email_portal, c.email_portal_nombre, c.email_portal_cargo, c.preferencia_facturacion, COALESCE(c.ver_stock, false) as ver_stock, COALESCE(c.salvavidas_modo, 'HEREDAR_LISTA') as salvavidas_modo, c.created_at, c.updated_at,
                   cc.saldo, cc.id as cuenta_corriente_id,
                   EXISTS (
                       SELECT 1 FROM public.portal_invitaciones i 
                       WHERE i.cliente_id = c.codigo_bunker_cliente AND i.usado = true
                   ) as onboarding_completado,
                   COALESCE(
                       (SELECT JSON_AGG(JSON_BUILD_OBJECT('id', lp.id, 'nombre', lp.nombre))
                        FROM public.bunker_cliente_listas_precios clp
                        JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
                        WHERE clp.bunker_cliente_id = c.id),
                       '[]'::json
                   ) as listas_precios
            FROM public.bunker_clientes c
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = c.codigo_bunker_cliente
            WHERE c.codigo_bunker_cliente = $1::text
               OR c.lomas_soft_id = $1::text
               OR (CASE WHEN $1::text ~ '^[0-9]+$' AND LENGTH($1::text) < 10 THEN c.id = $1::integer ELSE false END)
               OR (LENGTH($1::text) <= 4 AND $1::text ~ '^[0-9]+$' AND c.lomas_soft_id = LPAD($1::text, 4, '0'))
            ORDER BY 
               CASE 
                  WHEN c.codigo_bunker_cliente = $1::text THEN 1
                  WHEN c.lomas_soft_id = $1::text THEN 2
                  WHEN $1::text !~ '^0' AND $1::text ~ '^[0-9]+$' AND LENGTH($1::text) < 10 AND c.id = $1::integer THEN 3
                  WHEN LENGTH($1::text) <= 4 AND $1::text ~ '^[0-9]+$' AND c.lomas_soft_id = LPAD($1::text, 4, '0') THEN 4
                  WHEN $1::text ~ '^[0-9]+$' AND LENGTH($1::text) < 10 AND c.id = $1::integer THEN 5
                  ELSE 6
               END ASC
            LIMIT 1
        `;
        const result = await pool.query(query, [id]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Obtener un cliente por su código búnker local para control de unicidad
     * @param {string} codigo - Código comercial único en LAMDA
     * @returns {Promise<Object|null>} Cliente encontrado o null
     */
    static async obtenerPorCodigoBunker(codigo) {
        const query = `
            SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, preferencia_facturacion, created_at, updated_at
            FROM public.bunker_clientes
            WHERE codigo_bunker_cliente = $1
        `;
        const result = await pool.query(query, [codigo]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Obtener un cliente por su ID externo de Lomas Soft para control de unicidad
     * @param {string} lomasSoftId - ID en el sistema externo
     * @returns {Promise<Object|null>} Cliente encontrado o null
     */
    static async obtenerPorLomasSoftId(lomasSoftId) {
        if (!lomasSoftId) return null;
        const query = `
            SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, created_at, updated_at
            FROM public.bunker_clientes
            WHERE lomas_soft_id = $1
        `;
        const result = await pool.query(query, [lomasSoftId]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Obtener todos los IDs de Lomas Soft asignados actualmente para calcular el siguiente disponible
     * @returns {Promise<string[]>} Array de códigos asignados
     */
    static async obtenerTodosLomasSoftIds() {
        const query = `
            SELECT lomas_soft_id 
            FROM public.bunker_clientes 
            WHERE lomas_soft_id IS NOT NULL
        `;
        const result = await pool.query(query);
        return result.rows.map(r => r.lomas_soft_id);
    }

    /**
     * Obtener un cliente por su CUIT/CUIL para control de unicidad (Fase 1 Fiscal)
     * @param {string} cuit - CUIT/CUIL (sanitizado, solo números)
     * @returns {Promise<Object|null>} Cliente encontrado o null
     */
    static async obtenerPorCuit(cuit) {
        if (!cuit) return null;
        const query = `
            SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, created_at, updated_at
            FROM public.bunker_clientes
            WHERE cuit_cuil = $1
            ORDER BY id ASC
            LIMIT 1
        `;
        const result = await pool.query(query, [cuit]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Obtener todos los registros que comparten un mismo CUIT/CUIL
     */
    static async obtenerTodosPorCuit(cuit) {
        if (!cuit) return [];
        const result = await pool.query(
            `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social
             FROM public.bunker_clientes
             WHERE cuit_cuil = $1
             ORDER BY id ASC`,
            [cuit]
        );
        return result.rows;
    }

    /**
     * Verifica si dos registros de bunker_clientes están legítimamente vinculados como
     * Cliente Madre (colaborador) <-> Registro Operativo de Nodo Barrial en nodos_maestro.
     */
    static async esParMadreNodoVinculado(idA, idB) {
        const a = Number(idA || 0);
        const b = Number(idB || 0);
        if (!a || !b || a === b) return false;
        const res = await pool.query(
            `SELECT 1
             FROM public.nodos_maestro
             WHERE (bunker_cliente_id = $1 AND cliente_madre_bunker_id = $2)
                OR (bunker_cliente_id = $2 AND cliente_madre_bunker_id = $1)
             LIMIT 1`,
            [a, b]
        );
        return res.rowCount > 0;
    }

    /**
     * Generar el siguiente código incremental secuencial con prefijo 'CB-' (ej: 'CB-0001')
     * @returns {Promise<string>} Siguiente código autogenerado
     */
    static async generarSiguienteCodigo() {
        const query = `
            SELECT MAX(CAST(SUBSTRING(codigo_bunker_cliente FROM 4) AS INTEGER)) as max_val 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente ~ '^CB-[0-9]+$'
        `;
        const result = await pool.query(query);
        const maxVal = result.rows[0].max_val ? parseInt(result.rows[0].max_val, 10) : 0;
        const nextVal = maxVal + 1;
        return `CB-${nextVal.toString().padStart(4, '0')}`;
    }

    /**
     * Crear un nuevo cliente en el sistema local
     * @param {Object} datos - Atributos del cliente
     * @param {string} [datos.codigo_bunker_cliente] - Código local (autogenerado si se omite)
     * @param {string} datos.cliente_nombre - Nombre de fantasía o comercial
     * @param {string} datos.razon_social - Razón social legal
     * @param {string|null} datos.lomas_soft_id - Código externo (saneado a null si viene vacío)
     * @param {string|null} datos.cuit_cuil - CUIT/CUIL del cliente (sanitizado a solo números)
     * @param {string|null} datos.condicion_iva - Condición de IVA del cliente
     * @param {string|null} datos.domicilio_fiscal - Domicilio fiscal legal
     * @param {string|null} datos.provincia - Provincia de jurisdicción
     * @returns {Promise<Object>} Cliente insertado
     */
    static async crear(datos) {
        let { codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, preferencia_facturacion, ver_stock } = datos;
        
        // Si no se suministra un código o viene vacío, lo autogeneramos dinámicamente
        if (!codigo_bunker_cliente || !codigo_bunker_cliente.trim()) {
            codigo_bunker_cliente = await this.generarSiguienteCodigo();
        } else {
            codigo_bunker_cliente = codigo_bunker_cliente.trim().toUpperCase();
        }

        // Sanitización preventiva del CUIT/CUIL a solo dígitos para evitar conflictos en BD
        const cuitSanitizado = cuit_cuil ? cuit_cuil.replace(/[^0-9]/g, '') : null;

        const prefFacturacion = ['ARCA', 'INTERNO', 'PREGUNTAR'].includes(preferencia_facturacion) 
            ? preferencia_facturacion 
            : 'PREGUNTAR';

        const query = `
            INSERT INTO public.bunker_clientes (codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, preferencia_facturacion, ver_stock)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING *
        `;
        const result = await pool.query(query, [
            codigo_bunker_cliente, 
            cliente_nombre, 
            razon_social, 
            lomas_soft_id, 
            cuitSanitizado, 
            condicion_iva || null, 
            domicilio_fiscal || null, 
            provincia || null, 
            estado_clave || null,
            categoria_monotributo || null,
            actividad_principal || null,
            whatsapp_facturas || null,
            email_facturas || null,
            canal_envio_preferido || 'whatsapp',
            email_portal || null,
            email_portal_nombre || null,
            email_portal_cargo || null,
            prefFacturacion,
            !!ver_stock
        ]);

        // Sincronizar en espejo con public.clientes si tiene lomas_soft_id numérico
        if (lomas_soft_id && /^\d+$/.test(lomas_soft_id.trim())) {
            try {
                await pool.query(
                    `UPDATE public.clientes SET preferencia_facturacion = $1 WHERE cliente_id = $2`,
                    [prefFacturacion, parseInt(lomas_soft_id.trim(), 10)]
                );
            } catch (errSync) {
                console.warn('⚠️ [CLIENTES-BUNKER] Error sincronizando preferencia_facturacion en tabla clientes:', errSync.message);
            }
        }

        return result.rows[0];
    }

    /**
     * Actualizar los datos de un cliente existente
     * @param {number} id - ID secuencial del cliente a actualizar
     * @param {Object} datos - Nuevos atributos del cliente
     * @returns {Promise<Object>} Cliente actualizado
     */
    static async actualizar(id, datos) {
        const { codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, preferencia_facturacion, ver_stock } = datos;
        
        // Sanitización preventiva del CUIT/CUIL a solo dígitos
        const cuitSanitizado = cuit_cuil ? cuit_cuil.replace(/[^0-9]/g, '') : null;

        const prefFacturacion = ['ARCA', 'INTERNO', 'PREGUNTAR'].includes(preferencia_facturacion) 
            ? preferencia_facturacion 
            : 'PREGUNTAR';

        const query = `
            UPDATE public.bunker_clientes
            SET codigo_bunker_cliente = $1,
                cliente_nombre = $2,
                razon_social = $3,
                lomas_soft_id = $4,
                cuit_cuil = $5,
                condicion_iva = $6,
                domicilio_fiscal = $7,
                provincia = $8,
                estado_clave = $9,
                categoria_monotributo = $10,
                actividad_principal = $11,
                whatsapp_facturas = $12,
                email_facturas = $13,
                canal_envio_preferido = $14,
                email_portal = $15,
                email_portal_nombre = $16,
                email_portal_cargo = $17,
                preferencia_facturacion = $18,
                ver_stock = $19,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $20
            RETURNING *
        `;
        const result = await pool.query(query, [
            codigo_bunker_cliente, 
            cliente_nombre, 
            razon_social, 
            lomas_soft_id, 
            cuitSanitizado, 
            condicion_iva || null, 
            domicilio_fiscal || null, 
            provincia || null, 
            estado_clave || null,
            categoria_monotributo || null,
            actividad_principal || null,
            whatsapp_facturas || null,
            email_facturas || null,
            canal_envio_preferido || 'whatsapp',
            email_portal || null,
            email_portal_nombre || null,
            email_portal_cargo || null,
            prefFacturacion,
            !!ver_stock,
            id
        ]);

        // Sincronizar en espejo con public.clientes si tiene lomas_soft_id numérico
        if (lomas_soft_id && /^\d+$/.test(lomas_soft_id.trim())) {
            try {
                await pool.query(
                    `UPDATE public.clientes SET preferencia_facturacion = $1 WHERE cliente_id = $2`,
                    [prefFacturacion, parseInt(lomas_soft_id.trim(), 10)]
                );
            } catch (errSync) {
                console.warn('⚠️ [CLIENTES-BUNKER] Error sincronizando preferencia_facturacion en tabla clientes:', errSync.message);
            }
        }

        return result.rows[0];
    }

    /**
     * Eliminar físicamente un cliente por su ID
     * @param {number} id - ID del cliente
     * @returns {Promise<Object>} Registro del cliente eliminado
     */
    static async eliminar(id) {
        const query = `
            DELETE FROM public.bunker_clientes
            WHERE id = $1
            RETURNING *
        `;
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }

    /**
     * Eliminar todas las vinculaciones de listas de precios de un cliente
     * @param {number} clienteId - ID del cliente
     */
    static async desvincularListas(clienteId) {
        const query = 'DELETE FROM public.bunker_cliente_listas_precios WHERE bunker_cliente_id = $1';
        return await pool.query(query, [clienteId]);
    }

    /**
     * Vincular una lista de precios a un cliente
     * @param {number} clienteId - ID del cliente
     * @param {number} listaId - ID de la lista de precios
     */
    static async vincularLista(clienteId, listaId) {
        const query = 'INSERT INTO public.bunker_cliente_listas_precios (bunker_cliente_id, bunker_lista_precio_id) VALUES ($1, $2) RETURNING *';
        const result = await pool.query(query, [clienteId, listaId]);
        return result.rows[0];
    }

    /**
     * Obtener historial relacional puro de artículos comprados/facturados a un cliente B2B
     * Integra presupuestos, facturas y vinculación 1 a 1 por ID único entre Artículos Búnker y Legacy.
     * Excluye estrictamente comprobantes o presupuestos anulados, cancelados o dados de baja.
     * @param {number} clienteId - ID del cliente búnker
     * @returns {Promise<Array>} Lista de artículos comprados con frecuencia y última fecha
     */
    static async obtenerArticulosComprados(clienteId) {
        const query = `
            WITH cliente_ref AS (
                SELECT 
                    id, 
                    lomas_soft_id, 
                    codigo_bunker_cliente,
                    LTRIM(COALESCE(lomas_soft_id, ''), '0') as clean_lomas_id
                FROM public.bunker_clientes
                WHERE id::text = $1::text 
                   OR lomas_soft_id = $1::text 
                   OR codigo_bunker_cliente = $1::text 
                   OR (LTRIM(COALESCE(lomas_soft_id, ''), '0') != '' AND LTRIM(COALESCE(lomas_soft_id, ''), '0') = LTRIM($1::text, '0'))
                ORDER BY CASE
                    WHEN id::text = $1::text THEN 0
                    WHEN codigo_bunker_cliente = $1::text THEN 1
                    WHEN lomas_soft_id = $1::text THEN 2
                    ELSE 3
                END
                LIMIT 1
            ),
            articulos_presupuestos AS (
                SELECT DISTINCT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    p.fecha as fecha_compra
                FROM cliente_ref cr
                JOIN public.presupuestos p ON (
                    (cr.lomas_soft_id IS NOT NULL AND cr.lomas_soft_id != '' AND p.id_cliente::text = cr.lomas_soft_id)
                    OR (cr.codigo_bunker_cliente IS NOT NULL AND cr.codigo_bunker_cliente != '' AND p.id_cliente::text = cr.codigo_bunker_cliente)
                    OR (cr.clean_lomas_id != '' AND LTRIM(p.id_cliente::text, '0') = cr.clean_lomas_id)
                )
                JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id
                LEFT JOIN public.articulos a ON (a.numero::text = pd.articulo OR a.codigo_barras::text = pd.articulo OR LOWER(a.nombre) = LOWER(pd.articulo))
                JOIN public.bunker_articulos ba ON (
                    LOWER(TRIM(ba.articulo_id::text)) = LOWER(TRIM(pd.articulo::text))
                    OR (a.numero IS NOT NULL AND LOWER(TRIM(ba.articulo_id::text)) = LOWER(TRIM(a.numero::text)))
                    OR (a.codigo_barras IS NOT NULL AND LOWER(TRIM(ba.articulo_id::text)) = LOWER(TRIM(a.codigo_barras::text)))
                )
                WHERE (p.estado IS NULL OR LOWER(TRIM(p.estado)) NOT IN ('anulado', 'anulada', 'cancelado', 'cancelada', 'baja', 'eliminado', 'eliminada'))
                  AND (p.activo IS NULL OR p.activo = true)
                  AND (p.archivado IS NULL OR p.archivado = false)
            ),
            articulos_facturas AS (
                SELECT DISTINCT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    f.fecha_emision as fecha_compra
                FROM cliente_ref cr
                JOIN public.factura_facturas f ON (
                    (cr.lomas_soft_id IS NOT NULL AND cr.lomas_soft_id != '' AND f.cliente_id::text = cr.lomas_soft_id)
                    OR (cr.clean_lomas_id != '' AND LTRIM(f.cliente_id::text, '0') = cr.clean_lomas_id)
                )
                JOIN public.factura_factura_items fi ON fi.factura_id = f.id
                LEFT JOIN public.articulos a ON (
                    TRIM(a.codigo_barras::text) = TRIM(COALESCE(fi.articulo_id::text, ''))
                    OR LOWER(TRIM(a.numero::text)) = LOWER(TRIM(COALESCE(fi.articulo_id::text, '')))
                    OR a.numero::text = fi.descripcion
                    OR a.codigo_barras::text = fi.descripcion
                    OR LOWER(a.nombre) = LOWER(fi.descripcion)
                )
                JOIN public.bunker_articulos ba ON (
                    LOWER(TRIM(ba.articulo_id::text)) = LOWER(TRIM(COALESCE(a.numero, fi.articulo_id, fi.descripcion)::text))
                    OR ba.articulo_id::text = fi.descripcion
                    OR (a.codigo_barras IS NOT NULL AND ba.articulo_id::text = a.codigo_barras::text)
                )
                WHERE (f.estado IS NULL OR LOWER(TRIM(f.estado)) NOT IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'baja', 'eliminada', 'eliminado'))
                  AND COALESCE(f.tipo_cbte, 0) NOT IN (3, 8, 13)
            ),
            articulos_union AS (
                SELECT * FROM articulos_presupuestos
                UNION ALL
                SELECT * FROM articulos_facturas
            )
            SELECT 
                articulo_id,
                descripcion,
                descripcion_generada,
                COUNT(*)::integer as frecuencia_compra,
                MAX(fecha_compra) as ultima_compra
            FROM articulos_union
            GROUP BY articulo_id, descripcion, descripcion_generada
            ORDER BY frecuencia_compra DESC, ultima_compra DESC;
        `;
        const result = await pool.query(query, [clienteId]);
        return result.rows;
    }
}

module.exports = ClientesBunkerModel;
