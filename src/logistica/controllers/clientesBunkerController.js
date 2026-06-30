/**
 * Controlador de Clientes Búnker
 * Maneja las peticiones HTTP CRUD e implementa la sanitización preventiva del campo lomas_soft_id
 * y cuit_cuil transformando cadenas vacías, indefinidas o con espacios en null absoluto para evitar colisiones
 * del constraint UNIQUE de PostgreSQL.
 */

const ClientesBunkerModel = require('../models/clientesBunkerModel');
const arcaService = require('../services/arcaService');
const { pool } = require('../config/database');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : null;

async function obtenerClienteIdsActivosB2B() {
    if (!supabaseAdmin) return [];
    try {
        const { data, error } = await supabaseAdmin
            .from('clientes_b2b_perfiles')
            .select('cliente_id');
        if (error) {
            console.error('⚠️ [CLIENTES-BUNKER] Error al consultar perfiles en Supabase:', error.message);
            return [];
        }
        return data ? data.map(p => p.cliente_id) : [];
    } catch (err) {
        console.error('⚠️ [CLIENTES-BUNKER] Error de red al conectar con Supabase:', err.message);
        return [];
    }
}

/**
 * Validador oficial de CUIT/CUIL basado en ponderadores de Módulo 11 (Adaptación de Blueprint ARCA).
 * @param {string} cuit - CUIT a validar.
 * @returns {boolean} Verdadero si es válido, falso de lo contrario.
 */
function validarCuit(cuit) {
    if (!cuit) return true; // Tolerancia a nulos/vacíos
    const raw = cuit.replace(/[^0-9]/g, '');
    if (raw.length === 0) return true; // Tolerancia a campos vacíos
    if (raw.length !== 11) return false;

    const cuitPre = raw.substring(0, 2);
    const cuitDig = parseInt(raw.substring(10, 11), 10);
    const validPrefixes = ['20', '23', '24', '27', '30', '33', '34'];
    if (!validPrefixes.includes(cuitPre)) return false;

    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(raw[i], 10) * weights[i];
    }
    
    let calculated = 11 - (sum % 11);
    if (calculated === 11) calculated = 0;
    if (calculated === 10) return false;
    
    return calculated === cuitDig;
}

/**
 * Obtener listado de todos los clientes búnker, con soporte opcional de búsqueda por query string.
 */
exports.obtenerTodos = async (req, res) => {
    try {
        const { search } = req.query;
        console.log(`🔍 [CLIENTES-BUNKER] Listando clientes. Búsqueda: "${search || ''}"`);
        const clientes = await ClientesBunkerModel.obtenerTodos({ search });
        
        // Validación cruzada dinámica con perfiles reales en Supabase
        const activeIds = await obtenerClienteIdsActivosB2B();
        const activeSet = new Set(activeIds);

        const dataConOnboarding = clientes.map(c => ({
            ...c,
            onboarding_completado: c.onboarding_completado === true || activeSet.has(c.codigo_bunker_cliente)
        }));

        res.json({ success: true, data: dataConOnboarding });
    } catch (error) {
        console.error('❌ [CLIENTES-BUNKER] Error al obtener clientes:', error);
        res.status(500).json({ success: false, error: 'Error al consultar el listado de clientes.' });
    }
};

/**
 * Obtener un cliente búnker específico por su ID secuencial.
 */
exports.obtenerPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const cliente = await ClientesBunkerModel.obtenerPorId(id);
        if (!cliente) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
        }

        // Validación cruzada individual con Supabase
        let onboarding_completado = cliente.onboarding_completado;
        if (!onboarding_completado && supabaseAdmin) {
            try {
                const { data, error } = await supabaseAdmin
                    .from('clientes_b2b_perfiles')
                    .select('id')
                    .eq('cliente_id', cliente.codigo_bunker_cliente)
                    .maybeSingle();
                if (!error && data) {
                    onboarding_completado = true;
                }
            } catch (err) {
                console.error('⚠️ [CLIENTES-BUNKER] Error al verificar perfil individual en Supabase:', err.message);
            }
        }

        res.json({ 
            success: true, 
            data: { 
                ...cliente, 
                onboarding_completado 
            } 
        });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error al obtener cliente con ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error al consultar la ficha del cliente.' });
    }
};

/**
 * Sugerir un código legacy (Lomasoft ID) único de 3 dígitos disponible
 */
