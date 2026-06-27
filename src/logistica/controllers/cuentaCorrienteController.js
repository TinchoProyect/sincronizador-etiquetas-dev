/**
 * Controlador de Cuentas Corrientes
 * Expone los endpoints HTTP CRUD para interactuar con las cuentas corrientes y sus movimientos.
 */

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { pool } = require('../config/database');
const CuentaCorrienteService = require('../services/cuentaCorrienteService');
const ClientesBunkerModel = require('../models/clientesBunkerModel');

/**
 * Obtener listado de cuentas corrientes asociadas a un cliente (por código búnker)
 */
exports.listarCuentas = async (req, res) => {
    try {
        const { cliente } = req.query;

        if (!cliente || !cliente.trim()) {
            return res.status(400).json({ success: false, error: 'El parámetro "cliente" (código búnker) es obligatorio.' });
        }

        console.log(`🔍 [CC-CONTROLLER] Solicitando cuentas corrientes para cliente: "${cliente}"`);
        
        // Verificar que el cliente existe primero
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(cliente.trim());
        if (!clienteObj) {
            return res.status(404).json({ success: false, error: 'El cliente especificado no existe.' });
        }

        const cuentas = await CuentaCorrienteService.obtenerCuentasPorCliente(cliente.trim());
        const umbral = parseFloat(process.env.UMBRAL_AJUSTE_MINIMO) || 50.00;
        res.json({ 
            success: true, 
            data: cuentas, 
            cliente: clienteObj, 
            umbral_ajuste_minimo: umbral 
        });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al obtener cuentas:', error);
        res.status(500).json({ success: false, error: 'Error al consultar las cuentas corrientes del cliente.' });
    }
};

/**
 * Abrir una nueva cuenta corriente para un cliente
 */
exports.crearCuenta = async (req, res) => {
    try {
        const { codigo_bunker_cliente, nombre_cuenta } = req.body;

        if (!codigo_bunker_cliente || !codigo_bunker_cliente.trim()) {
            return res.status(400).json({ success: false, error: 'El código de cliente (codigo_bunker_cliente) es obligatorio.' });
        }
        if (!nombre_cuenta || !nombre_cuenta.trim()) {
            return res.status(400).json({ success: false, error: 'El nombre descriptivo de la cuenta (nombre_cuenta) es obligatorio.' });
        }

        console.log(`➕ [CC-CONTROLLER] Solicitando apertura de cuenta "${nombre_cuenta}" para cliente: "${codigo_bunker_cliente}"`);
        
        const cc = await CuentaCorrienteService.crearCuentaCorriente(codigo_bunker_cliente.trim(), nombre_cuenta.trim());
        res.status(201).json({ 
            success: true, 
            data: cc, 
            message: `Cuenta corriente "${cc.nombre_cuenta}" creada exitosamente.` 
        });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al crear cuenta:', error);
        res.status(error.message.includes('no existe') ? 400 : 500).json({ 
            success: false, 
            error: error.message || 'Error al crear la cuenta corriente.' 
        });
    }
};

/**
 * Listar movimientos de una cuenta corriente específica
 */
exports.listarMovimientos = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }

        console.log(`🔍 [CC-CONTROLLER] Solicitando movimientos de CC ID: ${id}`);
        const movimientos = await CuentaCorrienteService.obtenerMovimientos(id);
        res.json({ success: true, data: movimientos });
    } catch (error) {
        console.error(`❌ [CC-CONTROLLER] Error al listar movimientos para CC ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error al consultar el historial de movimientos.' });
    }
};

/**
 * Registrar un movimiento manual (cobro/pago o ajuste) en una cuenta corriente
 */
exports.registrarMovimientoManual = async (req, res) => {
    try {
        const { id } = req.params; // cuenta_corriente_id
        const { tipo_movimiento, monto, descripcion, tipo_comprobante, fecha_movimiento, metadatos } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }

        console.log(`📝 [CC-CONTROLLER] Registrando movimiento manual para CC ID: ${id}`);
        
        const mov = await CuentaCorrienteService.registrarMovimientoManual({
            cuenta_corriente_id: id,
            tipo_movimiento,
            monto,
            descripcion,
            tipo_comprobante,
            fecha_movimiento,
            metadatos
        });

        res.status(201).json({ 
            success: true, 
            data: mov, 
            message: 'El movimiento ha sido registrado y el saldo actualizado con éxito.' 
        });
    } catch (error) {
        console.error(`❌ [CC-CONTROLLER] Error al registrar movimiento manual para CC ID ${req.params.id}:`, error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Error al registrar el movimiento.' 
        });
    }
};

/**
 * Registrar un ajuste automático por saldo mínimo/remanente para cerrar el balance a cero ($ 0.00)
 */
exports.registrarAjusteAutomatico = async (req, res) => {
    try {
        const { id } = req.params; // cuenta_corriente_id
        // Extraer operador del body, o usar el usuario de la sesión, o 'Sistema'
        const operador = req.body.operador || req.user?.nombre || req.user?.usuario || 'Sistema';

        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }

        console.log(`📝 [CC-CONTROLLER] Solicitando ajuste automático para CC ID: ${id} (Operador: ${operador})`);
        const mov = await CuentaCorrienteService.registrarAjusteAutomatico(id, operador);

        res.status(201).json({
            success: true,
            data: mov,
            message: 'El ajuste automático ha sido registrado y la cuenta fue saldada a cero.'
        });
    } catch (error) {
        console.error(`❌ [CC-CONTROLLER] Error al registrar ajuste automático para CC ID ${req.params.id}:`, error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al registrar el ajuste automático.'
        });
    }
};

/**
 * Generar reporte PDF de la cuenta corriente y transmitirlo al navegador
 */
exports.generarReportePdf = async (req, res) => {
    try {
        const { id } = req.params;
        const detallado = req.query.detallado === 'true';
        
        console.log(`📄 [CC-CONTROLLER] Petición de generación de PDF para CC ID: ${id} (Detallado: ${detallado})`);

        // 1. Obtener datos de la cuenta corriente
        const ccRes = await pool.query(
            'SELECT * FROM public.factura_cuentas_corrientes WHERE id = $1',
            [parseInt(id)]
        );
        if (ccRes.rows.length === 0) {
            return res.status(404).send('Cuenta corriente no encontrada.');
        }
        const cuentaObj = ccRes.rows[0];
        
        // 2. Obtener movimientos
        const movimientos = await CuentaCorrienteService.obtenerMovimientos(parseInt(id));
        // Orden cronológico descendente (el más reciente primero)
        const movimientosOrdenados = [...movimientos].sort((a, b) => {
            const dateDiff = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
            if (dateDiff !== 0) return dateDiff;
            return b.id - a.id;
        });

        if (detallado) {
            await cargarDetallesMovimientos(movimientosOrdenados);
        }
        
        // 3. Obtener cliente
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(cuentaObj.codigo_bunker_cliente);
        if (!clienteObj) {
            return res.status(404).send('Cliente no encontrado.');
        }
        
        // 4. Instanciar PDFKit y configurar headers
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 40, bottom: 25, left: 40, right: 40 },
            info: {
                Title: `Cuenta Corriente - ${clienteObj.razon_social}`,
                Author: 'LAMDA'
            }
        });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="cuenta_corriente_${clienteObj.codigo_bunker_cliente}.pdf"`);
        
        doc.pipe(res);
        
        // 5. Construir contenido
        construirDocumentoPdf(doc, cuentaObj, movimientosOrdenados, clienteObj, detallado);
        
        doc.end();
        
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al generar PDF:', error);
        res.status(500).send('Error interno al generar el reporte de cuenta corriente.');
    }
};

/**
 * Enviar reporte de cuenta corriente por WhatsApp usando el microservicio
 */
