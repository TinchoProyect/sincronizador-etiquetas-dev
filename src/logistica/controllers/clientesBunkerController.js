/**
 * Controlador de Clientes Búnker
 * Maneja las peticiones HTTP CRUD e implementa la sanitización preventiva del campo lomas_soft_id
 * y cuit_cuil transformando cadenas vacías, indefinidas o con espacios en null absoluto para evitar colisiones
 * del constraint UNIQUE de PostgreSQL.
 */

const ClientesBunkerModel = require('../models/clientesBunkerModel');
const DomiciliosModel = require('../models/domiciliosModel');
const arcaService = require('../services/arcaService');
const { pool } = require('../config/database');
const { createClient } = require('@supabase/supabase-js');
const { sincronizarTodoElDirectorioB2B } = require('../services/b2bDirectorySyncService');
const nodosBarrialesService = require('../../produccion/services/nodosBarrialesService');

let _esquemaNodosReadyPromise = null;
function asegurarEsquemaNodosOnce() {
    if (!_esquemaNodosReadyPromise) {
        _esquemaNodosReadyPromise = nodosBarrialesService.asegurarEsquemaNodosBarriales().catch(err => {
            _esquemaNodosReadyPromise = null;
            console.warn('⚠️ [CLIENTES-BUNKER] No se pudo verificar esquema Nodos Barriales:', err.message);
        });
    }
    return _esquemaNodosReadyPromise;
}

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : null;