exports.sugerirLegacy = async (req, res) => {
    try {
        const idsAsignados = await ClientesBunkerModel.obtenerTodosLomasSoftIds();
        
        const setIds = new Set();
        idsAsignados.forEach(id => {
            const num = parseInt(id, 10);
            if (!isNaN(num)) {
                setIds.add(num);
            }
        });
        
        let sugerido = 100;
        while (setIds.has(sugerido) && sugerido <= 999) {
            sugerido++;
        }
        
        if (sugerido > 999) {
            sugerido = 1000;
            while (setIds.has(sugerido)) {
                sugerido++;
            }
        }
        
        const codigoSugerido = sugerido.toString();
        console.log(`💡 [CLIENTES-BUNKER] Sugiriendo código legacy disponible: "${codigoSugerido}"`);
        
        res.json({ success: true, codigoSugerido });
    } catch (error) {
        console.error('❌ [CLIENTES-BUNKER] Error al sugerir código legacy:', error);
        res.status(500).json({ success: false, error: 'Error al sugerir código legacy disponible.' });
    }
};

/**
 * Dar de alta un nuevo cliente búnker sanitizando el ID externo de Lomas Soft e información fiscal.
 */
exports.crear = async (req, res) => {
    try {
        const { codigo_bunker_cliente, cliente_nombre, razon_social, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, confirmarCuitDuplicado, email_portal, email_portal_nombre, email_portal_cargo } = req.body;
        let { lomas_soft_id, cuit_cuil } = req.body;

        // 1. Validaciones de presencia de campos obligatorios humanos
        if (!cliente_nombre || !cliente_nombre.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre comercial del cliente es requerido.' });
        }
        if (!razon_social || !razon_social.trim()) {
            return res.status(400).json({ success: false, error: 'La razón social es requerida.' });
        }

        // 2. Validación de CUIT/CUIL vía Módulo 11 (Fase 1 Fiscal)
        if (!validarCuit(cuit_cuil)) {
            return res.status(400).json({ success: false, error: 'El CUIT/CUIL ingresado no es válido (Fallo de algoritmo Módulo 11).' });
        }

        // 3. Sanitización preventiva de lomas_soft_id (ID externo)
        if (lomas_soft_id === undefined || lomas_soft_id === null || (typeof lomas_soft_id === 'string' && !lomas_soft_id.trim())) {
            lomas_soft_id = null;
        } else {
            lomas_soft_id = lomas_soft_id.trim();
            // Alinear códigos numéricos (como los autogenerados de 3 dígitos) a 4 dígitos para compatibilidad legacy
            if (/^[0-9]+$/.test(lomas_soft_id)) {
                lomas_soft_id = lomas_soft_id.padStart(4, '0');
            }
        }

        // 4. Sanitización de cuit_cuil
        if (cuit_cuil === undefined || cuit_cuil === null || (typeof cuit_cuil === 'string' && !cuit_cuil.trim())) {
            cuit_cuil = null;
        } else {
            cuit_cuil = cuit_cuil.trim().replace(/[^0-9]/g, '');
            if (cuit_cuil.length === 0) {
                cuit_cuil = null;
            }
        }

        // 5. Sanitizar y validar código local solo si fue provisto
        let codigoLimpio = null;
        if (codigo_bunker_cliente && codigo_bunker_cliente.trim()) {
            codigoLimpio = codigo_bunker_cliente.trim().toUpperCase();
            
            // Control de unicidad de código búnker local
            const clienteExistenteCodigo = await ClientesBunkerModel.obtenerPorCodigoBunker(codigoLimpio);
            if (clienteExistenteCodigo) {
                return res.status(400).json({ success: false, error: `El código búnker "${codigoLimpio}" ya está registrado por otro cliente.` });
            }
        }

        // 6. Control de unicidad de lomas_soft_id si no es nulo
        if (lomas_soft_id !== null) {
            const clienteExistenteLomas = await ClientesBunkerModel.obtenerPorLomasSoftId(lomas_soft_id);
            if (clienteExistenteLomas) {
                return res.status(400).json({ success: false, error: `El ID externo de Lomas Soft "${lomas_soft_id}" ya está asociado al cliente "${clienteExistenteLomas.cliente_nombre}".` });
            }
        }

        // 7. Control de unicidad de cuit_cuil si no es nulo (con soporte para bypass por excepción de pantalla)
        if (cuit_cuil !== null && !confirmarCuitDuplicado) {
            const clienteExistenteCuit = await ClientesBunkerModel.obtenerPorCuit(cuit_cuil);
            if (clienteExistenteCuit) {
                return res.status(409).json({ 
                    success: false, 
                    code: 'CUIT_DUPLICADO', 
                    clienteNombre: clienteExistenteCuit.cliente_nombre,
                    error: `El CUIT/CUIL "${cuit_cuil}" ya está registrado por el cliente "${clienteExistenteCuit.cliente_nombre}".` 
                });
            }
        }

        // 8. Persistencia
        const nuevoCliente = await ClientesBunkerModel.crear({
            codigo_bunker_cliente: codigoLimpio,
            cliente_nombre: cliente_nombre.trim(),
            razon_social: razon_social.trim(),
            lomas_soft_id,
            cuit_cuil,
            condicion_iva: condicion_iva ? condicion_iva.trim() : null,
            domicilio_fiscal: domicilio_fiscal ? domicilio_fiscal.trim() : null,
            provincia: provincia ? provincia.trim() : null,
            estado_clave: estado_clave ? estado_clave.trim() : null,
            categoria_monotributo: categoria_monotributo ? categoria_monotributo.trim() : null,
            actividad_principal: actividad_principal ? actividad_principal.trim() : null,
            whatsapp_facturas: whatsapp_facturas ? whatsapp_facturas.trim() : null,
            email_facturas: email_facturas ? email_facturas.trim() : null,
            canal_envio_preferido: canal_envio_preferido ? canal_envio_preferido.trim() : 'whatsapp',
            email_portal: email_portal ? email_portal.trim() : null,
            email_portal_nombre: email_portal_nombre ? email_portal_nombre.trim() : null,
            email_portal_cargo: email_portal_cargo ? email_portal_cargo.trim() : null
        });

        console.log(`✅ [CLIENTES-BUNKER] Cliente creado exitosamente: "${nuevoCliente.cliente_nombre}" (ID: ${nuevoCliente.id}, Código: ${nuevoCliente.codigo_bunker_cliente})`);
        res.status(201).json({ success: true, data: nuevoCliente, message: 'Cliente guardado exitosamente.' });

    } catch (error) {
        console.error('❌ [CLIENTES-BUNKER] Error al crear cliente:', error);
        res.status(500).json({ success: false, error: 'Error al registrar el cliente en la base de datos.' });
    }
};