exports.enviarReporteWhatsapp = async (req, res) => {
    try {
        const { id } = req.params;
        const detallado = req.query.detallado === 'true' || req.body.detallado === 'true';
        
        console.log(`📱 [CC-CONTROLLER] Petición de envío de WhatsApp para CC ID: ${id} (Detallado: ${detallado})`);

        // 1. Obtener datos de la cuenta corriente
        const ccRes = await pool.query(
            'SELECT * FROM public.factura_cuentas_corrientes WHERE id = $1',
            [parseInt(id)]
        );
        if (ccRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cuenta corriente no encontrada.' });
        }
        const cuentaObj = ccRes.rows[0];
        
        // 2. Obtener movimientos
        const movimientos = await CuentaCorrienteService.obtenerMovimientos(parseInt(id));
        const movimientosOrdenados = [...movimientos].sort((a, b) => {
            const dateDiff = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
            if (dateDiff !== 0) return dateDiff;
            return b.id - a.id;
        });

        if (detallado) {
            await cargarDetallesMovimientos(movimientosOrdenados);
        }
        
        // 3. Obtener cliente
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(cuentaObj.codigo_bunker_cliente);
        if (!clienteObj) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
        }

        // 4. Resolver números telefónicos de WhatsApp en la ficha del cliente
        let whatsappDestinos = '';
        let tieneDestinatariosBody = false;
        if (req.body && req.body.destinatarios !== undefined) {
            tieneDestinatariosBody = true;
            if (Array.isArray(req.body.destinatarios)) {
                whatsappDestinos = req.body.destinatarios.filter(n => n && String(n).trim()).join(', ');
            } else {
                whatsappDestinos = String(req.body.destinatarios).trim();
            }
        }

        if (!tieneDestinatariosBody && clienteObj.whatsapp_facturas) {
            const val = clienteObj.whatsapp_facturas.trim();
            if (val.startsWith('[')) {
                try {
                    const contactos = JSON.parse(val);
                    whatsappDestinos = contactos.map(c => c.numero).filter(n => n && n.trim()).join(', ');
                } catch (err) {
                    console.error('❌ [CC-CONTROLLER] Error parseando JSON de contactos:', err.message);
                    whatsappDestinos = val;
                }
            } else {
                whatsappDestinos = val;
            }
        }

        if (!whatsappDestinos || !whatsappDestinos.trim()) {
            if (tieneDestinatariosBody) {
                return res.json({
                    success: true,
                    message: 'No se seleccionaron destinatarios de WhatsApp. Envío omitido.',
                    data: { destinatarios: '' }
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Sin contacto',
                message: 'El cliente no tiene números de WhatsApp configurados en su ficha. Edite los contactos en el panel de clientes.'
            });
        }

        // 5. Generar PDF en Buffer
        console.log(`📄 [CC-CONTROLLER] Generando PDF de cuenta corriente en memoria para ${clienteObj.codigo_bunker_cliente}...`);
        const pdfBuffer = await generarPdfBuffer(cuentaObj, movimientosOrdenados, clienteObj, detallado);
        const pdfBase64 = pdfBuffer.toString('base64');

        // 6. Enviar al microservicio en Facturación con timeout controlado de 8 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 8000);

        try {
            console.log(`📱 [CC-CONTROLLER] Invocando microservicio de WhatsApp para enviar reporte a: ${whatsappDestinos}`);
            
            const ultimoMov = movimientosOrdenados[0];
            const esChequeReciente = ultimoMov && (
                ultimoMov.tipo_comprobante === 'COBRO_CHEQUE' ||
                obtenerMedioPago(ultimoMov) === 'Cheque'
            );

            let filename = `cuenta_corriente_${clienteObj.codigo_bunker_cliente}.pdf`;
            const transferInfo = '\n\n*Datos para transferencia:*\n*Banco:* Galicia\n*DU:* 24892174\n*Cuenta (CTA):* 4007844-1 373-4\n*CBU:* 0070373230004007844141\n*CUIL:* 23248921749\n*ALIAS:* LAMDA.SER.MARTIN';
            let mensajeTexto = `Hola! Te enviamos adjunto el extracto de tu Cuenta Corriente emitido por LAMDA. Saludos y muchas gracias.` + transferInfo;

            if (esChequeReciente) {
                filename = `comprobante_cheque_${clienteObj.codigo_bunker_cliente}.pdf`;
                mensajeTexto = `Hola! Te enviamos adjunto el comprobante de validación/entrega de Cheque en tu Cuenta Corriente. Saludos y muchas gracias.` + transferInfo;
            }

            const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: whatsappDestinos,
                    pdfBase64: pdfBase64,
                    filename,
                    mensajeTexto
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();
            
            if (!response.ok || !data.success) {
                return res.status(response.status || 502).json({
                    success: false,
                    error: data.error || 'Falla del microservicio',
                    message: data.message || 'No se pudo enviar el reporte por WhatsApp.'
                });
            }

            res.json({
                success: true,
                message: 'El reporte de cuenta corriente ha sido enviado por WhatsApp con éxito.',
                data: data.data
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('❌ [CC-CONTROLLER] Error en llamada interna de WhatsApp:', fetchError.message);
            
            if (fetchError.name === 'AbortError') {
                return res.status(504).json({
                    success: false,
                    error: 'Servicio de mensajería no disponible',
                    message: 'La petición de envío de WhatsApp excedió el tiempo límite de espera (timeout de 8s).'
                });
            }

            res.status(503).json({
                success: false,
                error: 'Servicio de mensajería no disponible',
                message: 'El servicio de mensajería de WhatsApp no se encuentra disponible. Verifique que el módulo de Facturación esté corriendo.'
            });
        }

    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error general en enviarReporteWhatsapp:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

exports.enviarReporteEmail = async (req, res) => {
    try {
        const { id } = req.params;
        const detallado = req.query.detallado === 'true' || req.body.detallado === 'true';
        
        console.log(`📧 [CC-CONTROLLER] Petición de envío de Email para CC ID: ${id} (Detallado: ${detallado})`);

        // 1. Obtener datos de la cuenta corriente
        const ccRes = await pool.query(
            'SELECT * FROM public.factura_cuentas_corrientes WHERE id = $1',
            [parseInt(id)]
        );
        if (ccRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Cuenta corriente no encontrada.' });
        }
        const cuentaObj = ccRes.rows[0];
        
        // 2. Obtener movimientos
        const movimientos = await CuentaCorrienteService.obtenerMovimientos(parseInt(id));
        const movimientosOrdenados = [...movimientos].sort((a, b) => {
            const dateDiff = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
            if (dateDiff !== 0) return dateDiff;
            return b.id - a.id;
        });

        if (detallado) {
            await cargarDetallesMovimientos(movimientosOrdenados);
        }
        
        // 3. Obtener cliente
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(cuentaObj.codigo_bunker_cliente);
        if (!clienteObj) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
        }

        // 4. Resolver destinatarios de Correo Electrónico
        let emailDestinos = '';
        let tieneDestinatariosBody = false;
        if (req.body && req.body.destinatarios !== undefined) {
            tieneDestinatariosBody = true;
            if (Array.isArray(req.body.destinatarios)) {
                emailDestinos = req.body.destinatarios.filter(n => n && String(n).trim()).join(', ');
            } else {
                emailDestinos = String(req.body.destinatarios).trim();
            }
        }

        if (!tieneDestinatariosBody && clienteObj.email_facturas) {
            const val = clienteObj.email_facturas.trim();
            if (val.startsWith('[')) {
                try {
                    const contactos = JSON.parse(val);
                    emailDestinos = contactos.map(c => c.email).filter(e => e && e.trim()).join(', ');
                } catch (err) {
                    console.error('❌ [CC-CONTROLLER] Error parseando JSON de contactos email:', err.message);
                    emailDestinos = val;
                }
            } else {
                emailDestinos = val;
            }
        }

        if (!emailDestinos || !emailDestinos.trim()) {
            if (tieneDestinatariosBody) {
                return res.json({
                    success: true,
                    message: 'No se seleccionaron destinatarios de correo. Envío omitido.',
                    data: { destinatarios: '' }
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Sin contacto de correo',
                message: 'El cliente no tiene direcciones de correo configuradas en su ficha. Edite los contactos en el panel de clientes.'
            });
        }

        // 5. Generar PDF en Buffer
        console.log(`📄 [CC-CONTROLLER] Generando PDF de cuenta corriente en memoria para ${clienteObj.codigo_bunker_cliente}...`);
        const pdfBuffer = await generarPdfBuffer(cuentaObj, movimientosOrdenados, clienteObj, detallado);
        const pdfBase64 = pdfBuffer.toString('base64');

        // 6. Enviar al microservicio en Facturación con timeout controlado de 10 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 10000);

        try {
            console.log(`📧 [CC-CONTROLLER] Invocando microservicio de Correo para enviar reporte a: ${emailDestinos}`);
            
            const fechaCorte = new Date().toLocaleDateString('es-AR');
            const saldoActual = parseFloat(cuentaObj.saldo || 0);

            const response = await fetch('http://localhost:3004/facturacion/email/cuentas-corrientes/enviar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cliente: {
                        cliente_nombre: clienteObj.cliente_nombre,
                        razon_social: clienteObj.razon_social,
                        codigo_bunker_cliente: clienteObj.codigo_bunker_cliente
                    },
                    destinatarios: emailDestinos,
                    pdfBase64: pdfBase64,
                    fechaCorte,
                    saldoActual
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();
            
            if (!response.ok || !data.success) {
                return res.status(response.status || 502).json({
                    success: false,
                    error: data.error || 'Falla del microservicio de correo',
                    message: data.message || 'No se pudo enviar el reporte por Correo Electrónico.'
                });
            }

            res.json({
                success: true,
                message: 'El reporte de cuenta corriente ha sido enviado por Correo Electrónico con éxito.',
                data: data.data
            });

        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('❌ [CC-CONTROLLER] Error en llamada interna de Correo:', fetchError.message);
            
            if (fetchError.name === 'AbortError') {
                return res.status(504).json({
                    success: false,
                    error: 'Servicio de correo no disponible',
                    message: 'La petición de envío de correo excedió el tiempo límite de espera (timeout de 10s).'
                });
            }

            res.status(503).json({
                success: false,
                error: 'Servicio de correo no disponible',
                message: 'El servicio de correo electrónico no se encuentra disponible. Verifique que el módulo de Facturación esté corriendo.'
            });
        }

    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error general en enviarReporteEmail:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Listar presupuestos pendientes de Lomasoft para incorporar
 */
exports.listarPresupuestosPendientesLomasoft = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }
        console.log(`🔍 [CC-CONTROLLER] Buscando presupuestos Lomasoft pendientes para CC ID: ${id}`);
        const presupuestos = await CuentaCorrienteService.obtenerPresupuestosPendientesLomasoft(parseInt(id));
        res.json({ success: true, data: presupuestos });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al listar presupuestos Lomasoft:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Incorporar manualmente un presupuesto de Lomasoft
 */
exports.incorporarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { presupuesto_id } = req.body;
        
        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }
        if (!presupuesto_id) {
            return res.status(400).json({ success: false, error: 'El ID del presupuesto es obligatorio.' });
        }

        console.log(`➕ [CC-CONTROLLER] Incorporando presupuesto ${presupuesto_id} en CC ID: ${id}`);
        const movimiento = await CuentaCorrienteService.incorporarPresupuestoLomasoft(parseInt(id), parseInt(presupuesto_id));
        res.status(201).json({ success: true, data: movimiento, message: 'Presupuesto incorporado con éxito.' });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al incorporar presupuesto:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Eliminar un movimiento de cuenta corriente (soft-delete / logueado en auditoría)
 */
exports.eliminarMovimiento = async (req, res) => {
    try {
        const { movimientoId } = req.params;
        const { motivo } = req.body || {};
        
        if (!movimientoId) {
            return res.status(400).json({ success: false, error: 'El ID del movimiento es obligatorio.' });
        }

        console.log(`🗑️ [CC-CONTROLLER] Eliminando movimiento ID: ${movimientoId}`);
        await CuentaCorrienteService.eliminarMovimiento(parseInt(movimientoId), motivo || 'Eliminación manual desde interfaz');
        res.json({ success: true, message: 'Movimiento eliminado y saldo recalculado con éxito.' });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al eliminar movimiento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ==========================================
// HELPERS DE GENERACIÓN DE PDF Y FORMATEO
// ==========================================

/**
 * Helper para cargar de forma asíncrona y consolidada el detalle de artículos
 * y la trazabilidad logística de cada movimiento del tipo FACTURA.
 */
async function cargarDetallesMovimientos(movimientos) {
    for (const mov of movimientos) {
        if (mov.tipo_comprobante === 'FACTURA' || (mov.tipo_comprobante && mov.tipo_comprobante.startsWith('FACTURA_'))) {
            if (mov.comprobante_id) {
                try {
                    // 1. Obtener items
                    const itemsRes = await pool.query(
                        'SELECT descripcion, qty, p_unit, imp_neto, imp_iva FROM public.factura_factura_items WHERE factura_id = $1 ORDER BY orden ASC',
                        [mov.comprobante_id]
                    );
                    mov.items = itemsRes.rows;

                    // 2. Obtener trazabilidad logística
                    const logRes = await pool.query(`
                        SELECT 
                            p.id as presupuesto_id,
                            p.id_ruta,
                            p.estado_logistico,
                            p.fecha_entrega_real,
                            r.nombre_ruta,
                            r.fecha_salida as fecha_despacho,
                            u.nombre_completo as chofer_nombre_completo,
                            ee.receptor_nombre,
                            ee.receptor_vinculo,
                            ee.dni_receptor,
                            ee.fecha_entrega as event_fecha_entrega,
                            ee.firma_digital
                        FROM public.presupuestos p
                        LEFT JOIN public.rutas r ON p.id_ruta = r.id
                        LEFT JOIN public.usuarios u ON r.id_chofer = u.id
                        LEFT JOIN public.entregas_eventos ee ON ee.id_presupuesto = p.id
                        WHERE p.factura_id = $1 OR p.id = (SELECT presupuesto_id FROM public.factura_facturas WHERE id = $1)
                        LIMIT 1
                    `, [mov.comprobante_id]);

                    if (logRes.rowCount > 0) {
                        mov.logistica = logRes.rows[0];
                    } else {
                        mov.logistica = null;
                    }
                } catch (err) {
                    console.error(`❌ [CC-CONTROLLER] Error al cargar detalles para movimiento ID ${mov.id}:`, err.message);
                    mov.items = [];
                    mov.logistica = null;
                }
            } else if (mov.presupuesto_id) {
                try {
                    // 1. Obtener items desde presupuestos_detalles resolviendo la descripción del artículo
                    const itemsRes = await pool.query(
                        `SELECT 
                            COALESCE(a.nombre, pd.articulo) AS descripcion, 
                            pd.cantidad AS qty, 
                            pd.precio1 AS p_unit, 
                            (pd.cantidad * pd.precio1) AS imp_neto 
                         FROM public.presupuestos_detalles pd
                         LEFT JOIN public.articulos a ON pd.articulo = a.codigo_barras
                         WHERE pd.id_presupuesto = $1`,
                        [mov.presupuesto_id]
                    );
                    mov.items = itemsRes.rows;

                    // 2. Obtener trazabilidad logística directamente para el presupuesto
                    const logRes = await pool.query(`
                        SELECT 
                            p.id as presupuesto_id,
                            p.id_ruta,
                            p.estado_logistico,
                            p.fecha_entrega_real,
                            r.nombre_ruta,
                            r.fecha_salida as fecha_despacho,
                            u.nombre_completo as chofer_nombre_completo,
                            ee.receptor_nombre,
                            ee.receptor_vinculo,
                            ee.dni_receptor,
                            ee.fecha_entrega as event_fecha_entrega,
                            ee.firma_digital
                        FROM public.presupuestos p
                        LEFT JOIN public.rutas r ON p.id_ruta = r.id
                        LEFT JOIN public.usuarios u ON r.id_chofer = u.id
                        LEFT JOIN public.entregas_eventos ee ON ee.id_presupuesto = p.id
                        WHERE p.id = $1
                        LIMIT 1
                    `, [mov.presupuesto_id]);

                    if (logRes.rowCount > 0) {
                        mov.logistica = logRes.rows[0];
                    } else {
                        mov.logistica = null;
                    }
                } catch (err) {
                    console.error(`❌ [CC-CONTROLLER] Error al cargar detalles de presupuesto para movimiento ID ${mov.id}:`, err.message);
                    mov.items = [];
                    mov.logistica = null;
                }
            }
        }
    }
}

/**
 * Generar el buffer en memoria de un PDF
 */
const generarPdfBuffer = (cuentaObj, movimientosOrdenados, clienteObj, detallado = false) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 25, left: 40, right: 40 } });
            const buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                resolve(Buffer.concat(buffers));
            });
            doc.on('error', reject);
            
            construirDocumentoPdf(doc, cuentaObj, movimientosOrdenados, clienteObj, detallado);
            doc.end();
        } catch (e) {
            reject(e);
        }
    });
};


