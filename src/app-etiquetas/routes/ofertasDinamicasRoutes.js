// filepath: src/app-etiquetas/routes/ofertasDinamicasRoutes.js
'use strict';

const express = require('express');
const router = express.Router();
const OfertasDinamicasService = require('../../presupuestos/services/ofertasDinamicasService');
const pool = require('../../usuarios/pool');

// Helper para pausas secuenciales entre mensajes de difusión
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Integración automática con sincronizador de Supabase Cloud B2B
let sincronizarOfertasDinamicas;
try {
    const syncModule = require('../../actualizaPrecios/syncB2BOfertas');
    sincronizarOfertasDinamicas = syncModule.sincronizarOfertasDinamicas;
} catch (e) {
    console.warn('⚠️ [OFERTAS-ROUTES] No se pudo cargar sincronizarOfertasDinamicas:', e.message);
}

let ultimoSyncB2B = {
    timestamp: null,
    estado: 'IDLE',
    error: null
};

function dispararSyncB2BBackground() {
    if (typeof sincronizarOfertasDinamicas === 'function') {
        ultimoSyncB2B.estado = 'SYNCING';
        sincronizarOfertasDinamicas()
            .then(() => {
                ultimoSyncB2B = { timestamp: new Date().toISOString(), estado: 'SUCCESS', error: null };
                console.log('☁️ [OFERTAS] Auto-sync B2B completado con éxito.');
            })
            .catch(err => {
                ultimoSyncB2B = { timestamp: new Date().toISOString(), estado: 'ERROR', error: err.message };
                console.warn('⚠️ [OFERTAS] Error en auto-sync B2B:', err.message);
            });
    }
}

/**
 * GET /api/ofertas-dinamicas/sync-b2b/status
 * Retorna el estado de sincronización con B2B
 */
router.get('/ofertas-dinamicas/sync-b2b/status', (req, res) => {
    res.json({ success: true, data: ultimoSyncB2B });
});

/**
 * POST /api/ofertas-dinamicas/sync-b2b
 * Dispara la sincronización inmediata con Supabase Cloud
 */