/**
 * Actualizar los datos de un cliente búnker existente sanitizando información fiscal.
 */
exports.actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo_bunker_cliente, cliente_nombre, razon_social, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, confirmarCuitDuplicado, email_portal, email_portal_nombre, email_portal_cargo } = req.body;
        let { lomas_soft_id, cuit_cuil } = req.body;

        // 1. Verificar existencia previa
        const clientePrevio = await ClientesBunkerModel.obtenerPorId(id);
        if (!clientePrevio) {
            return res.status(404).json({ success: false, error: 'El cliente que intenta actualizar no existe.' });
        }

        // 2. Validaciones de presencia
        if (!codigo_bunker_cliente || !codigo_bunker_cliente.trim()) {
            return res.status(400).json({ success: false, error: 'El código búnker es requerido.' });
        }
        if (!cliente_nombre || !cliente_nombre.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre comercial es requerido.' });
        }
        if (!razon_social || !razon_social.trim()) {
            return res.status(400).json({ success: false, error: 'La razón social es requerida.' });
        }

        // 3. Validación de CUIT/CUIL vía Módulo 11 (Fase 1 Fiscal)
        if (!validarCuit(cuit_cuil)) {
            return res.status(400).json({ success: false, error: 'El CUIT/CUIL ingresado no es válido (Fallo de algoritmo Módulo 11).' });
        }

        // 4. Sanitización de lomas_soft_id
        if (lomas_soft_id === undefined || lomas_soft_id === null || (typeof lomas_soft_id === 'string' && !lomas_soft_id.trim())) {
            lomas_soft_id = null;
        } else {
            lomas_soft_id = lomas_soft_id.trim();
            // Alinear códigos numéricos (como los autogenerados de 3 dígitos) a 4 dígitos para compatibilidad legacy
            if (/^[0-9]+$/.test(lomas_soft_id)) {
                lomas_soft_id = lomas_soft_id.padStart(4, '0');
            }
        }

        // 5. Sanitización de cuit_cuil
        if (cuit_cuil === undefined || cuit_cuil === null || (typeof cuit_cuil === 'string' && !cuit_cuil.trim())) {
            cuit_cuil = null;
        } else {
            cuit_cuil = cuit_cuil.trim().replace(/[^0-9]/g, '');
            if (cuit_cuil.length === 0) {
                cuit_cuil = null;
            }
        }

        const codigoLimpio = codigo_bunker_cliente.trim().toUpperCase();

        // 6. Control de unicidad de código búnker (excluyendo el registro actual)
        const clienteExistenteCodigo = await ClientesBunkerModel.obtenerPorCodigoBunker(codigoLimpio);
        if (clienteExistenteCodigo && clienteExistenteCodigo.id != id) {
            return res.status(400).json({ success: false, error: `El código búnker "${codigoLimpio}" ya está registrado por otro cliente.` });
        }

        // 7. Control de unicidad de lomas_soft_id (excluyendo el registro actual)
        if (lomas_soft_id !== null) {
            const clienteExistenteLomas = await ClientesBunkerModel.obtenerPorLomasSoftId(lomas_soft_id);
            if (clienteExistenteLomas && clienteExistenteLomas.id != id) {
                return res.status(400).json({ success: false, error: `El ID externo de Lomas Soft "${lomas_soft_id}" ya está asociado al cliente "${clienteExistenteLomas.cliente_nombre}".` });
            }
        }

        // 8. Control de unicidad de cuit_cuil (excluyendo el registro actual, con bypass de confirmación)
        if (cuit_cuil !== null && !confirmarCuitDuplicado) {
            const clienteExistenteCuit = await ClientesBunkerModel.obtenerPorCuit(cuit_cuil);
            if (clienteExistenteCuit && clienteExistenteCuit.id != id) {
                return res.status(409).json({ 
                    success: false, 
                    code: 'CUIT_DUPLICADO', 
                    clienteNombre: clienteExistenteCuit.cliente_nombre,
                    error: `El CUIT/CUIL "${cuit_cuil}" ya está asociado al cliente "${clienteExistenteCuit.cliente_nombre}".` 
                });
            }
        }

        // 9. Actualización
        const clienteActualizado = await ClientesBunkerModel.actualizar(id, {
            codigo_bunker_cliente: codigoLimpio,
            cliente_nombre: cliente_nombre.trim(),
            razon_social: razon_social.trim(),
            lomas_soft_id,
            cuit_cuil,
            condicion_iva: condicion_iva ? condicion_iva.trim() : null,
            domicilio_fiscal: domicilio_fiscal ? domicilio_fiscal.trim() : null,
            provincia: provincia ? provincia.trim() : null,
            estado_clave: estado_clave ? estado_clave.trim() : null,
            categoria_monotributo: categoria_monotributo ? categoria_monotributo.trim() : null,
            actividad_principal: actividad_principal ? actividad_principal.trim() : null,
            whatsapp_facturas: whatsapp_facturas ? whatsapp_facturas.trim() : null,
            email_facturas: email_facturas ? email_facturas.trim() : null,
            canal_envio_preferido: canal_envio_preferido ? canal_envio_preferido.trim() : 'whatsapp',
            email_portal: email_portal ? email_portal.trim() : null,
            email_portal_nombre: email_portal_nombre ? email_portal_nombre.trim() : null,
            email_portal_cargo: email_portal_cargo ? email_portal_cargo.trim() : null
        });

        console.log(`✅ [CLIENTES-BUNKER] Cliente actualizado exitosamente: "${clienteActualizado.cliente_nombre}" (ID: ${id})`);
        res.json({ success: true, data: clienteActualizado, message: 'Ficha de cliente actualizada con éxito.' });

    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error al actualizar cliente con ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error al modificar los datos del cliente.' });
    }
};