/**
 * Construir el contenido visual estructurado del PDF
 */
const construirDocumentoPdf = (doc, cuentaObj, movimientos, clienteObj, detallado = false) => {
    const pageWidth = doc.page.width;
    const pageMargin = doc.page.margins.left;
    const contentWidth = pageWidth - (pageMargin * 2);
    const leftColumn = pageMargin;
    
    let yPos = 40;
    
    // 1. CABECERA
    // Título a la izquierda
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#8e4785').text('Informe de Cuenta Corriente', leftColumn, yPos);
    doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text('Detalle cronológico de movimientos financieros y balance de cuenta', leftColumn, yPos + 17);
    
    // Alias de Transferencia Bancaria
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#8e4785').text('Alias CBU para Transferencias: ', leftColumn, yPos + 29, { continued: true })
       .font('Helvetica').fillColor('#1e293b').text('LAMDA.SER.MARTIN');
    
    // Isotipo "L" a la derecha (estático e independiente de logo_LAMDA_grande.png)
    const isotipoPath = path.join(__dirname, '../img/isotipo_L_LAMDA.png');
    const isoSize = 35;
    const isoX = pageWidth - pageMargin - isoSize;
    if (fs.existsSync(isotipoPath)) {
        doc.image(isotipoPath, isoX, yPos - 2, { width: isoSize, height: isoSize });
    } else {
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#8e4785').text('L', isoX, yPos - 2, { width: isoSize, align: 'right' });
    }
    
    yPos += 48;
    
    // Línea divisoria violeta de cabecera
    doc.moveTo(leftColumn, yPos).lineTo(pageWidth - pageMargin, yPos).strokeColor('#8e4785').lineWidth(1.5).stroke();
    
    yPos += 12;
    
    // 2. DATOS DEL CLIENTE Y BALANCE CONSOLIDADO (En paralelo)
    const clienteBoxWidth = 320;
    const balanceBoxWidth = contentWidth - clienteBoxWidth - 10; // 515 - 320 - 10 = 185
    const balanceBoxX = leftColumn + clienteBoxWidth + 10; // 40 + 320 + 10 = 370

    // Configuración de columnas internas para evitar solapamientos
    const colLeftX = leftColumn + 12;
    const colWidthLeft = 145; // colRightX (165) - 12 - 8 (gap) = 145 pt
    const colRightX = leftColumn + 165;
    const colWidthRight = clienteBoxWidth - 165 - 12; // 143 pt

    // Formatear valores de cliente
    let cuitRaw = clienteObj.cuit_cuil || '';
    let cuitFmt = cuitRaw;
    if (cuitRaw.length === 11) {
        cuitFmt = `${cuitRaw.substring(0, 2)}-${cuitRaw.substring(2, 10)}-${cuitRaw.substring(10)}`;
    }
    let lomasId = clienteObj.lomas_soft_id || '';
    let codigoHistorico = 'S/D';
    if (lomasId) {
        codigoHistorico = String(parseInt(lomasId)).padStart(3, '0');
    }

    const razonSocialText = clienteObj.razon_social || 'S/D';
    const condicionIvaText = clienteObj.condicion_iva || 'Consumidor Final';
    const domicilioFiscalText = clienteObj.domicilio_fiscal || 'S/D';
    const cuitText = cuitFmt || 'S/D';
    const codigoHistoricoText = codigoHistorico;
    const codigoClienteText = clienteObj.codigo_bunker_cliente || 'S/D';

    // Medir alturas de textos para cálculo dinámico de boxHeight (usando Helvetica-Bold de forma conservadora)
    doc.fontSize(8).font('Helvetica-Bold');
    const hRazonSocial = doc.heightOfString(`Razón Social: ${razonSocialText}`, { width: colWidthLeft });
    const hCondicionIva = doc.heightOfString(`Condición IVA: ${condicionIvaText}`, { width: colWidthLeft });
    const hDomicilioFiscal = doc.heightOfString(`Domicilio Fiscal: ${domicilioFiscalText}`, { width: colWidthLeft });

    const hCuit = doc.heightOfString(`CUIT: ${cuitText}`, { width: colWidthRight });
    const hCodigoHistorico = doc.heightOfString(`Código Histórico: ${codigoHistoricoText}`, { width: colWidthRight });
    const hCodigoCliente = doc.heightOfString(`Código Cliente: ${codigoClienteText}`, { width: colWidthRight });

    // Altura total de datos (con 3pt de espaciado entre filas)
    const totalLeftHeight = hRazonSocial + 3 + hCondicionIva + 3 + hDomicilioFiscal;
    const totalRightHeight = hCuit + 3 + hCodigoHistorico + 3 + hCodigoCliente;
    
    // Altura final del box con padding (18pt arriba, 5pt abajo)
    const boxHeight = Math.max(58, 18 + Math.max(totalLeftHeight, totalRightHeight) + 5);

    // A. Recuadro Datos Cliente
    doc.save();
    doc.roundedRect(leftColumn, yPos, clienteBoxWidth, boxHeight, 4).fillColor('#f8fafc').fill();
    doc.roundedRect(leftColumn, yPos, clienteBoxWidth, boxHeight, 4).strokeColor('#e2e8f0').lineWidth(0.75).stroke();
    doc.restore();
    
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#8e4785').text('DATOS FORMALES DEL CLIENTE', leftColumn + 12, yPos + 6);
    
    // Renderizado Columna Izquierda con saltos de línea dinámicos (8pt)
    let yLeft = yPos + 18;
    doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
    
    doc.font('Helvetica-Bold').text('Razón Social: ', colLeftX, yLeft, { continued: true, width: colWidthLeft })
       .font('Helvetica').text(razonSocialText);
    yLeft += hRazonSocial + 3;
    
    doc.font('Helvetica-Bold').text('Condición IVA: ', colLeftX, yLeft, { continued: true, width: colWidthLeft })
       .font('Helvetica').text(condicionIvaText);
    yLeft += hCondicionIva + 3;
    
    doc.font('Helvetica-Bold').text('Domicilio Fiscal: ', colLeftX, yLeft, { continued: true, width: colWidthLeft })
       .font('Helvetica').text(domicilioFiscalText);
       
    // Renderizado Columna Derecha con saltos de línea dinámicos (8pt)
    let yRight = yPos + 18;
    
    doc.font('Helvetica-Bold').text('CUIT: ', colRightX, yRight, { continued: true, width: colWidthRight })
       .font('Helvetica').text(cuitText);
    yRight += hCuit + 3;
    
    doc.font('Helvetica-Bold').text('Código Histórico: ', colRightX, yRight, { continued: true, width: colWidthRight })
       .font('Helvetica').text(codigoHistoricoText);
    yRight += hCodigoHistorico + 3;
    
    doc.font('Helvetica-Bold').text('Código Cliente: ', colRightX, yRight, { continued: true, width: colWidthRight })
       .font('Helvetica').text(codigoClienteText);

    // B. Recuadro Balance Consolidado (Encabezado)
    doc.save();
    doc.roundedRect(balanceBoxX, yPos, balanceBoxWidth, boxHeight, 4).fillColor('#fdf6fd').fill();
    doc.roundedRect(balanceBoxX, yPos, balanceBoxWidth, boxHeight, 4).strokeColor('#8e4785').lineWidth(1).stroke();
    doc.restore();

    const finalSaldo = parseFloat(cuentaObj.saldo) || 0;
    let labelDeuda = 'Al día / Sin deuda';
    let labelColor = '#047857';
    if (finalSaldo > 0) {
        labelDeuda = 'Saldo Deudor';
        labelColor = '#b91c1c';
    } else if (finalSaldo < 0) {
        labelDeuda = 'Saldo a Favor';
        labelColor = '#047857';
    }

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#8e4785').text('ESTADO CONSOLIDADO', balanceBoxX + 12, yPos + 6);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(labelColor).text(labelDeuda.toUpperCase(), balanceBoxX + 12, yPos + 18);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#8e4785');
    doc.text('BALANCE: ', balanceBoxX + 12, yPos + 30, { continued: true });
    doc.fillColor(labelColor).text(formatCurrency(finalSaldo));

    yPos += boxHeight + 14;
    
    // 3. TABLA DE MOVIMIENTOS (Encabezados de grilla)
    doc.save();
    doc.rect(leftColumn, yPos, contentWidth, 14).fillColor('#8e4785').fill();
    doc.restore();
    
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('Fecha', leftColumn + 8, yPos + 3);
    doc.text('Concepto / Descripción', leftColumn + 80, yPos + 3);
    doc.text('Tipo', leftColumn + 270, yPos + 3);
    doc.text('Débito (+)', leftColumn + 330, yPos + 3, { width: 60, align: 'right' });
    doc.text('Crédito (-)', leftColumn + 395, yPos + 3, { width: 60, align: 'right' });
    doc.text('Saldo Acum.', leftColumn + 460, yPos + 3, { width: 50, align: 'right' });
    
    yPos += 19;
    
    doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
    
    let lastMonthYear = null;
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    for (let index = 0; index < movimientos.length; index++) {
        const mov = movimientos[index];
        
        // Detectar cambio de mes/año
        const dateObj = new Date(mov.fecha_movimiento);
        const currentMonthYear = `${dateObj.getMonth()}-${dateObj.getFullYear()}`;
        
        if (currentMonthYear !== lastMonthYear) {
            const nombreMes = meses[dateObj.getMonth()];
            const textHeader = `${nombreMes} ${dateObj.getFullYear()}`;
            
            // Control de salto de página antes del encabezado mensual
            if (yPos > doc.page.height - 85 - 20) {
                doc.addPage();
                yPos = 40;
                
                doc.save();
                doc.rect(leftColumn, yPos, contentWidth, 14).fillColor('#8e4785').fill();
                doc.restore();
                
                doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
                doc.text('Fecha', leftColumn + 8, yPos + 3);
                doc.text('Concepto / Descripción', leftColumn + 80, yPos + 3);
                doc.text('Tipo', leftColumn + 270, yPos + 3);
                doc.text('Débito (+)', leftColumn + 330, yPos + 3, { width: 60, align: 'right' });
                doc.text('Crédito (-)', leftColumn + 395, yPos + 3, { width: 60, align: 'right' });
                doc.text('Saldo Acum.', leftColumn + 460, yPos + 3, { width: 50, align: 'right' });
                yPos += 19;
            }
            
            // Dibujar banda del separador mensual estilizado (fondo gris/atenuado con bordes suaves)
            doc.save();
            doc.rect(leftColumn, yPos, contentWidth, 15).fillColor('#f1f5f9').fill(); // Gris azulado atenuado #f1f5f9
            doc.restore();
            
            doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#8e4785');
            doc.text(textHeader.toUpperCase(), leftColumn + 8, yPos + 3.5);
            
            yPos += 19;
            lastMonthYear = currentMonthYear;
        }

        const fechaStr = formatDate(mov.fecha_movimiento);
        
        const esDebito = mov.tipo_movimiento === 'DEBITO';
        const monto = parseFloat(mov.monto) || 0;
        const saldoRes = parseFloat(mov.saldo_resultante) || 0;
        
        const debitoText = esDebito ? formatCurrency(monto) : '-';
        const creditoText = !esDebito ? formatCurrency(monto) : '-';
        
        let tipoComp = 'Manual';
        if (mov.tipo_comprobante === 'FACTURA') {
            tipoComp = 'Factura';
        } else if (mov.tipo_comprobante === 'NOTA_CREDITO') {
            tipoComp = 'N. Crédito';
        } else if (mov.tipo_comprobante === 'AJUSTE_MANUAL') {
            tipoComp = 'Ajuste';
        } else if (mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') {
            tipoComp = 'Ajuste Aut.';
        } else {
            const medioPago = obtenerMedioPago(mov);
            if (medioPago) {
                tipoComp = medioPago;
            }
        }

        let desc = mov.descripcion || 'Sin concepto';
        desc = desc.replace(/\r/g, '').trim();
        if (mov.tipo_comprobante === 'RECIBO_PAGO') {
            const medioPago = obtenerMedioPago(mov) || 'Efectivo';
            desc = `Rec/Pago - ${medioPago}`;
        } else {
            desc = desc.replace(/^Factura Puesto 007 - Nro\s+/, 'Fac ');
            desc = desc.replace(/^Cobro Banc?[ao]rio?\s+/, 'Bco ');
            desc = desc.replace(/-\s+Concepto:\s+/i, '- cpto.: ');
        }

        // Calcular altura dinámica del renglón según el concepto
        doc.font('Helvetica-Bold');
        const descHeight = doc.heightOfString(desc, { width: 180 });
        doc.font('Helvetica');
        const rowHeight = Math.max(14, descHeight) + 2;

        // Calcular altura de la caja detallada si corresponde
        const esDetalladoFactura = detallado && mov.tipo_comprobante === 'FACTURA';
        const detailedBoxHeight = esDetalladoFactura ? (45 + (mov.items && mov.items.length > 0 ? mov.items.length * 13 + 17 : 13) + 35) : 0;
        
        // Control de salto de página antes de renderizar la fila para mantener el bloque unido
        if (yPos > doc.page.height - 85 - detailedBoxHeight - rowHeight) {
            doc.addPage();
            yPos = 40;
            
            doc.save();
            doc.rect(leftColumn, yPos, contentWidth, 14).fillColor('#8e4785').fill();
            doc.restore();
            
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
            doc.text('Fecha', leftColumn + 8, yPos + 3);
            doc.text('Concepto / Descripción', leftColumn + 80, yPos + 3);
            doc.text('Tipo', leftColumn + 270, yPos + 3);
            doc.text('Débito (+)', leftColumn + 330, yPos + 3, { width: 60, align: 'right' });
            doc.text('Crédito (-)', leftColumn + 395, yPos + 3, { width: 60, align: 'right' });
            doc.text('Saldo Acum.', leftColumn + 460, yPos + 3, { width: 50, align: 'right' });
            
            yPos += 19;
            doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        }
        
        // Renderizar fila principal
        doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        doc.text(fechaStr, leftColumn + 8, yPos);
        
        // Escribir el concepto con wrap y ancho limitado
        doc.font('Helvetica-Bold').text(desc, leftColumn + 80, yPos, { width: 180 }).font('Helvetica');
        
        doc.text(tipoComp, leftColumn + 270, yPos);
        
        if (esDebito) {
            doc.fillColor('#b91c1c'); // Rojo para débitos
            doc.text(`+${debitoText}`, leftColumn + 310, yPos, { width: 80, align: 'right' });
        } else {
            doc.fillColor('#1e293b');
            doc.text('-', leftColumn + 310, yPos, { width: 80, align: 'right' });
        }
        
        if (!esDebito) {
            doc.fillColor('#047857'); // Verde para créditos
            doc.text(`-${creditoText}`, leftColumn + 375, yPos, { width: 80, align: 'right' });
        } else {
            doc.fillColor('#1e293b');
            doc.text('-', leftColumn + 375, yPos, { width: 80, align: 'right' });
        }
        
        doc.fillColor('#1e293b');
        doc.text(formatCurrency(saldoRes), leftColumn + 430, yPos, { width: 80, align: 'right' });
        
        yPos += rowHeight;

        // Renderizar caja detallada si corresponde
        if (esDetalladoFactura) {
            doc.save();
            // Dibujar fondo de caja lavanda/gris
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).fillColor('#f8fafc').fill();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.restore();

            let boxYPos = yPos + 8;
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#6b21a8');
            doc.text('DETALLE DE FACTURACIÓN', leftColumn + 25, boxYPos);
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b');
            doc.text('Artículo / Concepto', leftColumn + 25, boxYPos + 12);
            doc.text('Cant.', leftColumn + 260, boxYPos + 12, { width: 30, align: 'right' });
            doc.text('P. Unitario', leftColumn + 300, boxYPos + 12, { width: 60, align: 'right' });
            doc.text('Subtotal', leftColumn + 370, boxYPos + 12, { width: 60, align: 'right' });

            boxYPos += 22;
            doc.font('Helvetica').fontSize(7).fillColor('#334155');
            if (mov.items && mov.items.length > 0) {
                let totalQty = 0;
                let totalSubtotal = 0;
                mov.items.forEach(item => {
                    const pUnit = (parseInt(mov.pto_vta) === 90) 
                        ? ((parseFloat(item.imp_neto) + parseFloat(item.imp_iva || 0)) / (parseFloat(item.qty) || 1))
                        : parseFloat(item.p_unit);
                    const subtotal = (parseInt(mov.pto_vta) === 90)
                        ? (parseFloat(item.imp_neto) + parseFloat(item.imp_iva || 0))
                        : parseFloat(item.imp_neto);

                    totalQty += parseFloat(item.qty) || 0;
                    totalSubtotal += subtotal;

                    doc.text(item.descripcion, leftColumn + 25, boxYPos);
                    doc.text(parseFloat(item.qty).toFixed(0), leftColumn + 260, boxYPos, { width: 30, align: 'right' });
                    doc.text(formatCurrency(pUnit), leftColumn + 300, boxYPos, { width: 60, align: 'right' });
                    doc.text(formatCurrency(subtotal), leftColumn + 370, boxYPos, { width: 60, align: 'right' });
                    boxYPos += 13;
                });

                // Línea de totales
                doc.moveTo(leftColumn + 25, boxYPos).lineTo(leftColumn + 430, boxYPos).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
                boxYPos += 4;

                // Escribir totales
                doc.fontSize(7).font('Helvetica-Bold').fillColor('#334155');
                doc.text('TOTAL:', leftColumn + 25, boxYPos);
                doc.text(totalQty.toFixed(0), leftColumn + 260, boxYPos, { width: 30, align: 'right' });
                doc.text(formatCurrency(totalSubtotal), leftColumn + 370, boxYPos, { width: 60, align: 'right' });
                boxYPos += 13;
            } else {
                doc.text('No hay ítems registrados para esta factura.', leftColumn + 25, boxYPos);
                boxYPos += 13;
            }

            // Separador interno
            doc.moveTo(leftColumn + 25, boxYPos).lineTo(leftColumn + contentWidth - 25, boxYPos).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
            boxYPos += 6;

            // Datos Logísticos
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#d97706').text('TRAZABILIDAD Y ENTREGA LOGÍSTICA', leftColumn + 25, boxYPos);
            
            boxYPos += 11;
            doc.fontSize(7).font('Helvetica').fillColor('#334155');
            const log = mov.logistica;
            if (log) {
                const esEnvio = log.id_ruta !== null;
                const modText = esEnvio ? 'Envío Logístico (Distribución)' : 'Retiro por depósito (Presencial)';
                
                doc.font('Helvetica-Bold').text('Modalidad: ', leftColumn + 25, boxYPos, { continued: true })
                   .font('Helvetica').text(modText);

                if (esEnvio) {
                    doc.font('Helvetica-Bold').text('Hoja de Ruta: ', leftColumn + 25, boxYPos + 9, { continued: true })
                       .font('Helvetica').text(log.nombre_ruta || 'S/D');
                    doc.font('Helvetica-Bold').text('Chofer Asignado: ', leftColumn + 25, boxYPos + 18, { continued: true })
                       .font('Helvetica').text(log.chofer_nombre_completo || 'S/D');
                }

                const colRight = leftColumn + (contentWidth / 2) + 20;
                let recepcionText = 'Pendiente de entrega';
                if (log.estado_logistico === 'ENTREGADO') {
                    const receptorName = log.receptor_nombre || 'N/D';
                    const receptorVinculo = log.receptor_vinculo ? ` (${log.receptor_vinculo})` : '';
                    const dniText = log.dni_receptor ? ` - DNI: ${log.dni_receptor}` : '';
                    recepcionText = `${receptorName}${receptorVinculo}${dniText}`;
                } else if (log.estado_logistico === 'RECHAZADO') {
                    recepcionText = `Rechazado en destino`;
                }

                doc.font('Helvetica-Bold').text('Estado / Receptor: ', colRight, boxYPos, { continued: true })
                   .font('Helvetica').text(recepcionText);

                const fechaEnt = log.event_fecha_entrega || log.fecha_entrega_real;
                doc.font('Helvetica-Bold').text('Fecha de Entrega: ', colRight, boxYPos + 9, { continued: true })
                   .font('Helvetica').text(fechaEnt ? new Date(fechaEnt).toLocaleString('es-AR') : 'S/D');

                const tieneFirma = log.firma_digital !== null && log.firma_digital !== undefined && log.firma_digital.trim() !== '';
                doc.font('Helvetica-Bold').text('Conformidad: ', colRight, boxYPos + 18, { continued: true })
                   .font('Helvetica').text(tieneFirma ? 'Firmado digitalmente en dispositivo chofer (Validado) ✅' : 'Pendiente de firma / Entrega manual');
            } else {
                doc.text('No se encontraron registros de logística o despacho asociados en el sistema.', leftColumn + 25, boxYPos);
            }

            yPos += detailedBoxHeight + 10;
        }

        // Dibujar línea divisoria inferior
        doc.moveTo(leftColumn, yPos - 2)
           .lineTo(pageWidth - pageMargin, yPos - 2)
           .strokeColor('#e2e8f0')
           .lineWidth(0.5)
           .stroke();
    }
    
    // 4. FILA DE SALDO DE APERTURA (Inicio de la cuenta)
    const saldoApertura = parseFloat(cuentaObj.saldo_apertura) || 0;
    
    if (yPos > doc.page.height - 85 - 18) {
        doc.addPage();
        yPos = 40;
        
        doc.save();
        doc.rect(leftColumn, yPos, contentWidth, 14).fillColor('#8e4785').fill();
        doc.restore();
        
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('Fecha', leftColumn + 8, yPos + 3);
        doc.text('Concepto / Descripción', leftColumn + 80, yPos + 3);
        doc.text('Tipo', leftColumn + 270, yPos + 3);
        doc.text('Débito (+)', leftColumn + 330, yPos + 3, { width: 60, align: 'right' });
        doc.text('Crédito (-)', leftColumn + 395, yPos + 3, { width: 60, align: 'right' });
        doc.text('Saldo Acum.', leftColumn + 460, yPos + 3, { width: 50, align: 'right' });
        yPos += 19;
    }
    
    doc.fontSize(8).font('Helvetica').fillColor('#64748b');
    const fechaApertura = '-';
    doc.text(fechaApertura, leftColumn + 8, yPos);
    
    doc.font('Helvetica-Oblique').text('Saldo de Apertura / Ajuste Inicial', leftColumn + 80, yPos).font('Helvetica');
    doc.text('Apertura', leftColumn + 270, yPos);
    doc.text('-', leftColumn + 310, yPos, { width: 80, align: 'right' });
    doc.text('-', leftColumn + 375, yPos, { width: 80, align: 'right' });
    doc.text(formatCurrency(saldoApertura), leftColumn + 430, yPos, { width: 80, align: 'right' });
    
    yPos += 18;
    
    doc.moveTo(leftColumn, yPos - 2)
       .lineTo(pageWidth - pageMargin, yPos - 2)
       .strokeColor('#e2e8f0')
       .lineWidth(0.5)
       .stroke();
    
    yPos += 10;
    
    // 5. PIE DE PÁGINA INFORMATIVO
    doc.fontSize(7).font('Helvetica').fillColor('#94a3b8').text(
        'El presente informe constituye un extracto oficial del estado financiero del cliente en el sistema de gestión de LAMDA. Los movimientos reflejados incluyen compras, créditos fiscales, cobros y ajustes debidamente validados por la administración comercial.',
        leftColumn,
        doc.page.height - 50,
        { align: 'center', width: contentWidth }
    );
};

