/**
 * Modelo de Clientes Búnker
 * Capa de acceso a datos para la tabla public.bunker_clientes.
 * Gestiona el alta local, la edición y el acoplamiento flexible con el ID externo de Lomas Soft.
 */

const { pool } = require('../config/database');

class ClientesBunkerModel {
    /**
     * Obtener todos los clientes con opción de búsqueda elástica (filtro ILIKE)
     * @param {Object} params - Parámetros de búsqueda
     * @param {string} [params.search] - Texto a buscar en código, nombre, razón social o ID externo
     * @returns {Promise<Array>} Lista de clientes que coinciden con la búsqueda
     */
    static async obtenerTodos({ search } = {}) {
        let query = `
            SELECT c.id, c.codigo_bunker_cliente, c.cliente_nombre, c.razon_social, c.lomas_soft_id, c.cuit_cuil, c.condicion_iva, c.domicilio_fiscal, c.provincia, c.estado_clave, c.categoria_monotributo, c.actividad_principal, c.whatsapp_facturas, c.email_facturas, c.canal_envio_preferido, c.email_portal, c.email_portal_nombre, c.email_portal_cargo, c.created_at, c.updated_at,
                   cc.saldo, cc.id as cuenta_corriente_id,
                   COALESCE(
                       (SELECT JSON_AGG(JSON_BUILD_OBJECT('id', lp.id, 'nombre', lp.nombre))
                        FROM public.bunker_cliente_listas_precios clp
                        JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
                        WHERE clp.bunker_cliente_id = c.id),
                       '[]'::json
                   ) as listas_precios
            FROM public.bunker_clientes c
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = c.codigo_bunker_cliente
        `;
        const params = [];

        if (search) {
            // Realiza una búsqueda flexible cruzando por múltiples campos clave
            query += `
                WHERE c.codigo_bunker_cliente ILIKE $1 
                   OR c.cliente_nombre ILIKE $1 
                   OR c.razon_social ILIKE $1 
                   OR c.lomas_soft_id ILIKE $1
                   OR c.cuit_cuil ILIKE $1
            `;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY c.cliente_nombre ASC`;

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
            SELECT c.id, c.codigo_bunker_cliente, c.cliente_nombre, c.razon_social, c.lomas_soft_id, c.cuit_cuil, c.condicion_iva, c.domicilio_fiscal, c.provincia, c.estado_clave, c.categoria_monotributo, c.actividad_principal, c.whatsapp_facturas, c.email_facturas, c.canal_envio_preferido, c.email_portal, c.email_portal_nombre, c.email_portal_cargo, c.created_at, c.updated_at,
                   cc.saldo, cc.id as cuenta_corriente_id,
                   COALESCE(
                       (SELECT JSON_AGG(JSON_BUILD_OBJECT('id', lp.id, 'nombre', lp.nombre))
                        FROM public.bunker_cliente_listas_precios clp
                        JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
                        WHERE clp.bunker_cliente_id = c.id),
                       '[]'::json
                   ) as listas_precios
            FROM public.bunker_clientes c
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = c.codigo_bunker_cliente
            WHERE c.id = $1
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
            SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo, created_at, updated_at
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
        `;
        const result = await pool.query(query, [cuit]);
        return result.rows.length ? result.rows[0] : null;
    }

    /**
     * Generar el siguiente código incremental secuencial con prefijo 'CB-' (ej: 'CB-0001')
     * @returns {Promise<string>} Siguiente código autogenerado
     */
    static async generarSiguienteCodigo() {
        const query = `
            SELECT MAX(CAST(SUBSTRING(codigo_bunker_cliente FROM 4) AS INTEGER)) as max_val 
            FROM public.bunker_clientes 
            WHERE codigo_bunker_cliente LIKE 'CB-%'
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
        let { codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo } = datos;
        
        // Si no se suministra un código o viene vacío, lo autogeneramos dinámicamente
        if (!codigo_bunker_cliente || !codigo_bunker_cliente.trim()) {
            codigo_bunker_cliente = await this.generarSiguienteCodigo();
        } else {
            codigo_bunker_cliente = codigo_bunker_cliente.trim().toUpperCase();
        }

        // Sanitización preventiva del CUIT/CUIL a solo dígitos para evitar conflictos en BD
        const cuitSanitizado = cuit_cuil ? cuit_cuil.replace(/[^0-9]/g, '') : null;

        const query = `
            INSERT INTO public.bunker_clientes (codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
            email_portal_cargo || null
        ]);
        return result.rows[0];
    }

    /**
     * Actualizar los datos de un cliente existente
     * @param {number} id - ID secuencial del cliente a actualizar
     * @param {Object} datos - Nuevos atributos del cliente
     * @returns {Promise<Object>} Cliente actualizado
     */
    static async actualizar(id, datos) {
        const { codigo_bunker_cliente, cliente_nombre, razon_social, lomas_soft_id, cuit_cuil, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, email_portal, email_portal_nombre, email_portal_cargo } = datos;
        
        // Sanitización preventiva del CUIT/CUIL a solo dígitos
        const cuitSanitizado = cuit_cuil ? cuit_cuil.replace(/[^0-9]/g, '') : null;

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
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $18
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
            id
        ]);
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
}

module.exports = ClientesBunkerModel;