/**
 * Eliminar de forma física un cliente búnker.
 */
exports.eliminar = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar existencia previa
        const cliente = await ClientesBunkerModel.obtenerPorId(id);
        if (!cliente) {
            return res.status(404).json({ success: false, error: 'El cliente que intenta eliminar no existe.' });
        }

        await ClientesBunkerModel.eliminar(id);
        console.log(`🗑️ [CLIENTES-BUNKER] Cliente "${cliente.cliente_nombre}" (ID: ${id}) eliminado.`);
        res.json({ success: true, message: 'Cliente eliminado de forma permanente.' });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error al eliminar cliente con ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error al intentar eliminar el cliente.' });
    }
};

/**
 * Consultar los datos de un contribuyente en el padrón de ARCA mediante CUIT/CUIL (Fase 2).
 */
exports.consultarArca = async (req, res) => {
    try {
        const { cuit_cuil } = req.body;
        
        // 1. Validar presencia del CUIT
        if (!cuit_cuil || !cuit_cuil.trim()) {
            return res.status(400).json({ success: false, error: 'El CUIT/CUIL a consultar es requerido.' });
        }
        
        const cuitSanitizado = cuit_cuil.trim().replace(/[^0-9]/g, '');
        
        // 2. Validar matemáticamente (Módulo 11) en backend
        if (!validarCuit(cuitSanitizado)) {
            return res.status(400).json({ success: false, error: 'El CUIT/CUIL no es válido matemáticamente.' });
        }
        
        console.log(`🔍 [CLIENTES-BUNKER] Solicitando consulta a ARCA para CUIT: ${cuitSanitizado}`);
        
        // 3. Consultar a través de arcaService (con contención de excepciones y timeouts)
        const datosFiscales = await arcaService.consultarPadron(cuitSanitizado);
        
        res.json({
            success: true,
            data: datosFiscales
        });
        
    } catch (error) {
        console.error('❌ [CLIENTES-BUNKER] Error en consulta a padrón de ARCA:', error.message);
        
        // Contención de excepciones de red, timeouts o servicios caídos de AFIP
        let mensajeError = 'No se pudo completar la consulta externa con ARCA.';
        if (error.message.includes('no fue encontrado')) {
            mensajeError = 'El contribuyente (CUIT) no se encuentra registrado en el padrón de ARCA.';
        } else if (error.message.includes('timeout') || error.code === 'ECONNABORTED') {
            mensajeError = 'Tiempo de espera agotado. Los servidores de ARCA no responden.';
        } else if (error.message.includes('Fallo del Web Service ARCA')) {
            mensajeError = error.message; // Pasar el mensaje de error de ARCA
        }
        
        res.status(502).json({
            success: false,
            error: mensajeError,
            details: error.message
        });
    }
};