async function obtenerClienteIdsActivosB2B() {
    if (!supabaseAdmin) return [];
    const activeSet = new Set();
    const esEmailFicticio = (em) => {
        const clean = String(em || '').trim().toLowerCase();
        return !clean || clean.endsWith('@lamdaclientes.com') || clean.endsWith('@b2b.lamdaser.com') || clean.endsWith('@lamda.com.ar');
    };
    try {
        const { data: profs } = await supabaseAdmin
            .from('clientes_b2b_perfiles')
            .select('cliente_id, email');
        (profs || []).forEach(p => {
            if (p.cliente_id && !esEmailFicticio(p.email)) {
                activeSet.add(p.cliente_id);
            }
        });
    } catch (e) {}

    try {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
        (usersData?.users || []).forEach(u => {
            const cid = u.app_metadata?.cliente_id || u.user_metadata?.cliente_id;
            if (cid && (u.last_sign_in_at || !esEmailFicticio(u.email))) {
                activeSet.add(cid);
            }
        });
    } catch (e) {}

    try {
        const { data: telem } = await supabaseAdmin
            .from('telemetria_accesos')
            .select('cliente_nombre');
        (telem || []).forEach(t => {
            if (t.cliente_nombre && t.cliente_nombre.startsWith('CB-')) {
                activeSet.add(t.cliente_nombre);
            }
        });
    } catch (e) {}

    return Array.from(activeSet);
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
        await asegurarEsquemaNodosOnce();
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
        
        let maxNum = 0;
        idsAsignados.forEach(id => {
            const num = parseInt(id, 10);
            // Excluir rango reservado 9000+ utilizado por Nodos Barriales (ej: 9001 = Lo de Mati)
            if (!isNaN(num) && num < 9000 && num > maxNum) {
                maxNum = num;
            }
        });
        
        // Si el máximo encontrado es mayor a 0, sumamos 1. Si no, empezamos en la base 100.
        let sugerido = maxNum > 0 ? maxNum + 1 : 100;
        
        // Formatear con padding de ceros a la izquierda (mínimo 4 dígitos para consistencia con Lomasoft)
        const codigoSugerido = sugerido.toString().padStart(4, '0');
        console.log(`💡 [CLIENTES-BUNKER] Sugiriendo código legacy disponible (MAX + 1): "${codigoSugerido}"`);
        
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
        const { codigo_bunker_cliente, cliente_nombre, razon_social, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, confirmarCuitDuplicado, email_portal, email_portal_nombre, email_portal_cargo, preferencia_facturacion } = req.body;
        let { lomas_soft_id, cuit_cuil } = req.body;

        const prefFacturacion = ['ARCA', 'INTERNO', 'PREGUNTAR'].includes(preferencia_facturacion)
            ? preferencia_facturacion
            : 'PREGUNTAR';

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
            email_portal_cargo: email_portal_cargo ? email_portal_cargo.trim() : null,
            preferencia_facturacion: prefFacturacion,
            ver_stock: req.body.ver_stock === true || req.body.ver_stock === 'true'
        });

        // 9. Guardar domicilios precargados (si fueron provistos en el alta)
        const { domicilios } = req.body;
        if (Array.isArray(domicilios) && domicilios.length > 0) {
            console.log(`📍 [CLIENTES-BUNKER] Guardando ${domicilios.length} domicilio(s) precargado(s) para el cliente ID: ${nuevoCliente.id}`);
            for (let i = 0; i < domicilios.length; i++) {
                const dom = domicilios[i];
                if (dom.alias && dom.direccion) {
                    await DomiciliosModel.crear({
                        id_cliente: nuevoCliente.id,
                        alias: dom.alias.trim(),
                        direccion: dom.direccion.trim(),
                        localidad: dom.localidad ? dom.localidad.trim() : null,
                        provincia: dom.provincia ? dom.provincia.trim() : null,
                        codigo_postal: dom.codigo_postal ? dom.codigo_postal.trim() : null,
                        latitud: dom.latitud ? parseFloat(dom.latitud) : null,
                        longitud: dom.longitud ? parseFloat(dom.longitud) : null,
                        coordenadas_validadas: !!dom.coordenadas_validadas,
                        es_predeterminado: dom.es_predeterminado !== undefined ? !!dom.es_predeterminado : (i === 0),
                        telefono_contacto: dom.telefono_contacto ? dom.telefono_contacto.trim() : null,
                        instrucciones_entrega: dom.instrucciones_entrega ? dom.instrucciones_entrega.trim() : null,
                        horario_atencion_desde: dom.horario_atencion_desde || null,
                        horario_atencion_hasta: dom.horario_atencion_hasta || null
                    });
                }
            }
        }

        console.log(`✅ [CLIENTES-BUNKER] Cliente creado exitosamente: "${nuevoCliente.cliente_nombre}" (ID: ${nuevoCliente.id}, Código: ${nuevoCliente.codigo_bunker_cliente})`);
        sincronizarTodoElDirectorioB2B(supabaseAdmin).catch(() => {});
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
        const { codigo_bunker_cliente, cliente_nombre, razon_social, condicion_iva, domicilio_fiscal, provincia, estado_clave, categoria_monotributo, actividad_principal, whatsapp_facturas, email_facturas, canal_envio_preferido, confirmarCuitDuplicado, email_portal, email_portal_nombre, email_portal_cargo, preferencia_facturacion } = req.body;
        let { lomas_soft_id, cuit_cuil } = req.body;

        const prefFacturacion = ['ARCA', 'INTERNO', 'PREGUNTAR'].includes(preferencia_facturacion)
            ? preferencia_facturacion
            : 'PREGUNTAR';

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
            email_portal_cargo: email_portal_cargo ? email_portal_cargo.trim() : null,
            preferencia_facturacion: prefFacturacion,
            ver_stock: req.body.ver_stock === true || req.body.ver_stock === 'true'
        });

        // Sincronizar permiso de ver_stock y perfil en Supabase Cloud de forma INSTANTÁNEA (Perfiles + Auth)
        let b2bSynced = false;
        if (supabaseAdmin) {
            try {
                const targetClienteId = codigoLimpio;
                const deseaVerStock = req.body.ver_stock === true || req.body.ver_stock === 'true';

                // Búsqueda robusta de perfil en Supabase por código búnker, legacy o email
                let prof = null;
                const { data: profByCodigo } = await supabaseAdmin
                    .from('clientes_b2b_perfiles')
                    .select('id, email, permisos')
                    .eq('cliente_id', targetClienteId)
                    .maybeSingle();
                prof = profByCodigo;

                if (!prof && lomas_soft_id) {
                    const { data: profByLomas } = await supabaseAdmin
                        .from('clientes_b2b_perfiles')
                        .select('id, email, permisos')
                        .eq('cliente_id', lomas_soft_id)
                        .maybeSingle();
                    prof = profByLomas;
                }

                if (!prof && email_portal) {
                    const { data: profByEmail } = await supabaseAdmin
                        .from('clientes_b2b_perfiles')
                        .select('id, email, permisos')
                        .ilike('email', email_portal.trim())
                        .maybeSingle();
                    prof = profByEmail;
                }

                let permisos = (prof && Array.isArray(prof.permisos)) ? [...prof.permisos] : ['compras', 'pagos'];
                if (deseaVerStock) {
                    if (!permisos.includes('ver_stock')) permisos.push('ver_stock');
                } else {
                    permisos = permisos.filter(p => p !== 'ver_stock');
                }

                // 1. Actualizar tabla clientes_b2b_perfiles
                if (prof) {
                    const patchData = {
                        permisos,
                        updated_at: new Date().toISOString()
                    };
                    try {
                        const { error: errCol } = await supabaseAdmin
                            .from('clientes_b2b_perfiles')
                            .update({ ...patchData, ver_stock: deseaVerStock })
                            .eq('id', prof.id);
                        if (errCol) throw errCol;
                    } catch (eFallback) {
                        await supabaseAdmin
                            .from('clientes_b2b_perfiles')
                            .update(patchData)
                            .eq('id', prof.id);
                    }
                    b2bSynced = true;
                }

                // 2. Actualizar INMEDIATAMENTE en Supabase Auth (auth.users app_metadata)
                const targetEmail = (prof && prof.email) || (email_portal ? email_portal.trim().toLowerCase() : null);
                const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                const targetUser = usersData?.users?.find(u => 
                    u.app_metadata?.cliente_id === targetClienteId ||
                    (lomas_soft_id && u.app_metadata?.cliente_id === lomas_soft_id) ||
                    (targetEmail && u.email && u.email.toLowerCase() === targetEmail.toLowerCase())
                );

                if (targetUser) {
                    // Si el perfil no existía en clientes_b2b_perfiles pero el usuario existe en Auth, crearlo proactivamente
                    if (!prof) {
                        await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                            id: targetUser.id,
                            cliente_id: targetClienteId,
                            rol: targetUser.app_metadata?.rol || 'Dueno',
                            permisos: permisos,
                            nombre_completo: clienteActualizado.email_portal_nombre || clienteActualizado.cliente_nombre,
                            nombre_empresa: clienteActualizado.razon_social || clienteActualizado.cliente_nombre,
                            cuit: clienteActualizado.cuit_cuil,
                            email: targetUser.email,
                            updated_at: new Date().toISOString()
                        });
                        console.log(`✨ [SYNC-PROFILE-AUTO] Perfil creado por upsert en Supabase para ${targetUser.email} (${targetClienteId})`);
                    }

                    await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
                        app_metadata: {
                            ...(targetUser.app_metadata || {}),
                            cliente_id: targetClienteId,
                            permisos: permisos,
                            ver_stock: deseaVerStock
                        }
                    });
                    b2bSynced = true;
                    console.log(`⚡ [SYNC-INSTANT-STOCK] auth.users actualizado para ${targetUser.email}: ver_stock=${deseaVerStock}, permisos=[${permisos.join(',')}]`);
                }

                if (b2bSynced) {
                    console.log(`📡 [CLIENTES-BUNKER] Permiso ver_stock (${deseaVerStock}) sincronizado instantáneamente en Supabase para cliente ${targetClienteId}.`);
                }
            } catch (errSupabase) {
                console.warn('⚠️ [CLIENTES-BUNKER] Error sincronizando ver_stock en Supabase:', errSupabase.message);
            }
        }

        console.log(`✅ [CLIENTES-BUNKER] Cliente actualizado exitosamente: "${clienteActualizado.cliente_nombre}" (ID: ${id})`);
        sincronizarTodoElDirectorioB2B(supabaseAdmin).catch(() => {});
        res.json({ 
            success: true, 
            data: clienteActualizado, 
            b2b_synced: b2bSynced,
            message: b2bSynced 
                ? 'Ficha de cliente actualizada y permisos B2B sincronizados en la nube.' 
                : 'Ficha de cliente actualizada con éxito.' 
        });

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
        const cuit_cuil = (req.body && (req.body.cuit_cuil || req.body.cuit)) || '';
        
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

        // 5. Sincronización instantánea con Supabase Cloud (clientes_b2b_perfiles_listas + auth.users.app_metadata + perfiles)
        let b2bSynced = false;
        if (supabaseAdmin && clienteActualizado.codigo_bunker_cliente) {
            try {
                const targetClienteId = clienteActualizado.codigo_bunker_cliente;
                const cleanListaIds = listaIds.map(lid => parseInt(lid, 10)).filter(lid => !isNaN(lid));

                // A. Limpiar asignaciones previas en Supabase para este cliente
                await supabaseAdmin
                    .from('clientes_b2b_perfiles_listas')
                    .delete()
                    .eq('cliente_id', targetClienteId);

                // B. Insertar las listas asignadas
                if (cleanListaIds.length > 0) {
                    const rowsToInsert = cleanListaIds.map((lid, idx) => ({
                        cliente_id: targetClienteId,
                        lista_id: lid,
                        es_principal: idx === 0,
                        permitir_toggle_iva: false,
                        created_at: new Date().toISOString()
                    }));
                    await supabaseAdmin
                        .from('clientes_b2b_perfiles_listas')
                        .insert(rowsToInsert);
                }

                // C. Actualizar app_metadata y asegurar perfil en clientes_b2b_perfiles
                const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
                const targetEmail = clienteActualizado.email_portal ? clienteActualizado.email_portal.trim().toLowerCase() : null;
                const targetUser = usersData?.users?.find(u => 
                    u.app_metadata?.cliente_id === targetClienteId ||
                    (clienteActualizado.lomas_soft_id && u.app_metadata?.cliente_id === clienteActualizado.lomas_soft_id) ||
                    (targetEmail && u.email && u.email.toLowerCase() === targetEmail)
                );

                if (targetUser) {
                    const permisos = ['compras', 'pagos'];
                    if (clienteActualizado.ver_stock) {
                        permisos.push('ver_stock');
                    }

                    // Asegurar perfil
                    await supabaseAdmin.from('clientes_b2b_perfiles').upsert({
                        id: targetUser.id,
                        cliente_id: targetClienteId,
                        rol: targetUser.app_metadata?.rol || 'Dueno',
                        permisos: permisos,
                        nombre_completo: clienteActualizado.email_portal_nombre || clienteActualizado.cliente_nombre,
                        nombre_empresa: clienteActualizado.razon_social || clienteActualizado.cliente_nombre,
                        cuit: clienteActualizado.cuit_cuil,
                        email: targetUser.email,
                        ver_stock: !!clienteActualizado.ver_stock,
                        updated_at: new Date().toISOString()
                    });

                    // Actualizar auth app_metadata
                    await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
                        app_metadata: {
                            ...(targetUser.app_metadata || {}),
                            cliente_id: targetClienteId,
                            listas_precios: cleanListaIds,
                            permisos: permisos,
                            rol: targetUser.app_metadata?.rol || 'Dueno',
                            ver_stock: !!clienteActualizado.ver_stock
                        }
                    });
                    console.log(`⚡ [SYNC-INSTANT-LISTAS] Supabase sincronizado para ${targetUser.email}: listas=[${cleanListaIds.join(',')}]`);
                }
                b2bSynced = true;
                console.log(`📡 [CLIENTES-BUNKER] Listas de precios sincronizadas instantáneamente en Supabase para cliente ${targetClienteId}.`);
            } catch (errSupabase) {
                console.warn('⚠️ [CLIENTES-BUNKER] Error sincronizando listas en Supabase:', errSupabase.message);
            }
        }

        res.json({
            success: true,
            data: clienteActualizado,
            b2b_synced: b2bSynced,
            message: b2bSynced
                ? 'Listas de precios actualizadas y sincronizadas instantáneamente con el portal B2B.'
                : 'Listas de precios actualizadas exitosamente.'
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

/**
 * Obtener artículos comprados/facturados históricamente a un cliente B2B
 * GET /api/logistica/bunker/clientes/:id/articulos-comprados
 */
exports.obtenerArticulosComprados = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🛒 [CLIENTES-BUNKER] Obteniendo historial relacional de artículos comprados para cliente ID: ${id}`);

        const cliente = await ClientesBunkerModel.obtenerPorId(id);
        if (!cliente) {
            return res.status(404).json({ success: false, error: 'El cliente especificado no existe.' });
        }

        const articulosComprados = await ClientesBunkerModel.obtenerArticulosComprados(id);

        res.json({
            success: true,
            cliente: {
                id: cliente.id,
                codigo_bunker_cliente: cliente.codigo_bunker_cliente,
                cliente_nombre: cliente.cliente_nombre,
                razon_social: cliente.razon_social || cliente.cliente_nombre,
                lomas_soft_id: cliente.lomas_soft_id,
                cuit_cuil: cliente.cuit_cuil,
                whatsapp_facturas: cliente.whatsapp_facturas,
                email_facturas: cliente.email_facturas,
                email_portal: cliente.email_portal,
                email_portal_nombre: cliente.email_portal_nombre,
                email_portal_cargo: cliente.email_portal_cargo,
                preferencia_facturacion: cliente.preferencia_facturacion,
                listas_precios: cliente.listas_precios || []
            },
            total: articulosComprados.length,
            data: articulosComprados
        });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error al obtener artículos comprados del cliente:`, error);
        res.status(500).json({ success: false, error: 'Error al consultar historial de artículos del cliente.' });
    }
};