/**
 * Formateador de moneda en pesos argentinos
 */
const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2
    }).format(value);
};

/**
 * Formateador de fecha corta
 */
const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

/**
 * Determina el medio de pago real basado en los metadatos, tipo de comprobante y descripción
 */
const obtenerMedioPago = (mov) => {
    if (mov.tipo_comprobante === 'COBRO_CHEQUE') {
        return 'Cheque';
    }
    if (mov.metadatos) {
        try {
            const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
            if (meta && meta.tipo_pago) {
                const tp = String(meta.tipo_pago).trim();
                if (['Transferencia', 'Cheque', 'Efectivo'].some(m => m.toLowerCase() === tp.toLowerCase())) {
                    return tp.charAt(0).toUpperCase() + tp.slice(1).toLowerCase();
                }
                return tp;
            }
        } catch (e) {
            console.error('Error parseando metadatos para medio de pago:', e);
        }
    }

    if (mov.tipo_comprobante === 'COBRO_BANCARIO' || mov.tipo_comprobante === 'PAGO_BANCARIO') {
        return 'Transferencia';
    }

    const desc = (mov.descripcion || '').toLowerCase();
    if (desc.includes('transferencia') || desc.includes('banco') || desc.includes('galicia') || desc.includes('bco') || desc.includes('cbu') || desc.includes('alias')) {
        return 'Transferencia';
    }
    if (desc.includes('cheque') || desc.includes('chq')) {
        return 'Cheque';
    }
    if (desc.includes('efectivo') || desc.includes('contado') || desc.includes('caja')) {
        return 'Efectivo';
    }

    if (mov.tipo_comprobante === 'RECIBO_PAGO') {
        return 'Efectivo';
    }

    return null;
};

