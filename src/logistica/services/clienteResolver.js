const { pool } = require('../config/database');

/**
 * Servicio unificado de resolución 1-a-1 de clientes y contactos de Búnker / Logística.
 */

/**
 * Normaliza y asigna un ID único y booleano estricto a un objeto de contacto.
 * @param {Object} contacto 
 * @param {number} idx 
 * @returns {Object} Contacto normalizado con ID e indicadores booleanos estrictos
 */
function normalizarContacto(contacto, idx = 0) {
    if (!contacto || typeof contacto !== 'object') {
        return null;
    }

    const numClean = contacto.numero ? String(contacto.numero).replace(/\D/g, '') : '';
    const emailClean = contacto.email ? String(contacto.email).trim() : '';

    if (!numClean && !emailClean) {
        return null;
    }

    // Evaluación booleana estricta de enviar_alerta
    const enviarAlertaBool = contacto.enviar_alerta !== false && 
                             contacto.enviar_alerta !== 'false' && 
                             contacto.enviar_alerta !== 0 && 
                             contacto.enviar_alerta !== '0';

    const defaultFacturaBool = contacto.default_factura === true || 
                               contacto.default_factura === 'true' || 
                               contacto.default === true || 
                               contacto.default === 'true';

    const defaultResumenBool = contacto.default_resumen === true || 
                               contacto.default_resumen === 'true';

    return {
        id: contacto.id || `cont_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
        numero: numClean,
        email: emailClean,
        nombre: contacto.nombre ? String(contacto.nombre).trim() : '',
        cargo: contacto.cargo ? String(contacto.cargo).trim() : '',
        enviar_alerta: enviarAlertaBool,
        default_factura: defaultFacturaBool,
        default_resumen: defaultResumenBool
    };
}

/**
 * Resuelve la ficha unificada 1-a-1 de un cliente consultando bunker_clientes y clientes.
 * @param {Object} dbClient Client de base de datos dentro de transacción o pool general
 * @param {string|number} idClienteOrCodigo ID Legacy, código Búnker o PK de Búnker
 * @returns {Promise<Object>} Entidad unificada del cliente
 */
async function obtenerClienteUnificado(dbClient, idClienteOrCodigo) {
    const client = dbClient || pool;
    if (!idClienteOrCodigo) return null;

    const rawStr = String(idClienteOrCodigo).trim();
    if (!rawStr) return null;

    const ltrimStr = rawStr.replace(/^0+/, '');

    const query = `
        SELECT 
            bc.id as bunker_id,
            bc.codigo_bunker_cliente,
            bc.lomas_soft_id,
            COALESCE(bc.cliente_nombre, bc.razon_social, c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Cliente') as cliente_nombre,
            bc.whatsapp_facturas,
            bc.email_facturas,
            bc.canal_envio_preferido,
            c.cliente_id as legacy_cliente_id,
            c.celular as legacy_celular,
            c.telefono as legacy_telefono,
            c.email as legacy_email
        FROM public.bunker_clientes bc
        FULL OUTER JOIN public.clientes c 
            ON ltrim(bc.lomas_soft_id, '0') = ltrim(c.cliente_id::text, '0') 
           AND bc.lomas_soft_id IS NOT NULL 
           AND TRIM(bc.lomas_soft_id) != ''
        WHERE bc.codigo_bunker_cliente = $1
           OR (CASE WHEN $1 ~ '^[0-9]+$' THEN bc.id = $1::integer ELSE false END)
           OR (bc.lomas_soft_id IS NOT NULL AND ltrim(bc.lomas_soft_id, '0') = $2)
           OR (CASE WHEN $1 ~ '^[0-9]+$' THEN c.cliente_id = $1::integer ELSE false END)
           OR (c.cliente_id IS NOT NULL AND ltrim(c.cliente_id::text, '0') = $2)
        ORDER BY 
           (CASE 
               WHEN bc.codigo_bunker_cliente = $1 THEN 1
               WHEN (bc.lomas_soft_id IS NOT NULL AND ltrim(bc.lomas_soft_id, '0') = $2) THEN 2
               WHEN (c.cliente_id IS NOT NULL AND ltrim(c.cliente_id::text, '0') = $2) THEN 3
               ELSE 4
            END),
           (CASE WHEN bc.whatsapp_facturas IS NOT NULL AND TRIM(bc.whatsapp_facturas) != '' THEN 1 ELSE 2 END),
           bc.id DESC NULLS LAST
        LIMIT 1
    `;

    const res = await client.query(query, [rawStr, ltrimStr]);
    if (res.rowCount === 0) return null;

    const row = res.rows[0];
    return {
        bunker_id: row.bunker_id,
        codigo_bunker_cliente: row.codigo_bunker_cliente,
        lomas_soft_id: row.lomas_soft_id,
        legacy_cliente_id: row.legacy_cliente_id,
        cliente_nombre: row.cliente_nombre,
        whatsapp_facturas: row.whatsapp_facturas,
        email_facturas: row.email_facturas,
        canal_envio_preferido: row.canal_envio_preferido || 'whatsapp',
        legacy_celular: row.legacy_celular,
        legacy_telefono: row.legacy_telefono,
        legacy_email: row.legacy_email,
        tiene_bunker_cliente: Boolean(row.bunker_id || row.codigo_bunker_cliente)
    };
}

/**
 * Resuelve la lista estricta de números de WhatsApp destinatarios para alertas de entrega.
 * @param {Object} clienteObj Objeto retornado por obtenerClienteUnificado
 * @returns {Array<{numero: string, nombre: string, cargo: string, id: string}>} Lista de destinatarios
 */
function resolverDestinatariosAlertaEntrega(clienteObj) {
    if (!clienteObj) return [];

    console.log(`🔍 [CLIENTE-RESOLVER] Resolviendo destinatarios de alerta entrega para cliente: ${clienteObj.codigo_bunker_cliente || clienteObj.legacy_cliente_id} (${clienteObj.cliente_nombre})`);

    // 1. Si existe configuración en whatsapp_facturas (Búnker)
    if (clienteObj.whatsapp_facturas && typeof clienteObj.whatsapp_facturas === 'string' && clienteObj.whatsapp_facturas.trim()) {
        const rawStr = clienteObj.whatsapp_facturas.trim();
        if (rawStr.startsWith('[')) {
            try {
                const list = JSON.parse(rawStr);
                if (Array.isArray(list) && list.length > 0) {
                    const destinatarios = [];
                    list.forEach((rawContact, idx) => {
                        const c = normalizarContacto(rawContact, idx);
                        if (!c || !c.numero) return;

                        if (c.enviar_alerta === true) {
                            console.log(`   ✅ Contacto INCLUIDO: [ID: ${c.id}] ${c.nombre || 'S/N'} (${c.cargo || 'Contacto'}) -> Tel: ${c.numero} (enviar_alerta = true)`);
                            destinatarios.push({
                                id: c.id,
                                numero: c.numero,
                                nombre: c.nombre,
                                cargo: c.cargo
                            });
                        } else {
                            console.log(`   ⛔ Contacto EXCLUIDO: [ID: ${c.id}] ${c.nombre || 'S/N'} (${c.cargo || 'Contacto'}) -> Tel: ${c.numero} (enviar_alerta = false)`);
                        }
                    });

                    console.log(`📌 [CLIENTE-RESOLVER] Total destinatarios resueltos por Búnker: ${destinatarios.length} de ${list.length} contactos.`);
                    // REGLA DE NEGOCIO: Si la ficha Búnker tiene lista de contactos, RETORNAMOS la lista resuelta (incluso si es [] por silencio absoluto).
                    return destinatarios;
                }
            } catch (err) {
                console.error(`❌ [CLIENTE-RESOLVER] Error parseando JSON whatsapp_facturas:`, err.message);
            }
        } else {
            // String simple separado por comas
            const simpleNums = rawStr.split(',')
                .map(n => n.replace(/\D/g, '').trim())
                .filter(n => n.length >= 8);

            if (simpleNums.length > 0) {
                console.log(`📌 [CLIENTE-RESOLVER] Destinatarios resueltos por string simple: ${simpleNums.length}`);
                return simpleNums.map((n, i) => ({ id: `simple_${i}`, numero: n, nombre: 'Contacto', cargo: '' }));
            }
        }
    }

    // 2. FALLBACK ÚNICAMENTE SI EL CLIENTE NO POSEE FICHA BÚNKER (Cliente Legacy Puro)
    if (!clienteObj.tiene_bunker_cliente) {
        console.log(`⚠️ [CLIENTE-RESOLVER] Cliente sin ficha Búnker. Evaluando fallback a teléfono principal legacy...`);
        const fallbackNum = clienteObj.legacy_celular || clienteObj.legacy_telefono;
        if (fallbackNum) {
            const clean = String(fallbackNum).replace(/\D/g, '');
            if (clean.length >= 8) {
                console.log(`   ✅ Fallback legacy utilizado: Tel: ${clean}`);
                return [{ id: 'legacy_fallback', numero: clean, nombre: clienteObj.cliente_nombre, cargo: 'Ficha Legacy' }];
            }
        }
    } else {
        console.log(`🛑 [CLIENTE-RESOLVER] Cliente Búnker sin destinatarios activos o con whatsapp_facturas vacío. RESPETANDO SILENCIO (0 notificaciones enviadas).`);
    }

    return [];
}

module.exports = {
    normalizarContacto,
    obtenerClienteUnificado,
    resolverDestinatariosAlertaEntrega
};
