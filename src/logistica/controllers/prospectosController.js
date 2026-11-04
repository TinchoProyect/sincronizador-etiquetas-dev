/**
 * Controlador de Prospectos Búnker (CRM Preventa)
 * Maneja peticiones HTTP tanto de la App Móvil (preventa en calle) como de la Web Desktop (mostrador y administración).
 */

const ProspectosModel = require('../models/prospectosModel');

class ProspectosController {
    /**
     * GET /api/logistica/prospectos
     */
    static async obtenerTodos(req, res) {
        try {
            const { search, zona, estado, origen, soloHoy, limit, offset } = req.query;
            const prospectos = await ProspectosModel.obtenerTodos({
                search,
                zona,
                estado,
                origen,
                soloHoy: soloHoy === 'true' || soloHoy === true,
                limit: limit ? parseInt(limit) : 200,
                offset: offset ? parseInt(offset) : 0
            });
            res.json({
                success: true,
                data: prospectos,
                total: prospectos.length
            });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al obtener prospectos:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/metricas
     */
    static async obtenerMetricas(req, res) {
        try {
            const metricas = await ProspectosModel.obtenerMetricas();
            res.json({ success: true, data: metricas });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al obtener métricas:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/zonas
     */
    static async obtenerZonas(req, res) {
        try {
            const zonas = await ProspectosModel.obtenerZonas();
            res.json({ success: true, data: zonas });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al obtener zonas:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/listas-precios
     */
    static async obtenerListasPrecios(req, res) {
        try {
            const listas = await ProspectosModel.obtenerListasPrecios();
            res.json({ success: true, data: listas });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al obtener listas de precios:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/embudo
     */
    static async obtenerMetricasEmbudo(req, res) {
        try {
            const embudo = await ProspectosModel.obtenerMetricasEmbudo();
            res.json({ success: true, data: embudo });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al obtener métricas de embudo:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/:id
     */
    static async obtenerPorId(req, res) {
        try {
            const { id } = req.params;
            const prospecto = await ProspectosModel.obtenerPorId(id);
            if (!prospecto) {
                return res.status(404).json({ success: false, error: 'Prospecto no encontrado.' });
            }
            res.json({ success: true, data: prospecto });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al obtener prospecto por ID:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos
     */
    static async crear(req, res) {
        try {
            const datos = req.body || {};
            // Si el usuario viene en req.user o sesion
            const usuarioCreador = req.user?.usuario || req.user?.nombre || datos.creado_por || 'sistema';
            datos.creado_por = usuarioCreador;

            const nuevo = await ProspectosModel.crear(datos);
            res.status(201).json({
                success: true,
                message: 'Prospecto registrado exitosamente.',
                data: nuevo
            });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al crear prospecto:', e);
            res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * PUT /api/logistica/prospectos/:id
     */
    static async actualizar(req, res) {
        try {
            const { id } = req.params;
            const datos = req.body || {};
            const actualizado = await ProspectosModel.actualizar(id, datos);
            res.json({
                success: true,
                message: 'Prospecto actualizado exitosamente.',
                data: actualizado
            });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al actualizar prospecto:', e);
            res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * PATCH /api/logistica/prospectos/:id/estado
     */
    static async cambiarEstado(req, res) {
        try {
            const { id } = req.params;
            const { estado, notas, fecha_revisita, lista_precios_sugerida_id } = req.body || {};
            if (!estado) {
                return res.status(400).json({ success: false, error: 'El campo estado es requerido.' });
            }
            const actualizado = await ProspectosModel.cambiarEstado(id, estado, { notas, fecha_revisita, lista_precios_sugerida_id });
            res.json({
                success: true,
                message: 'Estado del prospecto actualizado.',
                data: actualizado
            });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al cambiar estado:', e);
            res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/:id/convertir
     */
    static async convertir(req, res) {
        try {
            const { id } = req.params;
            const { bunker_cliente_id } = req.body || {};
            if (!bunker_cliente_id) {
                return res.status(400).json({ success: false, error: 'bunker_cliente_id es requerido para asociar la conversión.' });
            }
            const convertido = await ProspectosModel.convertirACliente(id, bunker_cliente_id);
            res.json({
                success: true,
                message: 'Prospecto convertido a cliente formal exitosamente.',
                data: convertido
            });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al convertir prospecto:', e);
            res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * DELETE /api/logistica/prospectos/:id
     */
    static async eliminar(req, res) {
        try {
            const { id } = req.params;
            const ok = await ProspectosModel.eliminar(id);
            if (!ok) {
                return res.status(404).json({ success: false, error: 'Prospecto no encontrado.' });
            }
            res.json({ success: true, message: 'Prospecto dado de baja.' });
        } catch (e) {
            console.error('[PROSPECTOS-CONTROLLER] Error al eliminar prospecto:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/:id/enviar-catalogo-whatsapp
     * Despacho 100% automatizado del catálogo PDF oficial desde el microservicio central de WhatsApp (puerto 3004)
     */
    static async enviarCatalogoWhatsApp(req, res) {
        try {
            const { id } = req.params;
            const {
                telefono,
                lista_id,
                modo_iva,
                modo_precio,
                agrupar_por_atributo,
                mostrar_hijos,
                ocultar_columna_iva,
                destacar_ofertas,
                mostrar_composicion_mixes,
                bonificacion_volumen,
                mensajeTexto
            } = req.body || {};

            // 1. Obtener prospecto
            const prospecto = await ProspectosModel.obtenerPorId(id);
            if (!prospecto) {
                return res.status(404).json({ success: false, error: 'Prospecto no encontrado.' });
            }

            // 2. Destinatario telefónico
            let numDestino = telefono || prospecto.telefono_whatsapp;
            if (!numDestino || !String(numDestino).trim()) {
                return res.status(400).json({ success: false, error: 'El prospecto no posee un número de teléfono o WhatsApp válido.' });
            }

            // Si el teléfono ingresado difiere del guardado, actualizarlo
            if (telefono && telefono.trim() !== (prospecto.telefono_whatsapp || '').trim()) {
                await ProspectosModel.actualizar(id, { telefono_whatsapp: telefono.trim() }).catch(() => {});
            }

            // 3. Generar PDF oficial en memoria usando BunkerController
            const BunkerController = require('./bunkerController');
            const targetListaId = parseInt(lista_id || prospecto.lista_precios_sugerida_id || 5, 10);
            const db = req.db || require('../config/database').pool;

            let nivelesAgrupar = 'todos';
            if (Array.isArray(agrupar_por_atributo)) {
                nivelesAgrupar = agrupar_por_atributo;
            } else if (typeof agrupar_por_atributo === 'string' && agrupar_por_atributo.trim()) {
                nivelesAgrupar = agrupar_por_atributo === 'plana' ? [] : (agrupar_por_atributo === 'todos' ? 'todos' : agrupar_por_atributo.split(',').map(s => s.trim().toLowerCase()));
            }

            const pdfParams = {
                lista_id: targetListaId,
                cliente_nombre: prospecto.nombre_fantasia || prospecto.cartel_o_nombre || 'Cliente',
                titulo_informe: 'Lista de Precios y Catálogo',
                modo_iva: modo_iva || 'con_iva',
                modo_precio: modo_precio || 'ambos',
                agrupar_por_atributo: nivelesAgrupar,
                mostrar_hijos: mostrar_hijos !== false && mostrar_hijos !== 'false',
                ocultar_columna_iva: ocultar_columna_iva === true || ocultar_columna_iva === 'true',
                destacar_ofertas: destacar_ofertas !== false && destacar_ofertas !== 'false',
                mostrar_composicion_mixes: mostrar_composicion_mixes !== false && mostrar_composicion_mixes !== 'false',
                bonificacion_volumen: bonificacion_volumen !== false && bonificacion_volumen !== 'false'
            };

            console.log(`📑 [PROSPECTOS] Generando catálogo PDF para WhatsApp. Destino: ${numDestino}, Lista: ${targetListaId}`);
            const { buffer, filename } = await BunkerController.generarPDFCotizacionBuffer(pdfParams, db);

            // 4. Texto del mensaje
            const textoFinal = (mensajeTexto && mensajeTexto.trim()) 
                ? mensajeTexto.trim() 
                : `Hola, te compartimos nuestra lista de precios y catálogo oficial de LAMDA en formato PDF adjunto. Quedamos a total disposición. ¡Muchas gracias!`;

            // 5. Despacho HTTP hacia el microservicio central de WhatsApp (puerto 3004)
            const payloadWhatsApp = {
                destinatarios: numDestino,
                pdfBase64: buffer.toString('base64'),
                filename: filename || `Lista_Precios_${(prospecto.nombre_fantasia || 'Cliente').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
                mensajeTexto: textoFinal
            };

            console.log(`📱 [PROSPECTOS] Despachando WhatsApp oficial a ${numDestino} (${payloadWhatsApp.filename})...`);
            const wpResponse = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/enviar-documento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadWhatsApp)
            });

            const wpJson = await wpResponse.json().catch(() => ({}));
            if (!wpResponse.ok || !wpJson.success) {
                const errMsg = wpJson.message || wpJson.error || 'No se pudo despachar el mensaje por WhatsApp. Verifique la conexión del bot en Facturación.';
                console.error('❌ [PROSPECTOS] Error devuelto por microservicio WhatsApp:', wpJson);
                return res.status(502).json({ success: false, error: errMsg, detalles: wpJson });
            }

            // 6. Actualizar estado del prospecto a LISTA_ENVIADA
            await ProspectosModel.cambiarEstado(id, 'LISTA_ENVIADA', {
                notas: prospecto.notas ? `${prospecto.notas} (Catálogo oficial enviado por WhatsApp desde central LAMDA)` : 'Catálogo oficial enviado por WhatsApp desde central LAMDA',
                lista_precios_sugerida_id: targetListaId
            }).catch(e => console.warn('[PROSPECTOS] Error actualizando estado a LISTA_ENVIADA:', e.message));

            console.log(`✅ [PROSPECTOS] Catálogo PDF enviado con éxito a ${numDestino}`);
            return res.json({
                success: true,
                message: `Catálogo oficial enviado con éxito a ${numDestino} vía WhatsApp centralizado de LAMDA.`,
                data: {
                    destinatario: numDestino,
                    filename,
                    detalles: wpJson.data
                }
            });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en enviarCatalogoWhatsApp:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/rutas-disponibles
     * Lista las Hojas de Ruta activas (ARMANDO o EN_CAMINO) y los choferes activos para poder enviar visitas de preventa a una ruta.
     */
    static async obtenerRutasDisponibles(req, res) {
        try {
            const { pool } = require('../config/database');
            const rutasRes = await pool.query(`
                SELECT 
                    r.id,
                    r.nombre_ruta,
                    r.estado,
                    r.fecha_salida,
                    r.id_chofer,
                    u.nombre_completo as chofer_nombre,
                    (SELECT COUNT(*) FROM presupuestos p WHERE p.id_ruta = r.id) +
                    (SELECT COUNT(*) FROM ordenes_tratamiento t WHERE t.id_ruta = r.id) +
                    (SELECT COUNT(*) FROM public.factura_pagos_efectivo s WHERE s.id_ruta = r.id) +
                    (SELECT COUNT(*) FROM public.bunker_prospectos pr WHERE pr.id_ruta = r.id AND pr.activo = true) as total_paradas
                FROM public.rutas r
                LEFT JOIN public.usuarios u ON u.id = r.id_chofer
                WHERE r.estado IN ('ARMANDO', 'EN_CAMINO')
                ORDER BY 
                    CASE WHEN r.estado = 'ARMANDO' THEN 1 ELSE 2 END ASC,
                    r.id DESC
            `);
            const choferesRes = await pool.query(`
                SELECT id, nombre_completo, usuario
                FROM public.usuarios
                WHERE activo = true
                ORDER BY id ASC
            `);
            return res.json({
                success: true,
                rutas: rutasRes.rows,
                choferes: choferesRes.rows
            });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en obtenerRutasDisponibles:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/enviar-a-ruta
     * Asigna uno o varios prospectos al Pool de Logística, a una Hoja de Ruta existente o crea una Hoja de Ruta nueva.
     */
    static async enviarAHojaDeRuta(req, res) {
        const { pool } = require('../config/database');
        const client = await pool.connect();
        try {
            const { ids_prospectos, id_ruta, crear_nueva_ruta, solo_pool, nombre_ruta, id_chofer } = req.body || {};
            if (!Array.isArray(ids_prospectos) || ids_prospectos.length === 0) {
                return res.status(400).json({ success: false, error: 'Seleccioná al menos un comercio para enviar a Logística / Hoja de Ruta.' });
            }

            const cleanIds = ids_prospectos.map(id => parseInt(String(id).replace('PR-', ''), 10)).filter(n => !isNaN(n));
            if (cleanIds.length === 0) {
                return res.status(400).json({ success: false, error: 'IDs de prospectos inválidos.' });
            }

            await client.query('BEGIN');

            if (solo_pool) {
                await client.query(`
                    UPDATE public.bunker_prospectos
                    SET en_pool_logistica = true,
                        id_ruta = NULL,
                        estado_ruta = 'PENDIENTE',
                        updated_at = NOW()
                    WHERE id = ANY($1::int[])
                `, [cleanIds]);

                await client.query('COMMIT');
                return res.json({
                    success: true,
                    message: `${cleanIds.length} contacto(s) enviado(s) manualmente al Pool de Logística para ser asignados a una ruta.`,
                    data: {
                        solo_pool: true,
                        id_ruta: null,
                        nombre_ruta: 'Pool de Logística',
                        cantidad: cleanIds.length
                    }
                });
            }

            let targetRutaId = id_ruta ? parseInt(id_ruta, 10) : null;
            let targetNombreRuta = '';

            if (crear_nueva_ruta || !targetRutaId) {
                let choferIdFinal = id_chofer ? parseInt(id_chofer, 10) : null;
                if (!choferIdFinal) {
                    const chRes = await client.query(`SELECT id FROM public.usuarios WHERE activo = true ORDER BY id ASC LIMIT 1`);
                    choferIdFinal = chRes.rows[0]?.id || 1;
                }
                const fechaHoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                const nombreFinal = (nombre_ruta && nombre_ruta.trim())
                    ? nombre_ruta.trim()
                    : `Preventa / Reparto (${fechaHoy})`;

                const nuevaRutaRes = await client.query(`
                    INSERT INTO public.rutas (
                        nombre_ruta,
                        fecha_salida,
                        id_chofer,
                        estado,
                        usuario_creador_id,
                        fecha_creacion
                    ) VALUES ($1, NOW(), $2, 'ARMANDO', $2, NOW())
                    RETURNING id, nombre_ruta
                `, [nombreFinal, choferIdFinal]);

                targetRutaId = nuevaRutaRes.rows[0].id;
                targetNombreRuta = nuevaRutaRes.rows[0].nombre_ruta;
            } else {
                const checkR = await client.query(`SELECT id, nombre_ruta FROM public.rutas WHERE id = $1`, [targetRutaId]);
                if (checkR.rows.length === 0) {
                    throw new Error('La Hoja de Ruta seleccionada no existe.');
                }
                targetNombreRuta = checkR.rows[0].nombre_ruta;
            }

            // Obtener el máximo orden_entrega actual en la ruta para encolar al final
            const maxOrdenRes = await client.query(`
                SELECT GREATEST(
                    COALESCE((SELECT MAX(orden_entrega) FROM public.presupuestos WHERE id_ruta = $1 AND orden_entrega < 900), 0),
                    COALESCE((SELECT MAX(orden_entrega) FROM public.ordenes_tratamiento WHERE id_ruta = $1 AND orden_entrega < 900), 0),
                    COALESCE((SELECT MAX(orden_entrega) FROM public.factura_pagos_efectivo WHERE id_ruta = $1 AND orden_entrega < 900), 0),
                    COALESCE((SELECT MAX(orden_entrega) FROM public.bunker_prospectos WHERE id_ruta = $1 AND orden_entrega < 900), 0)
                ) as max_orden
            `, [targetRutaId]);

            let nextOrden = (parseInt(maxOrdenRes.rows[0]?.max_orden, 10) || 0) + 1;

            for (const pid of cleanIds) {
                await client.query(`
                    UPDATE public.bunker_prospectos
                    SET id_ruta = $1,
                        en_pool_logistica = true,
                        estado_ruta = 'PENDIENTE',
                        orden_entrega = $2,
                        updated_at = NOW()
                    WHERE id = $3
                `, [targetRutaId, nextOrden++, pid]);
            }

            await client.query('COMMIT');

            return res.json({
                success: true,
                message: `${cleanIds.length} visita(s) comercial(es) incorporada(s) a la Hoja de Ruta "${targetNombreRuta}".`,
                data: {
                    id_ruta: targetRutaId,
                    nombre_ruta: targetNombreRuta,
                    cantidad: cleanIds.length
                }
            });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en enviarAHojaDeRuta:', e);
            return res.status(500).json({ success: false, error: e.message });
        } finally {
            client.release();
        }
    }

    /**
     * PATCH /api/logistica/prospectos/:id/pool-logistica
     * Permite a un operador enviar o retirar manualmente un contacto del Pool de Logística.
     */
    static async cambiarPoolLogistica(req, res) {
        try {
            const { id } = req.params;
            const cleanId = parseInt(String(id).replace('PR-', ''), 10);
            const { en_pool_logistica } = req.body || {};
            const actualizado = await ProspectosModel.cambiarPoolLogistica(cleanId, Boolean(en_pool_logistica));
            if (!actualizado) {
                return res.status(404).json({ success: false, error: 'Contacto no encontrado.' });
            }
            return res.json({
                success: true,
                message: Boolean(en_pool_logistica)
                    ? `Contacto "${actualizado.nombre_fantasia}" enviado al Pool de Logística.`
                    : `Contacto "${actualizado.nombre_fantasia}" retirado del Pool de Logística.`,
                data: actualizado
            });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en cambiarPoolLogistica:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/visita-cliente-activo
     * Envía o retira un Cliente Activo (sin pedido previo) al Pool de Logística o Hoja de Ruta como Visita de Contacto/Servicio.
     */
    static async gestionarVisitaClienteActivo(req, res) {
        const { pool } = require('../config/database');
        const client = await pool.connect();
        try {
            const {
                id_cliente,
                id_domicilio,
                cliente_nombre,
                alias,
                direccion,
                localidad,
                latitud,
                longitud,
                telefono_contacto,
                notas,
                accion = 'ENVIAR_POOL',
                id_ruta,
                crear_nueva_ruta,
                nombre_ruta,
                id_chofer
            } = req.body || {};

            const nombreFinal = String(cliente_nombre || alias || '').trim();
            if (!nombreFinal && accion !== 'QUITAR_POOL') {
                return res.status(400).json({ success: false, error: 'El nombre del cliente es obligatorio.' });
            }

            const cliIdNum = id_cliente ? parseInt(id_cliente, 10) : null;
            const domIdNum = id_domicilio ? parseInt(id_domicilio, 10) : null;

            await client.query('BEGIN');

            const existRes = await client.query(`
                SELECT *
                FROM public.bunker_prospectos
                WHERE activo = true
                  AND origen_contacto = 'CLIENTE_ACTIVO'
                  AND (
                    ($1::int IS NOT NULL AND cliente_domicilio_id = $1::int)
                    OR ($2::int IS NOT NULL AND cliente_activo_id = $2::int)
                    OR ($3::text <> '' AND LOWER(TRIM(nombre_fantasia)) = LOWER(TRIM($3::text)))
                  )
                ORDER BY id DESC
                LIMIT 1
                FOR UPDATE
            `, [domIdNum, cliIdNum, nombreFinal]);

            let registro = existRes.rows[0] || null;

            if (accion === 'QUITAR_POOL') {
                if (!registro) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ success: false, error: 'No se encontró visita activa en el Pool para este cliente.' });
                }
                const updQuit = await client.query(`
                    UPDATE public.bunker_prospectos
                    SET en_pool_logistica = false,
                        id_ruta = NULL,
                        orden_entrega = 999,
                        estado_ruta = 'PENDIENTE',
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                `, [registro.id]);
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    message: `Visita al cliente "${registro.nombre_fantasia}" retirada del Pool de Logística.`,
                    data: updQuit.rows[0]
                });
            }

            const notaFinal = (notas && String(notas).trim())
                ? String(notas).trim()
                : (registro?.notas || '⭐ Visita comercial / servicio a Cliente Activo (sin pedido previo)');

            if (!registro) {
                const codigo = await ProspectosModel.generarSiguienteCodigo();
                const insRes = await client.query(`
                    INSERT INTO public.bunker_prospectos (
                        codigo_prospecto, origen_contacto, nombre_fantasia, rubro,
                        direccion, localidad, zona, latitud, longitud,
                        contacto_nombre, contacto_rol, telefono_whatsapp,
                        estado, notas, creado_por,
                        en_pool_logistica, estado_ruta,
                        cliente_activo_id, cliente_domicilio_id
                    ) VALUES (
                        $1, 'CLIENTE_ACTIVO', $2, '⭐ Cliente Activo',
                        $3, $4, $5, $6, $7,
                        $8, 'CLIENTE', $9,
                        'VISITA_AGENDADA', $10, 'operador_mapa',
                        true, 'PENDIENTE',
                        $11, $12
                    ) RETURNING *
                `, [
                    codigo,
                    nombreFinal,
                    direccion || 'Domicilio Cliente',
                    localidad || 'La Plata',
                    localidad || 'La Plata Centro',
                    latitud ? parseFloat(latitud) : null,
                    longitud ? parseFloat(longitud) : null,
                    alias || 'Cliente Activo',
                    telefono_contacto || null,
                    notaFinal,
                    cliIdNum,
                    domIdNum
                ]);
                registro = insRes.rows[0];
            } else {
                const updPool = await client.query(`
                    UPDATE public.bunker_prospectos
                    SET en_pool_logistica = true,
                        estado = 'VISITA_AGENDADA',
                        estado_ruta = 'PENDIENTE',
                        id_ruta = CASE WHEN $1 = 'ENVIAR_POOL' THEN NULL ELSE id_ruta END,
                        notas = $2,
                        direccion = COALESCE($3, direccion),
                        localidad = COALESCE($4, localidad),
                        latitud = COALESCE($5, latitud),
                        longitud = COALESCE($6, longitud),
                        telefono_whatsapp = COALESCE($7, telefono_whatsapp),
                        cliente_activo_id = COALESCE($8, cliente_activo_id),
                        cliente_domicilio_id = COALESCE($9, cliente_domicilio_id),
                        updated_at = NOW()
                    WHERE id = $10
                    RETURNING *
                `, [
                    accion,
                    notaFinal,
                    direccion || null,
                    localidad || null,
                    latitud ? parseFloat(latitud) : null,
                    longitud ? parseFloat(longitud) : null,
                    telefono_contacto || null,
                    cliIdNum,
                    domIdNum,
                    registro.id
                ]);
                registro = updPool.rows[0];
            }

            if (accion === 'ASIGNAR_RUTA') {
                let targetRutaId = id_ruta ? parseInt(id_ruta, 10) : null;
                let targetNombreRuta = '';

                if (crear_nueva_ruta || !targetRutaId) {
                    let choferIdFinal = id_chofer ? parseInt(id_chofer, 10) : null;
                    if (!choferIdFinal) {
                        const chRes = await client.query(`SELECT id FROM public.usuarios WHERE activo = true ORDER BY id ASC LIMIT 1`);
                        choferIdFinal = chRes.rows[0]?.id || 1;
                    }
                    const fechaHoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                    const nombreR = (nombre_ruta && nombre_ruta.trim())
                        ? nombre_ruta.trim()
                        : `Preventa / Reparto (${fechaHoy})`;

                    const nuevaRutaRes = await client.query(`
                        INSERT INTO public.rutas (
                            nombre_ruta, fecha_salida, id_chofer, estado, usuario_creador_id, fecha_creacion
                        ) VALUES ($1, NOW(), $2, 'ARMANDO', $2, NOW())
                        RETURNING id, nombre_ruta
                    `, [nombreR, choferIdFinal]);
                    targetRutaId = nuevaRutaRes.rows[0].id;
                    targetNombreRuta = nuevaRutaRes.rows[0].nombre_ruta;
                } else {
                    const checkR = await client.query(`SELECT id, nombre_ruta FROM public.rutas WHERE id = $1`, [targetRutaId]);
                    if (checkR.rows.length === 0) {
                        throw new Error('La Hoja de Ruta seleccionada no existe.');
                    }
                    targetNombreRuta = checkR.rows[0].nombre_ruta;
                }

                const maxOrdenRes = await client.query(`
                    SELECT GREATEST(
                        COALESCE((SELECT MAX(orden_entrega) FROM public.presupuestos WHERE id_ruta = $1 AND orden_entrega < 900), 0),
                        COALESCE((SELECT MAX(orden_entrega) FROM public.ordenes_tratamiento WHERE id_ruta = $1 AND orden_entrega < 900), 0),
                        COALESCE((SELECT MAX(orden_entrega) FROM public.factura_pagos_efectivo WHERE id_ruta = $1 AND orden_entrega < 900), 0),
                        COALESCE((SELECT MAX(orden_entrega) FROM public.bunker_prospectos WHERE id_ruta = $1 AND orden_entrega < 900), 0)
                    ) as max_orden
                `, [targetRutaId]);
                const nextOrden = (parseInt(maxOrdenRes.rows[0]?.max_orden, 10) || 0) + 1;

                const updRuta = await client.query(`
                    UPDATE public.bunker_prospectos
                    SET id_ruta = $1,
                        en_pool_logistica = true,
                        estado_ruta = 'PENDIENTE',
                        orden_entrega = $2,
                        updated_at = NOW()
                    WHERE id = $3
                    RETURNING *
                `, [targetRutaId, nextOrden, registro.id]);
                registro = updRuta.rows[0];

                await client.query('COMMIT');
                return res.json({
                    success: true,
                    message: `Visita al cliente "${registro.nombre_fantasia}" asignada a la Hoja de Ruta "${targetNombreRuta}".`,
                    data: registro,
                    ruta: { id: targetRutaId, nombre_ruta: targetNombreRuta }
                });
            }

            await client.query('COMMIT');
            return res.json({
                success: true,
                message: `Cliente "${registro.nombre_fantasia}" enviado al Pool de Logística como Visita de Contacto (sin pedido).`,
                data: registro
            });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en gestionarVisitaClienteActivo:', e);
            return res.status(500).json({ success: false, error: e.message });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/logistica/prospectos/:id/visita-ruta
     * Registra el resultado de la visita comercial desde la misma Hoja de Ruta en calle.
     */
    static async registrarVisitaEnRuta(req, res) {
        try {
            const { id } = req.params;
            const {
                contacto_nombre,
                contacto_rol,
                telefono_whatsapp,
                email,
                notas,
                estado,
                fecha_revisita,
                lista_id,
                enviar_catalogo_whatsapp,
                no_concretada,
                motivo_no_concretada
            } = req.body || {};

            const prospecto = await ProspectosModel.obtenerPorId(id);
            if (!prospecto) {
                return res.status(404).json({ success: false, error: 'Comercio no encontrado.' });
            }

            const { pool } = require('../config/database');

            const esNoConcretada = Boolean(no_concretada);
            const motivoNoConcretadaLimpio = (motivo_no_concretada || 'No encontré físicamente el local').trim();
            const fechaHoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

            const nuevoContacto = contacto_nombre !== undefined ? (contacto_nombre.trim() || prospecto.contacto_nombre) : prospecto.contacto_nombre;
            const nuevoRol = contacto_rol !== undefined ? (contacto_rol.trim().toUpperCase() || prospecto.contacto_rol) : prospecto.contacto_rol;
            const nuevoTel = telefono_whatsapp !== undefined ? (telefono_whatsapp.trim() || prospecto.telefono_whatsapp) : prospecto.telefono_whatsapp;
            const nuevoEmail = email !== undefined ? (email.trim() || prospecto.email) : prospecto.email;

            let nuevasNotas = notas !== undefined ? (notas.trim() || prospecto.notas) : prospecto.notas;
            if (esNoConcretada) {
                const prefijoNota = `[Visita en Ruta ${fechaHoyStr} - No concretada: ${motivoNoConcretadaLimpio}]`;
                const notaExtra = notas ? notas.trim() : '';
                const basePrev = (prospecto.notas || '').trim();
                nuevasNotas = [prefijoNota, notaExtra, basePrev].filter(Boolean).join(' | ');
            }

            let nuevoEstado;
            if (esNoConcretada) {
                const motLower = motivoNoConcretadaLimpio.toLowerCase();
                if (estado) {
                    nuevoEstado = estado;
                } else if (motLower.includes('no encontr') || motLower.includes('inexistente') || motLower.includes('no existe')) {
                    nuevoEstado = 'DESCARTADO';
                } else {
                    nuevoEstado = prospecto.estado || 'IDENTIFICADO';
                }
            } else {
                nuevoEstado = estado || (enviar_catalogo_whatsapp ? 'LISTA_ENVIADA' : (fecha_revisita ? 'VISITA_AGENDADA' : 'CONTACTO_INICIAL'));
            }

            const nuevaFechaRev = fecha_revisita ? new Date(fecha_revisita) : prospecto.fecha_revisita;
            const nuevaLista = lista_id ? parseInt(lista_id, 10) : (prospecto.lista_precios_sugerida_id || 5);
            const nuevoEstadoRuta = esNoConcretada ? 'NO_ENCONTRADO' : 'VISITADO';

            const updateRes = await pool.query(`
                UPDATE public.bunker_prospectos
                SET contacto_nombre = $1,
                    contacto_rol = $2,
                    telefono_whatsapp = $3,
                    email = $4,
                    notas = $5,
                    estado = $6,
                    fecha_revisita = $7,
                    lista_precios_sugerida_id = $8,
                    estado_ruta = $9,
                    en_pool_logistica = false,
                    fecha_visita_ruta = NOW(),
                    updated_at = NOW()
                WHERE id = $10
                RETURNING *
            `, [
                nuevoContacto,
                nuevoRol,
                nuevoTel,
                nuevoEmail,
                nuevasNotas,
                nuevoEstado,
                nuevaFechaRev,
                nuevaLista,
                nuevoEstadoRuta,
                id
            ]);

            if (prospecto.id_ruta) {
                await pool.query(`
                    UPDATE public.rutas
                    SET estado = 'EN_CAMINO',
                        fecha_salida = COALESCE(fecha_salida, NOW())
                    WHERE id = $1 AND estado = 'ARMANDO'
                `, [prospecto.id_ruta]).catch(() => {});
            }

            let whatsappEnviado = false;
            let whatsappError = null;

            if (!esNoConcretada && enviar_catalogo_whatsapp && nuevoTel && String(nuevoTel).replace(/\D/g, '').length >= 8) {
                try {
                    const BunkerController = require('./bunkerController');
                    const pdfParams = {
                        lista_id: nuevaLista,
                        cliente_nombre: prospecto.nombre_fantasia || 'Cliente',
                        titulo_informe: 'Lista de Precios y Catálogo',
                        modo_iva: 'con_iva',
                        modo_precio: 'ambos',
                        agrupar_por_atributo: 'todos',
                        mostrar_hijos: true,
                        ocultar_columna_iva: false,
                        destacar_ofertas: true,
                        mostrar_composicion_mixes: true,
                        bonificacion_volumen: true
                    };
                    const { buffer, filename } = await BunkerController.generarPDFCotizacionBuffer(pdfParams, pool);
                    const saludo = nuevoContacto ? `Hola *${nuevoContacto}*` : `Hola *${prospecto.nombre_fantasia}*`;
                    const textoFinal = `${saludo}, recién pasamos a saludarlos por el local. Te dejamos adjunta nuestra lista de precios mayorista oficial de *LAMDA*. Quedamos a total disposición por cualquier consulta. ¡Muchas gracias!`;

                    const wpResponse = await fetch('http://127.0.0.1:3004/facturacion/whatsapp/enviar-documento', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            destinatarios: nuevoTel,
                            pdfBase64: buffer.toString('base64'),
                            filename: filename || `Lista_Precios_LAMDA.pdf`,
                            mensajeTexto: textoFinal
                        })
                    });
                    const wpJson = await wpResponse.json().catch(() => ({}));
                    if (wpResponse.ok && wpJson.success) {
                        whatsappEnviado = true;
                    } else {
                        whatsappError = wpJson.error || wpJson.message || 'No se pudo enviar el PDF por WhatsApp';
                    }
                } catch (errWa) {
                    whatsappError = errWa.message;
                }
            }

            return res.json({
                success: true,
                message: 'Visita registrada en la Hoja de Ruta.',
                whatsapp_enviado: whatsappEnviado,
                whatsapp_error: whatsappError,
                data: updateRes.rows[0]
            });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en registrarVisitaEnRuta:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/buscar-web
     * Búsqueda focalizada en vivo en Internet (OpenStreetMap Overpass + Nominatim) por Rubro/Característica + Zona.
     */
    static async buscarEnWebPorRubro(req, res) {
        try {
            const { categoria, zona, query_libre } = req.body || {};
            const { pool } = require('../config/database');

            // 1. Definir bounding boxes geográficos de las zonas de influencia de LAMDA (Gran La Plata)
            // Formato Overpass: (south, west, north, east)
            const ZONAS_BBOX = {
                'Berisso': { bbox: '-34.925,-57.920,-34.855,-57.840', localidad: 'Berisso', zona: 'Berisso' },
                'Ensenada': { bbox: '-34.885,-57.960,-34.820,-57.885', localidad: 'Ensenada', zona: 'Ensenada' },
                'La Plata Centro': { bbox: '-34.945,-57.985,-34.895,-57.920', localidad: 'La Plata', zona: 'La Plata Centro' },
                'Los Hornos': { bbox: '-34.995,-58.020,-34.940,-57.950', localidad: 'Los Hornos', zona: 'Los Hornos' },
                'Tolosa / Ringuelet': { bbox: '-34.910,-58.005,-34.875,-57.945', localidad: 'Tolosa', zona: 'Tolosa / Ringuelet' },
                'Gonnet / City Bell': { bbox: '-34.900,-58.075,-34.840,-57.990', localidad: 'City Bell', zona: 'Gonnet / City Bell' },
                'Gran La Plata': { bbox: '-34.990,-58.070,-34.830,-57.840', localidad: 'La Plata', zona: 'La Plata Centro' }
            };

            const zonaConfig = ZONAS_BBOX[zona] || ZONAS_BBOX['La Plata Centro'];
            const bbox = zonaConfig.bbox;

            // 2. Mapear la característica / rubro pedido a filtros Overpass OSM y perfilamiento comercial LAMDA
            const CATEGORIAS_OSM = {
                'fiambreria': {
                    rubroLamda: 'Fiambrería, Autoservicio',
                    filtros: [
                        `nwr["shop"~"deli|cheese|Charcuterie|butcher|convenience"](${bbox});`,
                        `nwr["name"~"Fiambrer|Queser|Almac|Mercadito",i](${bbox});`
                    ],
                    estrategia: 'Fiambrería / Almacén: Ofrecer maní tostado/salado, mix salado para picadas, nueces, almendras y línea fraccionada lista para exhibir.'
                },
                'dietetica': {
                    rubroLamda: 'Dietética',
                    filtros: [
                        `nwr["shop"~"health_food|organic|herbalist|spices|nuts"](${bbox});`,
                        `nwr["name"~"Diet[eé]tica|Natural|Saludable|Almac[eé]n Natural",i](${bbox});`
                    ],
                    estrategia: 'Dietética / Natural: Ofrecer carros a granel (5kg), mixes exclusivos LAMDA, granolas crocantes, barritas y frutos secos seleccionados.'
                },
                'panaderia': {
                    rubroLamda: 'Panadería / Productor',
                    filtros: [
                        `nwr["shop"~"bakery|pastry|confectionery"](${bbox});`,
                        `nwr["craft"="bakery"](${bbox});`
                    ],
                    estrategia: 'CLIENTE PRODUCTOR (Panificados / Confitería): Ofrecer cajas cerradas / bulto de nuez mariposa, almendra, pasas de uva, semillas, avena y maní.'
                },
                'heladeria': {
                    rubroLamda: 'Heladería / Productor',
                    filtros: [
                        `nwr["amenity"="ice_cream"](${bbox});`,
                        `nwr["shop"="ice_cream"](${bbox});`,
                        `nwr["name"~"Helader[ií]a|Gelato|Thionis|Vippino|Mepiache",i](${bbox});`
                    ],
                    estrategia: 'CLIENTE PRODUCTOR (Heladería): Ofrecer bulto cerrado de pistacho pelado, nuez, almendra tostada, avellana, maní crocante y pastas.'
                },
                'supermercado': {
                    rubroLamda: 'Autoservicio, Supermercado',
                    filtros: [
                        `nwr["shop"~"supermarket|convenience|grocery"](${bbox});`
                    ],
                    estrategia: 'Autoservicio / Supermercado: Ofrecer línea fraccionada con código de barras (150g a 1kg), mixes en packs x 10 unidades y barritas en exhibidor.'
                },
                'verduleria': {
                    rubroLamda: 'Verdulería',
                    filtros: [
                        `nwr["shop"~"greengrocer|farm"](${bbox});`,
                        `nwr["name"~"Verduler[ií]a|Fruter[ií]a|Huerta|Boutique",i](${bbox});`
                    ],
                    estrategia: 'Verdulería / Frutería: Ofrecer bolsitas fraccionadas listas para colgar o exhibir en mostrador (mixes, nueces, almendras, pasas y ciruelas).'
                },
                'gastronomia': {
                    rubroLamda: 'Gastronomía',
                    filtros: [
                        `nwr["amenity"~"restaurant|cafe|pub|bar"](${bbox});`,
                        `nwr["shop"="pasta"](${bbox});`
                    ],
                    estrategia: 'Gastronomía / Fábrica de Pastas / Restó: Ofrecer insumos por kilo y bulto cerrado (nuez para rellenos/salsas, almendra, maní, semillas y frutos secos).'
                }
            };

            const catKey = (categoria || 'fiambreria').toLowerCase();
            const catConfig = CATEGORIAS_OSM[catKey] || CATEGORIAS_OSM['fiambreria'];

            let overpassUnion = catConfig.filtros.join('\n');
            if (query_libre && query_libre.trim()) {
                const safeQ = query_libre.trim().replace(/["\\]/g, '');
                overpassUnion = `nwr["name"~"${safeQ}",i](${bbox});`;
            }

            const overpassQuery = `[out:json][timeout:18];(\n${overpassUnion}\n);out center 45;`;

            let elementos = [];
            try {
                const ovRes = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'data=' + encodeURIComponent(overpassQuery)
                });
                if (ovRes.ok) {
                    const ovJson = await ovRes.json();
                    elementos = Array.isArray(ovJson.elements) ? ovJson.elements : [];
                }
            } catch (errOv) {
                console.warn('[PROSPECTOS-WEB] Overpass primario demorado, intentando mirror...', errOv.message);
            }

            // Fallback a Nominatim si Overpass no devolvió resultados o estuvo saturado
            if (elementos.length === 0) {
                const terminoNom = query_libre?.trim() || catKey;
                const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=25&q=${encodeURIComponent(terminoNom + ' ' + zonaConfig.localidad + ' Buenos Aires Argentina')}`;
                const nomRes = await fetch(nomUrl, { headers: { 'User-Agent': 'LAMDA-Logistica-CRM/1.0' } });
                if (nomRes.ok) {
                    const nomArr = await nomRes.json();
                    elementos = (nomArr || []).map(item => ({
                        id: item.osm_id,
                        lat: parseFloat(item.lat),
                        lon: parseFloat(item.lon),
                        tags: {
                            name: item.name || (item.display_name ? item.display_name.split(',')[0] : ''),
                            'addr:street': item.address?.road || '',
                            'addr:housenumber': item.address?.house_number || '',
                            'addr:city': item.address?.city || item.address?.town || item.address?.suburb || zonaConfig.localidad,
                            ...(item.extratags || {})
                        }
                    }));
                }
            }

            // 3. Cruzar con los prospectos ya cargados en bunker_prospectos para no duplicar
            const existentesRes = await pool.query(`
                SELECT LOWER(TRIM(nombre_fantasia)) as nombre, latitud, longitud
                FROM public.bunker_prospectos
                WHERE activo = true
            `);
            const nombresExistentes = new Set(existentesRes.rows.map(r => r.nombre));

            const candidatos = [];
            const vistosEnBusqueda = new Set();

            for (const el of elementos) {
                const tags = el.tags || {};
                const nombre = (tags.name || tags.brand || '').trim();
                if (!nombre || nombre.length < 2) continue;

                const nombreKey = nombre.toLowerCase();
                if (vistosEnBusqueda.has(nombreKey)) continue;
                vistosEnBusqueda.add(nombreKey);

                const lat = el.lat || el.center?.lat || null;
                const lon = el.lon || el.center?.lon || null;
                if (!lat || !lon) continue;

                const calle = tags['addr:street'] || '';
                const altura = tags['addr:housenumber'] || '';
                const dirArmada = [calle, altura].filter(Boolean).join(' ') || `Zona ${zonaConfig.zona} (ubicación GPS en mapa)`;
                const telefono = tags['contact:whatsapp'] || tags['contact:phone'] || tags.phone || tags['phone:mobile'] || '';
                const web = tags['contact:instagram'] || tags['contact:website'] || tags.website || tags['contact:facebook'] || '';
                const horarios = tags.opening_hours ? `Horario ref: ${tags.opening_hours}. ` : '';

                const yaExiste = nombresExistentes.has(nombreKey);

                candidatos.push({
                    osm_id: el.id,
                    nombre_fantasia: nombre,
                    rubro: catConfig.rubroLamda,
                    direccion: dirArmada,
                    localidad: tags['addr:city'] || zonaConfig.localidad,
                    zona: zonaConfig.zona,
                    latitud: parseFloat(lat.toFixed(6)),
                    longitud: parseFloat(lon.toFixed(6)),
                    telefono_whatsapp: telefono,
                    web_redes: web,
                    notas: `${horarios}${catConfig.estrategia}`,
                    ya_cargado: yaExiste
                });
            }

            return res.json({
                success: true,
                categoria: catConfig.rubroLamda,
                zona: zonaConfig.zona,
                total: candidatos.length,
                data: candidatos
            });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en buscarEnWebPorRubro:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/importar-web
     * Importa comercios seleccionados del buscador web hacia bunker_prospectos y opcionalmente los suma a una Hoja de Ruta.
     */
    static async importarDesdeWeb(req, res) {
        try {
            const { comercios, id_ruta } = req.body || {};
            if (!Array.isArray(comercios) || comercios.length === 0) {
                return res.status(400).json({ success: false, error: 'No se recibieron comercios para importar.' });
            }

            const creados = [];
            for (const item of comercios) {
                if (!item.nombre_fantasia) continue;
                const nuevo = await ProspectosModel.crear({
                    origen_contacto: 'RADAR_WEB',
                    nombre_fantasia: item.nombre_fantasia,
                    rubro: item.rubro || 'Comercio',
                    direccion: item.direccion || null,
                    localidad: item.localidad || 'La Plata',
                    zona: item.zona || 'La Plata Centro',
                    latitud: item.latitud || null,
                    longitud: item.longitud || null,
                    telefono_whatsapp: item.telefono_whatsapp || null,
                    web_redes: item.web_redes || null,
                    estado: 'POR_VISITAR',
                    notas: item.notas || null,
                    lista_precios_sugerida_id: 5,
                    creado_por: 'buscador_web'
                });
                creados.push(nuevo);
            }

            if (id_ruta && creados.length > 0) {
                const { pool } = require('../config/database');
                const idsCreados = creados.map(c => c.id);
                await pool.query(`
                    UPDATE public.bunker_prospectos
                    SET id_ruta = $1, estado_ruta = 'PENDIENTE', updated_at = NOW()
                    WHERE id = ANY($2::int[])
                `, [parseInt(id_ruta, 10), idsCreados]);
            }

            return res.json({
                success: true,
                message: `${creados.length} comercio(s) incorporado(s) exitosamente.`,
                data: creados
            });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en importarDesdeWeb:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * GET /api/logistica/prospectos/config-rutas-dias
     * Devuelve los nodos fijos (Casa, Depósito), las Rutas/Zonas lineales y el cronograma de 7 días (Mañana/Tarde)
     */
    static async obtenerConfiguracionRutasDias(req, res) {
        try {
            const config = await ProspectosModel.obtenerConfiguracionRutasDias();
            return res.json({ success: true, data: config });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en obtenerConfiguracionRutasDias:', e);
            return res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/nodos
     * Crea o actualiza un nodo de cabecera (ej: Mi Casa, Depósito LAMDA u otro punto)
     */
    static async guardarNodo(req, res) {
        try {
            const nodo = await ProspectosModel.guardarNodo(req.body || {});
            const config = await ProspectosModel.obtenerConfiguracionRutasDias();
            return res.json({ success: true, data: nodo, config });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en guardarNodo:', e);
            return res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * DELETE /api/logistica/prospectos/nodos/:id
     */
    static async eliminarNodo(req, res) {
        try {
            await ProspectosModel.eliminarNodo(parseInt(req.params.id, 10));
            const config = await ProspectosModel.obtenerConfiguracionRutasDias();
            return res.json({ success: true, config });
        } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/rutas-zona
     * Crea o actualiza un corredor lineal Ruta/Zona y opcionalmente sus días/turnos asignados
     */
    static async guardarRutaZona(req, res) {
        try {
            const rutaZona = await ProspectosModel.guardarRutaZona(req.body || {});
            const config = await ProspectosModel.obtenerConfiguracionRutasDias();
            return res.json({ success: true, data: rutaZona, config });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en guardarRutaZona:', e);
            return res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * DELETE /api/logistica/prospectos/rutas-zona/:id
     */
    static async eliminarRutaZona(req, res) {
        try {
            await ProspectosModel.eliminarRutaZona(parseInt(req.params.id, 10));
            const config = await ProspectosModel.obtenerConfiguracionRutasDias();
            return res.json({ success: true, config });
        } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * POST /api/logistica/prospectos/cronograma
     * Actualiza las Rutas/Zonas asignadas a un bloque (dia_semana 1..7 + turno MANANA/TARDE)
     */
    static async actualizarCronogramaBloque(req, res) {
        try {
            const config = await ProspectosModel.actualizarCronogramaBloque(req.body || {});
            return res.json({ success: true, data: config });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en actualizarCronogramaBloque:', e);
            return res.status(400).json({ success: false, error: e.message });
        }
    }

    /**
     * PATCH /api/logistica/prospectos/:id/rutas-zona
     * Vincula un contacto a una o más Rutas/Zonas lineales y/o días-turnos puntuales
     */
    static async vincularRutasZonaProspecto(req, res) {
        try {
            const actualizado = await ProspectosModel.vincularRutasZona(parseInt(req.params.id, 10), req.body || {});
            return res.json({ success: true, data: actualizado });
        } catch (e) {
            console.error('❌ [PROSPECTOS-CONTROLLER] Error en vincularRutasZonaProspecto:', e);
            return res.status(400).json({ success: false, error: e.message });
        }
    }
}

module.exports = ProspectosController;