/**
 * Actualiza el saldo de apertura (ajuste inicial) y recalcula los saldos de la cuenta
 */
exports.actualizarSaldoApertura = async (req, res) => {
    try {
        const { id } = req.params;
        const { saldo_apertura } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }

        const saldoAperturaNum = parseFloat(saldo_apertura);
        if (isNaN(saldoAperturaNum)) {
            return res.status(400).json({ success: false, error: 'El saldo de apertura debe ser un número válido.' });
        }

        console.log(`📝 [CC-CONTROLLER] Actualizando saldo de apertura para CC ID: ${id} a $${saldoAperturaNum}`);
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Actualizar saldo_apertura
            await client.query(
                `UPDATE public.factura_cuentas_corrientes 
                 SET saldo_apertura = $1 
                 WHERE id = $2`,
                [saldoAperturaNum, id]
            );

            // 2. Recalcular saldos de la cuenta
            await CuentaCorrienteService.recalcularSaldos(id, client);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        // Obtener cuenta actualizada
        const ccRes = await pool.query(
            `SELECT id, codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura, estado, creada_en, actualizada_en 
             FROM public.factura_cuentas_corrientes 
             WHERE id = $1`,
            [id]
        );

        res.json({
            success: true,
            data: ccRes.rows[0],
            message: 'Saldo de apertura actualizado y movimientos recalculados con éxito.'
        });
    } catch (error) {
        console.error(`❌ [CC-CONTROLLER] Error al actualizar saldo de apertura para CC ID ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: 'Error al actualizar el saldo de apertura.' });
    }
};

/**
 * Generar comprobante PDF individual de un movimiento (Factura/Nota de Crédito/Recibo)
 * GET /api/logistica/bunker/cuentas-corrientes/movimientos/:movimientoId/pdf
 */
exports.generarComprobantePdf = async (req, res) => {
    try {
        const { movimientoId } = req.params;
        console.log(`📄 [CC-CONTROLLER] Petición de generación de PDF para movimiento ID: ${movimientoId}`);

        // 1. Buscar el movimiento en la base de datos
        const queryMov = `
            SELECT m.*, cc.codigo_bunker_cliente, bc.razon_social, bc.cuit_cuil AS cuit 
            FROM public.factura_cuenta_corriente_movimientos m
            JOIN public.factura_cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
            LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente
            WHERE m.id = $1
        `;
        const resMov = await pool.query(queryMov, [parseInt(movimientoId)]);

        if (resMov.rows.length === 0) {
            return res.status(404).send('Movimiento no encontrado.');
        }

        const mov = resMov.rows[0];

        // 2. Determinar si es un comprobante de facturación (FC, NC, ND) o de pago (RC)
        const isFactura = ['FACTURA', 'FACTURA_A', 'NOTA_CREDITO', 'NOTA_DEBITO'].includes(mov.tipo_comprobante);

        if (isFactura && mov.comprobante_id) {
            // Es una factura o nota de crédito/débito. Llamamos al microservicio de facturación para obtener el PDF
            console.log(`🔄 [CC-CONTROLLER] Reenviando solicitud de PDF para Factura ID: ${mov.comprobante_id} al módulo de Facturación...`);
            try {
                const response = await fetch(`http://localhost:3004/facturacion/facturas/${mov.comprobante_id}/pdf`, {
                    method: 'POST'
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="comprobante_${mov.numero_comprobante || mov.id}.pdf"`);
                return res.send(buffer);
            } catch (err) {
                console.error(`❌ [CC-CONTROLLER] Error al obtener PDF de facturación para ID ${mov.comprobante_id}:`, err.message);
                return res.status(502).send('Error al comunicarse con el módulo de Facturación para generar el PDF.');
            }
        } else {
            // Es un recibo de pago o cobro (RECIBO_PAGO, COBRO_BANCARIO, COBRO_CHEQUE, AJUSTE_MANUAL, AJUSTE_AUTOMATICO, etc.)
            console.log(`📄 [CC-CONTROLLER] Generando recibo PDF en caliente para Movimiento ID: ${mov.id}`);
            
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 40, bottom: 25, left: 40, right: 40 },
                info: {
                    Title: `Recibo de Pago - ${mov.numero_comprobante || mov.id}`,
                    Author: 'LAMDA'
                }
            });

            const fechaArchivo = new Date(mov.fecha_movimiento).toISOString().split('T')[0].replace(/-/g, '');
            const filename = `recibo-${mov.id}-${fechaArchivo}.pdf`;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            
            doc.pipe(res);

            // === DIBUJAR CONTENIDO DEL RECIBO ===
            const pageWidth = doc.page.width;
            const leftColumn = 40;
            const contentWidth = pageWidth - 80;

            // 1. Cargar Logo
            const logoPath = path.join(__dirname, '../../facturacion/img/logo_LAMDA_grande.png');
            let hasLogo = false;
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, leftColumn, 40, { width: 90 });
                hasLogo = true;
            }

            // Datos de la empresa debajo del logo
            let companyY = 40 + (hasLogo ? 38 : 0);
            doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
            doc.text('Dirección: Calle 20 No. 638, La Plata', leftColumn, companyY);
            doc.text('Condición frente al IVA: Responsable Inscripto', leftColumn, companyY + 9);
            doc.text('Tel / WA: 221-6615746 | Email: administracion@lamda.com.ar', leftColumn, companyY + 18);

            // Letra R en recuadro para Recibo/Comprobante de Pago
            const boxWidth = 32;
            const boxHeight = 32;
            const boxX = (pageWidth / 2) - (boxWidth / 2);
            const boxY = 40;
            doc.save();
            doc.rect(boxX, boxY, boxWidth, boxHeight).fillColor('#8e4785').fill();
            doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff').text('R', boxX, boxY + 6, { width: boxWidth, align: 'center' });
            doc.restore();
            doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#8e4785').text('COMPROBANTE', (pageWidth / 2) - 50, boxY + boxHeight + 4, { width: 100, align: 'center' });

            // Línea divisoria vertical
            doc.moveTo(pageWidth / 2, boxY + boxHeight + 16)
               .lineTo(pageWidth / 2, 40 + 82)
               .strokeColor('#e2e8f0')
               .lineWidth(1)
               .stroke();

            // Columna Derecha - Datos del Comprobante
            let rightY = 40;
            const esAjuste = ['AJUSTE_MANUAL', 'AJUSTE_AUTOMATICO'].includes(mov.tipo_comprobante);
            const labelTitulo = esAjuste ? 'COMPROBANTE DE AJUSTE' : 'RECIBO DE PAGO';
            doc.fontSize(11).font('Helvetica-Bold').fillColor('#8e4785').text(labelTitulo, (pageWidth / 2) + 20, rightY);
            
            const nroComprobanteStr = mov.numero_comprobante ? mov.numero_comprobante : `REC-PAGO-${String(mov.id).padStart(8, '0')}`;
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text(`Nro: ${nroComprobanteStr}`, (pageWidth / 2) + 20, rightY + 14);
            
            const fechaFmt = new Date(mov.fecha_movimiento).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Fecha: ${fechaFmt}`, (pageWidth / 2) + 20, rightY + 26);
            doc.text(`Hora registro: ${new Date(mov.fecha_movimiento).toLocaleTimeString()}`, (pageWidth / 2) + 20, rightY + 35);
            doc.text(`Sistema: Autogestión LAMDA`, (pageWidth / 2) + 20, rightY + 44);

            // Línea divisoria horizontal debajo de la cabecera
            let lineY = Math.max(companyY + 32, rightY + 56);
            doc.moveTo(leftColumn, lineY)
               .lineTo(pageWidth - leftColumn, lineY)
               .strokeColor('#8e4785')
               .lineWidth(1.5)
               .stroke();

            // Bloque del Cliente
            let clientY = lineY + 12;
            doc.save();
            doc.rect(leftColumn, clientY, contentWidth, 54).fillColor('#f8fafc').fill();
            doc.rect(leftColumn, clientY, contentWidth, 54).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
            doc.restore();

            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b').text('DATOS DEL CLIENTE', leftColumn + 8, clientY + 6);
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(mov.razon_social || 'Cliente sin Razón Social', leftColumn + 8, clientY + 16);
            doc.fontSize(8).font('Helvetica').fillColor('#475569').text(`Código Búnker: ${mov.codigo_bunker_cliente || 'N/D'}`, leftColumn + 8, clientY + 28);
            if (mov.cuit) {
                doc.text(`CUIT: ${mov.cuit}`, leftColumn + 8, clientY + 38);
            }

            // Datos del Recibo
            let detailY = clientY + 70;
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#8e4785').text('Detalle del Movimiento', leftColumn, detailY);

            // Concepto y Monto
            const conceptoStr = mov.descripcion ? mov.descripcion : (esAjuste ? 'Ajuste de saldo de cuenta corriente' : 'Pago recibido - Cuenta Corriente');
            const conceptoHeight = doc.heightOfString(conceptoStr, { width: contentWidth - 140 });

            // Dibujar recuadro de detalles (altura dinámica)
            let tableTop = detailY + 16;
            let tableHeight = Math.max(90, 64 + conceptoHeight);
            doc.save();
            doc.rect(leftColumn, tableTop, contentWidth, tableHeight).fillColor('#ffffff').fill();
            doc.rect(leftColumn, tableTop, contentWidth, tableHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
            doc.restore();

            // Dibujar cabecera de la tabla
            doc.save();
            doc.rect(leftColumn, tableTop, contentWidth, 18).fillColor('#8e4785').fill();
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
            doc.text('Concepto / Razón del Movimiento', leftColumn + 8, tableTop + 5);
            doc.text('Monto', pageWidth - leftColumn - 108, tableTop + 5, { width: 100, align: 'right' });
            doc.restore();

            let rowY = tableTop + 24;
            doc.fontSize(9).font('Helvetica').fillColor('#1e293b').text(conceptoStr, leftColumn + 8, rowY, { width: contentWidth - 140 });

            const formatCurrency = (val) => {
                return new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: 'ARS'
                }).format(val);
            };
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#16a34a').text(formatCurrency(mov.monto), pageWidth - leftColumn - 108, rowY, { width: 100, align: 'right' });

            // Métodos de pago (si existen metadatos) con posicionamiento dinámico para evitar solapamientos
            let metaY = rowY + Math.max(conceptoHeight + 8, 30);
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#64748b').text('INFORMACIÓN DE COBRO:', leftColumn + 8, metaY);
            
            // Determinar forma de cobro por defecto según el tipo de comprobante
            let defaultTipo = 'Efectivo';
            if (mov.tipo_comprobante === 'COBRO_BANCARIO') defaultTipo = 'Transferencia';
            else if (mov.tipo_comprobante === 'COBRO_CHEQUE') defaultTipo = 'Cheque';
            else if (mov.tipo_comprobante === 'AJUSTE_MANUAL' || mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') defaultTipo = 'Ajuste de Saldo';

            let metaText = `Forma de cobro: ${defaultTipo}`;
            if (mov.metadatos) {
                const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                const tipoPago = meta.tipo_pago || defaultTipo;
                metaText = `Forma de cobro: ${tipoPago}`;
                if (meta.banco_origen) metaText += ` | Banco de origen: ${meta.banco_origen}`;
                if (meta.nro_operacion) metaText += ` | Operación Nro: ${meta.nro_operacion}`;
            }
            doc.fontSize(8).font('Helvetica').fillColor('#475569').text(metaText, leftColumn + 8, metaY + 10);

            // Cuadro de Totales y Saldo
            let totalsY = tableTop + tableHeight + 16;
            
            // Saldo de Cuenta
            doc.save();
            doc.rect(pageWidth - leftColumn - 180, totalsY, 180, 48).fillColor('#f1f5f9').fill();
            doc.rect(pageWidth - leftColumn - 180, totalsY, 180, 48).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.restore();

            doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text('SALDO DE CUENTA RESULTANTE', pageWidth - leftColumn - 172, totalsY + 8);
            doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e293b').text(formatCurrency(mov.saldo_resultante), pageWidth - leftColumn - 172, totalsY + 22, { width: 164, align: 'left' });

            // Leyenda de firmas/validez
            let footerY = totalsY + 80;
            doc.fontSize(7).font('Helvetica-Oblique').fillColor('#64748b').text(
                'Este documento sirve como constancia oficial de recepción de fondos en el sistema administrativo de la distribuidora. Generado desde el Portal de Clientes B2B.',
                leftColumn,
                footerY,
                { align: 'center', width: contentWidth }
            );

            doc.end();
        }
    } catch (error) {
        console.error(`❌ [CC-CONTROLLER] Error al generar PDF para movimiento ID ${req.params.movimientoId}:`, error);
        res.status(500).send('Error interno al generar el PDF del comprobante.');
    }
};