router.post('/ofertas-dinamicas/sync-b2b', async (req, res) => {
    try {
        if (typeof sincronizarOfertasDinamicas !== 'function') {
            const syncModule = require('../../actualizaPrecios/syncB2BOfertas');
            sincronizarOfertasDinamicas = syncModule.sincronizarOfertasDinamicas;
        }

        if (typeof sincronizarOfertasDinamicas === 'function') {
            await sincronizarOfertasDinamicas();
            ultimoSyncB2B = { timestamp: new Date().toISOString(), estado: 'SUCCESS', error: null };
            return res.json({ success: true, message: 'Sincronización con Supabase Cloud completada exitosamente.' });
        } else {
            return res.status(500).json({ success: false, error: 'Módulo de sincronización no disponible.' });
        }
    } catch (err) {
        ultimoSyncB2B = { timestamp: new Date().toISOString(), estado: 'ERROR', error: err.message };
        console.error('❌ [OFERTAS] Error en sincronización manual B2B:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ofertas-dinamicas/calcular-stock-disponible
 * Calcula el stock real de ingredientes y productos terminados para los artículos seleccionados
 */
router.post('/ofertas-dinamicas/calcular-stock-disponible', async (req, res) => {
    try {
        const { articulos } = req.body;
        const infoStock = await OfertasDinamicasService.calcularStockArticulos(articulos, pool);
        res.json({ success: true, data: infoStock });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al calcular stock disponible:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ofertas-dinamicas
 * Lista todas las ofertas (o ?solo_activas=true)
 */
router.get('/ofertas-dinamicas', async (req, res) => {
    try {
        const soloActivas = req.query.solo_activas === 'true';
        const ofertas = await OfertasDinamicasService.obtenerOfertas(pool, soloActivas);
        res.json({ success: true, data: ofertas });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al listar ofertas:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ofertas-dinamicas/articulos-disponibles
 * Lista artículos disponibles en Búnker para seleccionar en una oferta (con nomenclatura completa)
 */
router.get('/ofertas-dinamicas/articulos-disponibles', async (req, res) => {
    try {
        const query = `
            SELECT ba.articulo_id, ba.descripcion, ba.descripcion_generada, ba.kilos_unidad, ba.familia_id,
                   ba.propiedades_dinamicas, bf.nombre AS familia_nombre
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            ORDER BY COALESCE(ba.descripcion_generada, ba.descripcion) ASC, ba.kilos_unidad DESC
        `;
        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al listar artículos disponibles:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ofertas-dinamicas/listas-disponibles
 * Lista las listas de precios activas
 */
router.get('/ofertas-dinamicas/listas-disponibles', async (req, res) => {
    try {
        const query = `
            SELECT id, nombre, descripcion, activa
            FROM public.bunker_listas_precios
            ORDER BY id ASC
        `;
        const result = await pool.query(query);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al listar listas de precios:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ofertas-dinamicas/contexto
 * Resuelve las ofertas activas para un cliente o lista de precios
 */
router.get('/ofertas-dinamicas/contexto', async (req, res) => {
    try {
        const { cliente_id, lista_id } = req.query;
        const mapaOfertas = await OfertasDinamicasService.obtenerOfertasActivasParaContexto({
            clienteId: cliente_id,
            listaPrecioId: lista_id
        }, pool);
        res.json({ success: true, data: mapaOfertas });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error en contexto de ofertas:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ofertas-dinamicas/:id
 * Retorna el detalle completo de una oferta
 */
router.get('/ofertas-dinamicas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const oferta = await OfertasDinamicasService.obtenerOfertaPorId(parseInt(id, 10), pool);
        if (!oferta) {
            return res.status(404).json({ success: false, error: 'Oferta no encontrada' });
        }
        res.json({ success: true, data: oferta });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al obtener oferta:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ofertas-dinamicas
 * Guarda o actualiza una oferta dinámica
 */
router.post('/ofertas-dinamicas', async (req, res) => {
    try {
        const ofertaGuardada = await OfertasDinamicasService.guardarOferta(req.body, pool);
        dispararSyncB2BBackground();
        res.json({ success: true, message: 'Oferta guardada exitosamente', data: ofertaGuardada });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al guardar oferta:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/ofertas-dinamicas/:id/estado
 * Cambia el estado de la oferta ('ACTIVA', 'PAUSADA', 'CANCELADA')
 */
router.patch('/ofertas-dinamicas/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        if (!['ACTIVA', 'PAUSADA', 'CANCELADA', 'AGOTADA'].includes(estado)) {
            return res.status(400).json({ success: false, error: 'Estado inválido' });
        }
        const updated = await OfertasDinamicasService.cambiarEstado(parseInt(id, 10), estado, pool);
        dispararSyncB2BBackground();
        res.json({ success: true, data: updated });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al cambiar estado:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/ofertas-dinamicas/:id
 * Elimina una oferta
 */
router.delete('/ofertas-dinamicas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const ok = await OfertasDinamicasService.eliminarOferta(parseInt(id, 10), pool);
        if (ok) dispararSyncB2BBackground();
        res.json({ success: ok, message: ok ? 'Oferta eliminada' : 'No se pudo eliminar' });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al eliminar oferta:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ofertas-dinamicas/:id/destinatarios
 * Obtiene la lista de clientes receptores para la difusión en cascada por WhatsApp
 */
/**
 * Función auxiliar para parsear y normalizar contactos de WhatsApp y Email
 * Soporta de forma exclusiva el flag 'default_difusion' sin pisar predeterminados de otros módulos
 */
function parseContactosCliente(rawWp, rawEmail, emailPortal, clienteNombre) {
    let wpList = [];
    if (rawWp) {
        if (typeof rawWp === 'string' && rawWp.trim().startsWith('[')) {
            try { wpList = JSON.parse(rawWp); } catch (e) {}
        } else if (Array.isArray(rawWp)) {
            wpList = rawWp;
        } else if (typeof rawWp === 'string') {
            const num = rawWp.replace(/\D/g, '');
            if (num.length >= 8) {
                wpList = [{ numero: num, nombre: clienteNombre, cargo: 'Titular', default: true }];
            }
        }
    }

    const hasExplicitDifusionWp = Array.isArray(wpList) && wpList.some(c => c.default_difusion !== undefined);

    wpList = (Array.isArray(wpList) ? wpList : []).map((c, idx) => {
        let isDefault = false;
        let esPredetExclusivo = false;
        if (hasExplicitDifusionWp) {
            isDefault = Boolean(c.default_difusion);
            esPredetExclusivo = isDefault;
        } else {
            // Fallback si nunca se configuró específicamente para difusión en este cliente
            isDefault = Boolean(c.default_presupuesto ?? c.default_factura ?? c.default ?? (idx === 0));
        }
        return {
            id: c.id || `wp_${idx}`,
            numero: String(c.numero || '').replace(/\D/g, ''),
            nombre: c.nombre || clienteNombre || 'Contacto',
            cargo: c.cargo || 'Responsable',
            default: isDefault,
            es_predeterminado_difusion: esPredetExclusivo
        };
    }).filter(c => c.numero.length >= 8);

    let emailList = [];
    if (rawEmail) {
        if (typeof rawEmail === 'string' && rawEmail.trim().startsWith('[')) {
            try { emailList = JSON.parse(rawEmail); } catch (e) {}
        } else if (Array.isArray(rawEmail)) {
            emailList = rawEmail;
        } else if (typeof rawEmail === 'string' && rawEmail.includes('@')) {
            emailList = [{ email: rawEmail.trim(), nombre: clienteNombre, cargo: 'Titular', default: true }];
        }
    }

    const hasExplicitDifusionEmail = Array.isArray(emailList) && emailList.some(e => e.default_difusion !== undefined);

    emailList = (Array.isArray(emailList) ? emailList : []).map((e, idx) => {
        let isDefault = false;
        let esPredetExclusivo = false;
        if (hasExplicitDifusionEmail) {
            isDefault = Boolean(e.default_difusion);
            esPredetExclusivo = isDefault;
        } else {
            // Fallback si nunca se configuró para difusión
            isDefault = Boolean(e.default_presupuesto ?? e.default_factura ?? e.default ?? (idx === 0));
        }
        return {
            id: e.id || `em_${idx}`,
            email: String(e.email || '').trim().toLowerCase(),
            nombre: e.nombre || clienteNombre || 'Contacto',
            cargo: e.cargo || 'Responsable',
            default: isDefault,
            es_predeterminado_difusion: esPredetExclusivo
        };
    }).filter(e => e.email.includes('@') && !e.email.includes('[]'));

    // Incluir email_portal si no es genérico interno y no está ya presente
    if (emailPortal && emailPortal.includes('@') && !emailPortal.endsWith('@lamdaclientes.com')) {
        const portalNormalized = emailPortal.trim().toLowerCase();
        if (!emailList.some(e => e.email === portalNormalized)) {
            emailList.push({
                id: 'portal',
                email: portalNormalized,
                nombre: clienteNombre,
                cargo: 'Portal B2B',
                default: !hasExplicitDifusionEmail && emailList.length === 0,
                es_predeterminado_difusion: false
            });
        }
    }

    return { wpList, emailList };
}

/**
 * GET /api/ofertas-dinamicas/:id/destinatarios
 * Obtiene los clientes destinatarios asociados a las listas de la oferta con desglose omnicanal
 */
router.get('/ofertas-dinamicas/:id/destinatarios', async (req, res) => {
    try {
        const { id } = req.params;
        const oferta = await OfertasDinamicasService.obtenerOfertaPorId(parseInt(id, 10), pool);
        if (!oferta) {
            return res.status(404).json({ success: false, error: 'Oferta no encontrada' });
        }

        const listasIds = oferta.listas.map(l => l.bunker_lista_precio_id);
        if (listasIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const idsExcluidos = oferta.excepciones
            .filter(e => e.tipo_excepcion === 'EXCLUIDO')
            .map(e => e.cliente_id);

        // Clientes vinculados a estas listas
        const qClientes = `
            SELECT DISTINCT 
                bc.id AS bunker_cliente_id,
                bc.cliente_nombre,
                bc.razon_social,
                bc.codigo_bunker_cliente,
                bc.whatsapp_facturas,
                bc.email_facturas,
                bc.email_portal,
                bc.email_portal_nombre,
                bc.canal_envio_preferido,
                blp.id AS lista_id,
                blp.nombre AS lista_nombre
            FROM public.bunker_clientes bc
            JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
            JOIN public.bunker_listas_precios blp ON blp.id = bclp.bunker_lista_precio_id
            WHERE bclp.bunker_lista_precio_id = ANY($1)
            ORDER BY bc.cliente_nombre ASC
        `;
        const resClientes = await pool.query(qClientes, [listasIds]);

        // Filtrar excluidos y enriquecer con desglose de canales
        const destinatarios = resClientes.rows
            .filter(c => !idsExcluidos.includes(c.bunker_cliente_id))
            .map(c => {
                const contactos = parseContactosCliente(c.whatsapp_facturas, c.email_facturas, c.email_portal, c.cliente_nombre);
                return {
                    bunker_cliente_id: c.bunker_cliente_id,
                    cliente_nombre: c.cliente_nombre,
                    razon_social: c.razon_social,
                    codigo_bunker_cliente: c.codigo_bunker_cliente,
                    lista_id: c.lista_id,
                    lista_nombre: c.lista_nombre,
                    canal_envio_preferido: c.canal_envio_preferido,
                    whatsapp_contactos: contactos.wpList,
                    email_contactos: contactos.emailList,
                    // Propiedades fallback
                    telefono: contactos.wpList[0]?.numero || null,
                    email: contactos.emailList[0]?.email || null
                };
            })
            // Solo clientes con al menos un canal disponible
            .filter(c => c.whatsapp_contactos.length > 0 || c.email_contactos.length > 0);

        res.json({
            success: true,
            oferta_id: oferta.id,
            oferta_titulo: oferta.titulo,
            total_destinatarios: destinatarios.length,
            data: destinatarios
        });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al obtener destinatarios:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ofertas-dinamicas/:id/difundir
 * Despacha en cascada los mensajes omnicanal (WhatsApp y Email) hacia los destinatarios seleccionados
 */
router.post('/ofertas-dinamicas/:id/difundir', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            destinatarios_whatsapp = [],
            destinatarios_email = [],
            destinatarios = [], // Compatibilidad legacy
            plantilla_whatsapp = '',
            plantilla_mensaje = '', // Compatibilidad legacy
            asunto_email = '',
            plantilla_email = '',
            guardar_predeterminados = false
        } = req.body;

        // Normalizar destinatarios WhatsApp
        let listaWp = Array.isArray(destinatarios_whatsapp) && destinatarios_whatsapp.length > 0 
            ? destinatarios_whatsapp 
            : destinatarios;

        let listaEmail = Array.isArray(destinatarios_email) ? destinatarios_email : [];

        const msgWp = (plantilla_whatsapp || plantilla_mensaje || '').trim();
        const msgEmail = (plantilla_email || msgWp || '').trim();

        if (listaWp.length === 0 && listaEmail.length === 0) {
            return res.status(400).json({ success: false, error: 'Debe seleccionar al menos un destinatario (WhatsApp o Email)' });
        }

        const oferta = await OfertasDinamicasService.obtenerOfertaPorId(parseInt(id, 10), pool);
        if (!oferta) {
            return res.status(404).json({ success: false, error: 'Oferta no encontrada' });
        }

        console.log(`📢 [OFERTAS-DIFUSION] Iniciando cascada omnicanal para oferta #${id} (${listaWp.length} WhatsApp, ${listaEmail.length} Email)...`);

        // Despacho asíncrono en segundo plano
        (async () => {
            // Guardar predeterminados si el usuario lo marcó
            if (guardar_predeterminados) {
                try {
                    const clientesModificados = new Set([
                        ...listaWp.map(w => w.bunker_cliente_id),
                        ...listaEmail.map(e => e.bunker_cliente_id)
                    ]);

                    for (const cId of clientesModificados) {
                        if (!cId) continue;
                        const cliQuery = await pool.query('SELECT whatsapp_facturas, email_facturas FROM public.bunker_clientes WHERE id = $1', [cId]);
                        if (cliQuery.rows.length === 0) continue;

                        let wpRaw = cliQuery.rows[0].whatsapp_facturas;
                        let emRaw = cliQuery.rows[0].email_facturas;

                        // Actualizar WhatsApp default_difusion (exclusivo para difusión en cascada)
                        const selectedWpsForCli = listaWp.filter(w => w.bunker_cliente_id === cId);
                        if (wpRaw && wpRaw.trim().startsWith('[')) {
                            try {
                                let wpArr = JSON.parse(wpRaw);
                                if (Array.isArray(wpArr)) {
                                    wpArr.forEach(c => {
                                        const cleanNum = String(c.numero || '').replace(/\D/g, '');
                                        c.default_difusion = selectedWpsForCli.some(w => String(w.telefono || '').replace(/\D/g, '') === cleanNum);
                                    });
                                    await pool.query('UPDATE public.bunker_clientes SET whatsapp_facturas = $1 WHERE id = $2', [JSON.stringify(wpArr), cId]);
                                }
                            } catch (eJson) {}
                        }

                        // Actualizar Email default_difusion (exclusivo para difusión en cascada)
                        const selectedEmailsForCli = listaEmail.filter(e => e.bunker_cliente_id === cId);
                        if (emRaw && emRaw.trim().startsWith('[')) {
                            try {
                                let emArr = JSON.parse(emRaw);
                                if (Array.isArray(emArr)) {
                                    emArr.forEach(e => {
                                        const cleanMail = String(e.email || '').trim().toLowerCase();
                                        e.default_difusion = selectedEmailsForCli.some(em => String(em.email || '').trim().toLowerCase() === cleanMail);
                                    });
                                    await pool.query('UPDATE public.bunker_clientes SET email_facturas = $1 WHERE id = $2', [JSON.stringify(emArr), cId]);
                                }
                            } catch (eJson) {}
                        }
                    }
                    console.log(`💾 [OFERTAS-DIFUSION] Contactos predeterminados actualizados para ${clientesModificados.size} cliente(s).`);
                } catch (errDefaults) {
                    console.warn('⚠️ [OFERTAS-DIFUSION] No se pudieron actualizar contactos predeterminados:', errDefaults.message);
                }
            }

            // Despacho de WhatsApp
            let wpOk = 0, wpError = 0;
            if (listaWp.length > 0 && msgWp) {
                for (let i = 0; i < listaWp.length; i++) {
                    const dest = listaWp[i];
                    const tel = String(dest.telefono || '').replace(/[^0-9]/g, '');
                    if (!tel || tel.length < 8) continue;

                    const nombreContacto = dest.contacto_nombre || dest.cliente_nombre || dest.razon_social || 'Estimado cliente';
                    const textoPersonalizado = msgWp
                        .replace(/\{contacto\}/gi, nombreContacto)
                        .replace(/\{cliente\}/gi, dest.cliente_nombre || nombreContacto)
                        .replace(/\{titulo\}/gi, oferta.titulo)
                        .replace(/\{descuento\}/gi, `${oferta.descuento_porcentaje}%`)
                        .replace(/\{cuota\}/gi, `${oferta.cuota_disponible} ${oferta.unidad_cuota.toLowerCase()}`);

                    try {
                        const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-mensaje', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                destinatarios: tel,
                                mensajeTexto: textoPersonalizado.trim()
                            })
                        });

                        if (response.ok) {
                            wpOk++;
                            await pool.query(`
                                INSERT INTO public.crm_seguimientos_whatsapp (
                                    bunker_cliente_id, cliente_nombre, contacto_nombre, telefono_destino,
                                    fecha_programada, hora_programada, mensajes, nota_interna, estado, enviado_at
                                ) VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_TIME, $5, $6, 'ENVIADO', NOW())
                            `, [
                                dest.bunker_cliente_id || null,
                                dest.cliente_nombre || 'Cliente',
                                nombreContacto,
                                tel,
                                JSON.stringify([textoPersonalizado.trim()]),
                                `Difusión Cascada Oferta #${oferta.id}: ${oferta.titulo}`
                            ]);
                        } else {
                            wpError++;
                        }
                    } catch (e) {
                        console.error(`❌ [OFERTAS-DIFUSION] Error enviando WhatsApp a ${tel}:`, e.message);
                        wpError++;
                    }

                    if (i < listaWp.length - 1) {
                        await sleep(1800);
                    }
                }
            }

            // Despacho de Correo Electrónico
            let emOk = 0, emError = 0;
            if (listaEmail.length > 0 && msgEmail) {
                for (let j = 0; j < listaEmail.length; j++) {
                    const dest = listaEmail[j];
                    const email = String(dest.email || '').trim().toLowerCase();
                    if (!email || !email.includes('@')) continue;

                    const nombreContacto = dest.contacto_nombre || dest.cliente_nombre || dest.razon_social || 'Estimado cliente';
                    const textoPersonalizado = msgEmail
                        .replace(/\{contacto\}/gi, nombreContacto)
                        .replace(/\{cliente\}/gi, dest.cliente_nombre || nombreContacto)
                        .replace(/\{titulo\}/gi, oferta.titulo)
                        .replace(/\{descuento\}/gi, `${oferta.descuento_porcentaje}%`)
                        .replace(/\{cuota\}/gi, `${oferta.cuota_disponible} ${oferta.unidad_cuota.toLowerCase()}`);

                    const asuntoPersonalizado = (asunto_email || `🔥 Oportunidad Especial: ${oferta.titulo} (${oferta.descuento_porcentaje}% OFF)`)
                        .replace(/\{titulo\}/gi, oferta.titulo)
                        .replace(/\{descuento\}/gi, `${oferta.descuento_porcentaje}%`);

                    try {
                        const response = await fetch('http://localhost:3004/facturacion/email/notificacion/enviar', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                clienteNombre: dest.cliente_nombre || nombreContacto,
                                destinatarios: email,
                                asunto: asuntoPersonalizado,
                                mensajeTexto: textoPersonalizado.trim()
                            })
                        });

                        if (response.ok) {
                            emOk++;
                        } else {
                            emError++;
                        }
                    } catch (e) {
                        console.error(`❌ [OFERTAS-DIFUSION] Error enviando Email a ${email}:`, e.message);
                        emError++;
                    }

                    if (j < listaEmail.length - 1) {
                        await sleep(400);
                    }
                }
            }

            console.log(`✅ [OFERTAS-DIFUSION] Difusión finalizada: WhatsApp (${wpOk} ok, ${wpError} err) | Email (${emOk} ok, ${emError} err).`);
        })();

        res.json({
            success: true,
            message: `Difusión omnicanal iniciada: ${listaWp.length} WhatsApp y ${listaEmail.length} correos electrónicos en proceso de despacho.`,
            total_whatsapp: listaWp.length,
            total_email: listaEmail.length
        });

    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al iniciar difusión:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ofertas-dinamicas/guardar-predeterminados-difusion
 * Guarda de forma exclusiva los contactos predeterminados para la difusión en cascada (default_difusion)
 * sin pisar los predeterminados de facturación, presupuestos o demanda.
 */
router.post('/ofertas-dinamicas/guardar-predeterminados-difusion', async (req, res) => {
    try {
        const { clientes = [] } = req.body;
        if (!Array.isArray(clientes) || clientes.length === 0) {
            return res.status(400).json({ success: false, error: 'No se recibieron clientes para actualizar' });
        }

        let actualizados = 0;
        for (const item of clientes) {
            const clienteId = parseInt(item.bunker_cliente_id, 10);
            if (!clienteId) continue;

            const telefonosActivos = (item.telefonos_seleccionados || []).map(t => String(t).replace(/\D/g, ''));
            const emailsActivos = (item.emails_seleccionados || []).map(e => String(e).trim().toLowerCase());

            const resDb = await pool.query('SELECT whatsapp_facturas, email_facturas FROM public.bunker_clientes WHERE id = $1', [clienteId]);
            if (resDb.rows.length === 0) continue;

            let wpRaw = resDb.rows[0].whatsapp_facturas;
            let emRaw = resDb.rows[0].email_facturas;

            let wpUpdated = false;
            let emUpdated = false;

            if (wpRaw && typeof wpRaw === 'string' && wpRaw.trim().startsWith('[')) {
                try {
                    let wpArr = JSON.parse(wpRaw);
                    if (Array.isArray(wpArr)) {
                        wpArr.forEach(c => {
                            const cleanNum = String(c.numero || '').replace(/\D/g, '');
                            c.default_difusion = telefonosActivos.includes(cleanNum);
                        });
                        wpRaw = JSON.stringify(wpArr);
                        wpUpdated = true;
                    }
                } catch (e) {}
            }

            if (emRaw && typeof emRaw === 'string' && emRaw.trim().startsWith('[')) {
                try {
                    let emArr = JSON.parse(emRaw);
                    if (Array.isArray(emArr)) {
                        emArr.forEach(e => {
                            const cleanMail = String(e.email || '').trim().toLowerCase();
                            e.default_difusion = emailsActivos.includes(cleanMail);
                        });
                        emRaw = JSON.stringify(emArr);
                        emUpdated = true;
                    }
                } catch (e) {}
            }

            if (wpUpdated || emUpdated) {
                await pool.query(
                    'UPDATE public.bunker_clientes SET whatsapp_facturas = $1, email_facturas = $2, updated_at = NOW() WHERE id = $3',
                    [wpRaw, emRaw, clienteId]
                );
                actualizados++;
            }
        }

        res.json({
            success: true,
            message: `Se guardaron los contactos predeterminados de difusión para ${actualizados} cliente(s).`,
            actualizados
        });
    } catch (err) {
        console.error('❌ [OFERTAS-DINAMICAS] Error al guardar predeterminados de difusión:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
