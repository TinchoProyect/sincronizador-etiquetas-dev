const { pool } = require('../config/database');
const { obtenerClienteUnificado, resolverDestinatariosAlertaEntrega } = require('./clienteResolver');

/**
 * Obtiene la lista unificada de clientes pertenecientes a una hoja de ruta,
 * identificando pedidos, órdenes de tratamiento (retiros) y sus números de WhatsApp resueltos.
 * 
 * @param {number|string} rutaId - ID de la ruta
 * @returns {Promise<Array<Object>>} Lista de clientes con metadatos y destinatarios
 */
async function obtenerDestinatariosInicioRuta(rutaId) {
    try {
        const idNum = parseInt(rutaId, 10);
        if (isNaN(idNum)) {
            throw new Error(`ID de ruta inválido: ${rutaId}`);
        }

        // 1. Obtener todos los pedidos asignados a la ruta
        const resPedidos = await pool.query(`
            SELECT 
                p.id, 
                p.id_cliente, 
                p.orden_entrega,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                cd.direccion as domicilio_direccion,
                cd.localidad as domicilio_localidad
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON ltrim(p.id_cliente::text, '0') = c.cliente_id::text
            LEFT JOIN public.clientes_domicilios cd ON p.id_domicilio_entrega = cd.id
            WHERE p.id_ruta = $1
            ORDER BY p.orden_entrega ASC NULLS LAST, p.id ASC
        `, [idNum]);

        // 2. Obtener todas las órdenes de tratamiento (retiros) asignadas a la ruta
        const resRetiros = await pool.query(`
            SELECT 
                ot.id, 
                ot.id_cliente, 
                ot.orden_entrega,
                COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin nombre') as cliente_nombre,
                cd.direccion as domicilio_direccion,
                cd.localidad as domicilio_localidad
            FROM public.ordenes_tratamiento ot
            LEFT JOIN public.clientes c ON ltrim(ot.id_cliente::text, '0') = c.cliente_id::text
            LEFT JOIN public.clientes_domicilios cd ON ot.id_domicilio_entrega = cd.id
            WHERE ot.id_ruta = $1
            ORDER BY ot.orden_entrega ASC NULLS LAST, ot.id ASC
        `, [idNum]);

        // 2b. Obtener todos los sobres de efectivo asignados a la ruta
        const resSobres = await pool.query(`
            SELECT 
                s.id,
                s.codigo_sobre,
                COALESCE(c.cliente_id::text, NULLIF(LTRIM(TRIM(bc.lomas_soft_id), '0'), ''), s.cliente_id) as id_cliente,
                s.orden_entrega,
                COALESCE(c.nombre, bc.cliente_nombre, bc.razon_social, s.cliente_id) as cliente_nombre,
                cd.direccion as domicilio_direccion,
                COALESCE(cd.localidad, c.localidad) as domicilio_localidad
            FROM public.factura_pagos_efectivo s
            LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = s.cliente_id OR bc.lomas_soft_id = s.cliente_id
            LEFT JOIN public.clientes c ON (bc.lomas_soft_id IS NOT NULL AND c.cliente_id::text = ltrim(bc.lomas_soft_id, '0'))
                                        OR (bc.id IS NULL AND c.cliente_id::text = ltrim(s.cliente_id, '0'))
            LEFT JOIN public.clientes_domicilios cd ON cd.id = COALESCE(
                s.id_domicilio_entrega,
                (
                    SELECT cd_sub.id 
                    FROM public.clientes_domicilios cd_sub
                    WHERE (
                        cd_sub.id_cliente = bc.id
                        OR cd_sub.id_cliente = c.id
                        OR cd_sub.id_cliente::text = bc.lomas_soft_id
                        OR cd_sub.id_cliente::text = c.cliente_id::text
                    ) AND cd_sub.activo = true
                    ORDER BY cd_sub.es_predeterminado DESC, cd_sub.fecha_creacion ASC, cd_sub.id ASC
                    LIMIT 1
                )
            )
            WHERE s.id_ruta = $1
            ORDER BY s.orden_entrega ASC NULLS LAST, s.id ASC
        `, [idNum]);

        // 3. Agrupar paradas por cliente único
        const clientesMap = new Map();

        for (const p of resPedidos.rows) {
            const rawCId = String(p.id_cliente || '').trim();
            const cId = rawCId.replace(/^0+/, '') || rawCId;
            if (!cId) continue;
            if (!clientesMap.has(cId)) {
                const dirTexto = [p.domicilio_direccion, p.domicilio_localidad].filter(Boolean).join(', ');
                clientesMap.set(cId, {
                    cliente_id: cId,
                    nombre: p.cliente_nombre,
                    direccion: dirTexto || 'Sin dirección asignada',
                    orden_entrega: p.orden_entrega !== null ? parseInt(p.orden_entrega, 10) : 999,
                    pedidos: [],
                    retiros: [],
                    sobres: []
                });
            }
            const item = clientesMap.get(cId);
            if (!item.pedidos.includes(p.id)) {
                item.pedidos.push(p.id);
            }
            if (p.orden_entrega !== null && p.orden_entrega < item.orden_entrega) {
                item.orden_entrega = p.orden_entrega;
            }
        }

        for (const r of resRetiros.rows) {
            const rawCId = String(r.id_cliente || '').trim();
            const cId = rawCId.replace(/^0+/, '') || rawCId;
            if (!cId) continue;
            if (!clientesMap.has(cId)) {
                const dirTexto = [r.domicilio_direccion, r.domicilio_localidad].filter(Boolean).join(', ');
                clientesMap.set(cId, {
                    cliente_id: cId,
                    nombre: r.cliente_nombre,
                    direccion: dirTexto || 'Sin dirección asignada',
                    orden_entrega: r.orden_entrega !== null ? parseInt(r.orden_entrega, 10) : 999,
                    pedidos: [],
                    retiros: [],
                    sobres: []
                });
            }
            const item = clientesMap.get(cId);
            if (!item.retiros.includes(r.id)) {
                item.retiros.push(r.id);
            }
            if (r.orden_entrega !== null && r.orden_entrega < item.orden_entrega) {
                item.orden_entrega = r.orden_entrega;
            }
        }

        for (const s of resSobres.rows) {
            const rawCId = String(s.id_cliente || '').trim();
            const cId = rawCId.replace(/^0+/, '') || rawCId;
            if (!cId) continue;
            if (!clientesMap.has(cId)) {
                const dirTexto = [s.domicilio_direccion, s.domicilio_localidad].filter(Boolean).join(', ');
                clientesMap.set(cId, {
                    cliente_id: cId,
                    nombre: s.cliente_nombre,
                    direccion: dirTexto || 'Sin dirección asignada',
                    orden_entrega: s.orden_entrega !== null ? parseInt(s.orden_entrega, 10) : 999,
                    pedidos: [],
                    retiros: [],
                    sobres: []
                });
            }
            const item = clientesMap.get(cId);
            if (s.codigo_sobre && !item.sobres.includes(s.codigo_sobre)) {
                item.sobres.push(s.codigo_sobre);
            }
            if (s.orden_entrega !== null && s.orden_entrega < item.orden_entrega) {
                item.orden_entrega = s.orden_entrega;
            }
        }

        // 4. Resolver contactos de WhatsApp para cada cliente
        const clientesLista = [];
        for (const cliente of clientesMap.values()) {
            const clienteUnificado = await obtenerClienteUnificado(pool, cliente.cliente_id);
            const destinatarios = resolverDestinatariosAlertaEntrega(clienteUnificado);

            let tipoParada = 'ENTREGA';
            if (cliente.pedidos.length === 0 && cliente.retiros.length === 0 && cliente.sobres.length > 0) {
                tipoParada = 'SOLO_SOBRE';
            } else if (cliente.pedidos.length > 0 && cliente.retiros.length > 0) {
                tipoParada = 'ENTREGA_Y_RETIRO';
            } else if (cliente.retiros.length > 0) {
                tipoParada = 'SOLO_RETIRO';
            }

            const nombreMostrado = clienteUnificado?.cliente_nombre || cliente.nombre;

            clientesLista.push({
                cliente_id: cliente.cliente_id,
                nombre: nombreMostrado,
                direccion: cliente.direccion,
                orden_entrega: cliente.orden_entrega,
                pedidos: cliente.pedidos,
                retiros: cliente.retiros,
                sobres: cliente.sobres,
                tipo_parada: tipoParada,
                tiene_whatsapp: destinatarios && destinatarios.length > 0,
                destinatarios: (destinatarios || []).map(d => ({
                    numero: d.numero,
                    nombre: d.nombre || 'Contacto',
                    cargo: d.cargo || ''
                }))
            });
        }

        // 4b. Obtener todas las Visitas Comerciales de Preventa (prospectos) asignadas a la ruta
        const resProspectos = await pool.query(`
            SELECT 
                id,
                codigo_prospecto,
                nombre_fantasia,
                rubro,
                direccion,
                localidad,
                zona,
                contacto_nombre,
                contacto_rol,
                telefono_whatsapp,
                email,
                orden_entrega
            FROM public.bunker_prospectos
            WHERE id_ruta = $1 AND activo = true
            ORDER BY orden_entrega ASC NULLS LAST, id ASC
        `, [idNum]);

        for (const pr of resProspectos.rows) {
            const rawTel = String(pr.telefono_whatsapp || '').replace(/\D/g, '');
            const tieneWa = rawTel.length >= 8;
            const tieneEmail = Boolean(pr.email && String(pr.email).includes('@'));
            const dirTexto = [pr.direccion, pr.zona || pr.localidad].filter(Boolean).join(', ');
            const dests = [];
            if (tieneWa) {
                dests.push({
                    numero: pr.telefono_whatsapp,
                    nombre: pr.contacto_nombre || pr.nombre_fantasia,
                    cargo: pr.contacto_rol || 'Contacto'
                });
            }
            clientesLista.push({
                cliente_id: `PR-${pr.id}`,
                prospecto_id: pr.id,
                codigo_prospecto: pr.codigo_prospecto,
                nombre: pr.nombre_fantasia,
                direccion: dirTexto || 'Sin dirección asignada',
                zona: pr.zona || pr.localidad || 'la zona',
                rubro: pr.rubro || 'Comercio',
                orden_entrega: pr.orden_entrega !== null ? parseInt(pr.orden_entrega, 10) : 999,
                pedidos: [],
                retiros: [],
                sobres: [],
                visitas_comerciales: [pr.codigo_prospecto],
                tipo_parada: 'VISITA_COMERCIAL',
                tiene_whatsapp: tieneWa,
                tiene_email: tieneEmail,
                email: pr.email || null,
                destinatarios: dests
            });
        }

        // Ordenar paradas por orden_entrega
        clientesLista.sort((a, b) => a.orden_entrega - b.orden_entrega);

        return clientesLista;
    } catch (error) {
        console.error(`❌ [NOTI-INICIO-RUTA] Error al obtener destinatarios para ruta ${rutaId}:`, error.message);
        throw error;
    }
}