/**
 * Actualizar las listas de precios Bunker asignadas a un cliente.
 * PUT /api/logistica/bunker/clientes/:id/listas
 */
exports.actualizarListas = async (req, res) => {
    try {
        const { id } = req.params;
        const { listaIds } = req.body; // Array de IDs de listas

        console.log(`🏷️ [CLIENTES-BUNKER] Asignando listas de precios al cliente ID ${id}:`, listaIds);

        // 1. Validar existencia del cliente
        const cliente = await ClientesBunkerModel.obtenerPorId(id);
        if (!cliente) {
            return res.status(404).json({ success: false, error: 'El cliente no existe.' });
        }

        // 2. Validar que listaIds sea un array
        if (!Array.isArray(listaIds)) {
            return res.status(400).json({ success: false, error: 'El parámetro listaIds debe ser un array.' });
        }

        // 3. Ejecutar desvinculación y re-vinculación en lote
        await ClientesBunkerModel.desvincularListas(id);

        for (const listaId of listaIds) {
            await ClientesBunkerModel.vincularLista(id, parseInt(listaId, 10));
        }

        // 4. Obtener cliente actualizado para retornar
        const clienteActualizado = await ClientesBunkerModel.obtenerPorId(id);

        res.json({
            success: true,
            data: clienteActualizado,
            message: 'Listas de precios actualizadas exitosamente.'
        });

    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error al actualizar listas de precios del cliente:`, error);
        res.status(500).json({ success: false, error: 'Error al asociar las listas de precios.' });
    }
};

/**
 * Actualizar solo contactos de WhatsApp de un cliente (acoplamiento flexible)
 */
exports.actualizarContactosWhatsapp = async (req, res) => {
    try {
        const { id } = req.params;
        const { whatsapp_facturas, email_facturas, canal_envio_preferido } = req.body;

        console.log(`📱 [CLIENTES-BUNKER] Actualizando destinatarios de facturación para cliente ID: ${id}...`);

        const fields = [];
        const values = [];
        let idx = 1;

        if (whatsapp_facturas !== undefined) {
            fields.push(`whatsapp_facturas = $${idx++}`);
            values.push(whatsapp_facturas);
        }
        if (email_facturas !== undefined) {
            fields.push(`email_facturas = $${idx++}`);
            values.push(email_facturas);
        }
        if (canal_envio_preferido !== undefined) {
            fields.push(`canal_envio_preferido = $${idx++}`);
            values.push(canal_envio_preferido);
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, error: 'No se enviaron campos para actualizar.' });
        }

        fields.push(`updated_at = NOW()`);
        values.push(parseInt(id, 10));

        const query = `UPDATE public.bunker_clientes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'El cliente que intenta actualizar no existe.' });
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Destinatarios de facturación actualizados exitosamente.'
        });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error al actualizar destinatarios de facturación:`, error);
        res.status(500).json({ success: false, error: 'Error al actualizar destinatarios de facturación.' });
    }
};