/**
 * Obtener estructura en Árbol de un Nodo Barrial (cuadratura en vivo + subcuentas de vecinos)
 * GET /api/logistica/bunker/clientes/:id/arbol-nodo
 */
exports.obtenerArbolNodo = async (req, res) => {
    try {
        const data = await nodosBarrialesService.obtenerArbolNodoClientesBunker(req.params.id, {
            search: req.query.search || ''
        });
        res.json({ success: true, ok: true, ...data });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error en obtenerArbolNodo (${req.params.id}):`, error.message);
        res.status(400).json({ success: false, ok: false, error: error.message });
    }
};

/**
 * Obtener ficha integral de la Subcuenta de un Vecino comprador del Nodo
 * GET /api/logistica/bunker/clientes/nodos-vecinos/:vecinoId/subcuenta
 */
exports.obtenerSubcuentaVecinoNodo = async (req, res) => {
    try {
        const data = await nodosBarrialesService.obtenerSubcuentaVecinoDetalle(req.params.vecinoId);
        res.json({ success: true, ok: true, ...data });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error en obtenerSubcuentaVecinoNodo (${req.params.vecinoId}):`, error.message);
        res.status(400).json({ success: false, ok: false, error: error.message });
    }
};

/**
 * Conciliar pago de un pedido vecinal desde Clientes Búnker / Subcuenta del Vecino
 * POST /api/logistica/bunker/clientes/nodos-pedidos/:pedidoId/conciliar-pago
 */