/**
 * Despacha de forma asíncrona mensajes de WhatsApp de "Logística en Camino"
 * a los clientes seleccionados de la hoja de ruta.
 * 
 * @param {number|string} rutaId - ID de la ruta
 * @param {Array<string|number>} clientesSeleccionadosIds - Lista de IDs de clientes seleccionados
 * @returns {Promise<{totalEnviados: number, totalFallidos: number}>}
 */
async function despacharNotificacionesInicioRuta(rutaId, clientesSeleccionadosIds) {
    if (!clientesSeleccionadosIds || !Array.isArray(clientesSeleccionadosIds) || clientesSeleccionadosIds.length === 0) {
        console.log(`[NOTI-INICIO-RUTA] ℹ️ No hay clientes seleccionados para notificar en ruta #${rutaId}.`);
        return { totalEnviados: 0, totalFallidos: 0 };
    }

    console.log(`[NOTI-INICIO-RUTA] 🚀 Iniciando despacho de avisos en ruta #${rutaId} para ${clientesSeleccionadosIds.length} clientes...`);

    const todosLosClientes = await obtenerDestinatariosInicioRuta(rutaId);
    const seleccionadosSet = new Set(clientesSeleccionadosIds.map(id => String(id).trim()));
    const clientesAEnviar = todosLosClientes.filter(c => seleccionadosSet.has(String(c.cliente_id).trim()) && c.destinatarios.length > 0);

    const facturacionUrl = process.env.FACTURACION_API_URL || 'http://localhost:3004';
    let totalEnviados = 0;
    let totalFallidos = 0;

    for (const c of clientesAEnviar) {
        let mensaje = '';
        const clientName = c.nombre;

        const tieneSobres = Array.isArray(c.sobres) && c.sobres.length > 0;
        const txtSobres = tieneSobres
            ? (c.sobres.length > 1
                ? `los sobres *(${c.sobres.map(s => '#' + s).join(', ')})*`
                : `el sobre *(#${c.sobres[0]})*`)
            : '';

        // Construir mensaje conciso y determinista según tipo de parada (sin mencionar nunca montos)
        if (c.tipo_parada === 'VISITA_COMERCIAL') {
            const nombreContacto = c.destinatarios[0]?.nombre && c.destinatarios[0].nombre !== c.nombre && c.destinatarios[0].nombre !== 'Contacto'
                ? `Hola *${c.destinatarios[0].nombre}* (*${c.nombre}*)`
                : `Hola equipo de *${c.nombre}*`;
            mensaje = `👋 *¡Hola! Te escribimos de LAMDA*

${nombreContacto}, somos elaboradores y distribuidores mayoristas de frutos secos, granolas, barritas, cereales y legumbres en la región.

Hoy vamos a andar recorriendo *${c.zona || 'la zona'}* y teníamos pensado pasar unos minutos por el local para saludarlos, presentarles brevemente nuestra empresa y dejarles nuestra lista mayorista.

¡Quedamos atentos, muchas gracias!
*Equipo LAMDA*`;
        } else if (c.tipo_parada === 'SOLO_SOBRE') {
            mensaje = `🚚 *¡LAMDA Logística en camino!*

Hola *${clientName}*, le avisamos que nuestro chofer ya inició el recorrido de hoy y pasará por su domicilio para retirar ${txtSobres}.

¡Pronto estaremos allí! Muchas gracias.
*LAMDA Logística*`;
        } else if (c.tipo_parada === 'ENTREGA_Y_RETIRO') {
            const txtPed = c.pedidos.length > 1 ? `sus pedidos *(Órdenes #${c.pedidos.join(', #')})*` : `su pedido *(Orden #${c.pedidos[0]})*`;
            const txtRet = c.retiros.length > 1 ? `los retiros acordados *(Tickets #${c.retiros.join(', #')})*` : `el retiro acordado *(Ticket #${c.retiros[0]})*`;
            const lineaSobre = tieneSobres ? ` Asimismo, pasaremos a retirar ${txtSobres}.` : '';
            mensaje = `🚚 *¡Tu pedido LAMDA está en camino!*

Hola *${clientName}*, le avisamos que nuestro chofer ya inició el recorrido de entregas de hoy. ${txtPed.charAt(0).toUpperCase() + txtPed.slice(1)} se encuentra en camino y además pasaremos a realizar ${txtRet}.${lineaSobre}

Por favor, tenga preparado lo correspondiente. ¡Pronto estaremos allí!
*LAMDA Logística*`;
        } else if (c.tipo_parada === 'SOLO_RETIRO') {
            const txtRet = c.retiros.length > 1 ? `Tickets #${c.retiros.join(', #')}` : `Ticket #${c.retiros[0]}`;
            const lineaSobre = tieneSobres ? ` y a retirar ${txtSobres}` : '';
            mensaje = `🚚 *¡LAMDA Logística en camino!*

Hola *${clientName}*, le avisamos que nuestro chofer ya inició el recorrido de hoy y pasará por su domicilio para retirar la mercadería *(${txtRet})*${lineaSobre}.

Por favor, tenga preparado lo correspondiente. ¡Muchas gracias!
*LAMDA Logística*`;
        } else {
            const txtPed = c.pedidos.length > 1 ? `sus pedidos *(Órdenes #${c.pedidos.join(', #')})*` : `su pedido *(Orden #${c.pedidos[0]})*`;
            const lineaSobre = tieneSobres ? `\n\nAdemás, pasaremos a retirar ${txtSobres}.` : '';
            mensaje = `🚚 *¡Tu pedido LAMDA está en camino!*

Hola *${clientName}*, le avisamos que nuestro chofer ya inició el recorrido de entregas de hoy y ${txtPed} se encuentra en camino.${lineaSobre}

¡Pronto estaremos en su domicilio!
*LAMDA Logística*`;
        }

        // Despachar a cada destinatario WhatsApp habilitado para este cliente
        for (const dest of c.destinatarios) {
            try {
                console.log(`[NOTI-INICIO-RUTA] 📨 Despachando a ${clientName} (${dest.nombre} - Tel: ${dest.numero})...`);
                const res = await fetch(`${facturacionUrl}/facturacion/whatsapp/enviar-mensaje`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: dest.numero,
                        mensajeTexto: mensaje
                    })
                });
                const data = await res.json();
                if (data.success) {
                    totalEnviados++;
                    console.log(`[NOTI-INICIO-RUTA] ✅ Aviso enviado exitosamente a ${dest.numero} (${clientName})`);
                } else {
                    totalFallidos++;
                    console.warn(`[NOTI-INICIO-RUTA] ⚠️ Error devuelto por servicio WhatsApp para ${dest.numero}:`, data.error || data.message);
                }
            } catch (err) {
                totalFallidos++;
                console.error(`[NOTI-INICIO-RUTA] ❌ Error de conexión al enviar WhatsApp a ${dest.numero}:`, err.message);
            }
        }
    }

    console.log(`[NOTI-INICIO-RUTA] 🏁 Fin de despacho para ruta #${rutaId}: ${totalEnviados} enviados, ${totalFallidos} fallidos.`);
    return { totalEnviados, totalFallidos };
}

module.exports = {
    obtenerDestinatariosInicioRuta,
    despacharNotificacionesInicioRuta
};
