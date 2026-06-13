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
        if (clienteObj.whatsapp_facturas) {
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
            const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: whatsappDestinos,
                    pdfBase64: pdfBase64,
                    filename: `cuenta_corriente_${clienteObj.codigo_bunker_cliente}.pdf`,
                    mensajeTexto: `Hola! Te enviamos adjunto el extracto de tu Cuenta Corriente emitido por LAMDA. Saludos y muchas gracias.`
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

/**
 * Listar presupuestos pendientes del Puesto 007 para incorporar
 */
exports.listarPresupuestosPendientes007 = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, error: 'El ID de la cuenta corriente es obligatorio.' });
        }
        console.log(`🔍 [CC-CONTROLLER] Buscando presupuestos 007 pendientes para CC ID: ${id}`);
        const presupuestos = await CuentaCorrienteService.obtenerPresupuestosPendientes007(parseInt(id));
        res.json({ success: true, data: presupuestos });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al listar presupuestos 007:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Incorporar manualmente un presupuesto del Puesto 007
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
        const movimiento = await CuentaCorrienteService.incorporarPresupuesto007(parseInt(id), parseInt(presupuesto_id));
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
        if (mov.tipo_comprobante === 'FACTURA') {
            if (mov.comprobante_id) {
                try {
                    // 1. Obtener items
                    const itemsRes = await pool.query(
                        'SELECT descripcion, qty, p_unit, imp_neto FROM public.factura_factura_items WHERE factura_id = $1 ORDER BY orden ASC',
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
                    // 1. Obtener items desde presupuestos_detalles
                    const itemsRes = await pool.query(
                        'SELECT articulo AS descripcion, cantidad AS qty, precio1 AS p_unit, (cantidad * precio1) AS imp_neto FROM public.presupuestos_detalles WHERE id_presupuesto = $1',
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
        labelDeuda = 'Saldo Deudor ⚠️';
        labelColor = '#b91c1c';
    } else if (finalSaldo < 0) {
        labelDeuda = 'Saldo a Favor 💰';
        labelColor = '#047857';
    }

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#8e4785').text('ESTADO CONSOLIDADO', balanceBoxX + 12, yPos + 6);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(labelColor).text(labelDeuda.toUpperCase(), balanceBoxX + 12, yPos + 18);
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#8e4785').text(`BALANCE: ${formatCurrency(finalSaldo)}`, balanceBoxX + 12, yPos + 30);

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
    
    for (let index = 0; index < movimientos.length; index++) {
        const mov = movimientos[index];
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
        } else if (mov.tipo_comprobante === 'RECIBO_PAGO') {
            tipoComp = 'Pago';
        } else if (mov.tipo_comprobante === 'AJUSTE_MANUAL') {
            tipoComp = 'Ajuste';
        } else if (mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') {
            tipoComp = 'Ajuste Aut.';
        }

        // Calcular altura de la caja detallada si corresponde
        const esDetalladoFactura = detallado && mov.tipo_comprobante === 'FACTURA';
        const detailedBoxHeight = esDetalladoFactura ? (45 + (mov.items ? mov.items.length * 13 : 13) + 35) : 0;
        
        // Control de salto de página antes de renderizar la fila para mantener el bloque unido
        if (yPos > doc.page.height - 85 - detailedBoxHeight) {
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
        
        let desc = mov.descripcion || 'Sin concepto';
        if (mov.tipo_comprobante === 'RECIBO_PAGO') {
            let tipoPago = 'Efectivo';
            if (mov.metadatos) {
                try {
                    const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                    if (meta && meta.tipo_pago) {
                        tipoPago = meta.tipo_pago;
                    }
                } catch (e) {
                    console.error('Error al parsear metadatos del recibo en PDF:', e);
                }
            }
            desc = `Recibo de Pago - ${tipoPago}`;
        }
        if (desc.length > 38) {
            desc = desc.substring(0, 35) + '...';
        }
        doc.font('Helvetica-Bold').text(desc, leftColumn + 80, yPos).font('Helvetica');
        
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
        
        yPos += 14;

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
                mov.items.forEach(item => {
                    doc.text(item.descripcion, leftColumn + 25, boxYPos);
                    doc.text(parseFloat(item.qty).toFixed(0), leftColumn + 260, boxYPos, { width: 30, align: 'right' });
                    doc.text(formatCurrency(parseFloat(item.p_unit)), leftColumn + 300, boxYPos, { width: 60, align: 'right' });
                    doc.text(formatCurrency(parseFloat(item.imp_neto)), leftColumn + 370, boxYPos, { width: 60, align: 'right' });
                    boxYPos += 13;
                });
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