exports.conciliarPagoPedidoVecinoNodo = async (req, res) => {
    try {
        const tablero = await nodosBarrialesService.conciliarPagoPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ success: true, ok: true, tablero });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error en conciliarPagoPedidoVecinoNodo (${req.params.pedidoId}):`, error.message);
        res.status(400).json({ success: false, ok: false, error: error.message });
    }
};

/**
 * Anular un pedido vecinal antes de su despacho/entrega desde Clientes Búnker / Subcuenta del Vecino
 * POST /api/logistica/bunker/clientes/nodos-pedidos/:pedidoId/anular
 */
exports.anularPedidoVecinoNodo = async (req, res) => {
    try {
        const resultado = await nodosBarrialesService.anularPedidoVecinoNodo(req.params.pedidoId, req.body || {});
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error en anularPedidoVecinoNodo (${req.params.pedidoId}):`, error.message);
        res.status(400).json({ success: false, ok: false, error: error.message });
    }
};

/**
 * Aplicar Nota de Crédito / ajuste parcial sobre pedido vecinal desde Clientes Búnker / Subcuenta del Vecino
 * POST /api/logistica/bunker/clientes/nodos-pedidos/:pedidoId/nota-credito
 */
exports.aplicarNotaCreditoPedidoVecinoNodo = async (req, res) => {
    try {
        const resultado = await nodosBarrialesService.aplicarNotaCreditoPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error(`❌ [CLIENTES-BUNKER] Error en aplicarNotaCreditoPedidoVecinoNodo (${req.params.pedidoId}):`, error.message);
        res.status(400).json({ success: false, ok: false, error: error.message });
    }
};

