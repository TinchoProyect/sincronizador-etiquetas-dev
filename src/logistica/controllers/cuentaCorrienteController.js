/**
 * Controlador de Cuentas Corrientes
 * Expone los endpoints HTTP CRUD para interactuar con las cuentas corrientes y sus movimientos.
 */

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLibDoc } = require('pdf-lib');
const { pool } = require('../config/database');
const CuentaCorrienteService = require('../services/cuentaCorrienteService');
const ClientesBunkerModel = require('../models/clientesBunkerModel');
try {
    delete require.cache[require.resolve('../services/composicionSaldoService')];
    delete require.cache[require.resolve('../services/salvavidasService')];
    const cachedPagosEfectivo = require.cache[require.resolve('../services/pagosEfectivoService')]?.exports;
    delete require.cache[require.resolve('../services/pagosEfectivoService')];
    const freshPagosEfectivo = require('../services/pagosEfectivoService');
    if (cachedPagosEfectivo && freshPagosEfectivo) {
        cachedPagosEfectivo.aprobarYAcreditar = freshPagosEfectivo.aprobarYAcreditar;
        require.cache[require.resolve('../services/pagosEfectivoService')].exports = cachedPagosEfectivo;
    }
} catch (e) {}
const composicionSaldoService = require('../services/composicionSaldoService');
const salvavidasService = require('../services/salvavidasService');

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
exports.facturarInteresPago = async (req, res) => {
    try {
        const { id } = req.params;
        const { pago_mov_id, modo_facturacion } = req.body || {};
        if (!id || !pago_mov_id) {
            return res.status(400).json({
                success: false,
                error: 'Los parámetros id (cuenta corriente) y pago_mov_id son obligatorios.'
            });
        }
        const resultado = await salvavidasService.emitirFacturaInteresPago(
            parseInt(id, 10),
            parseInt(pago_mov_id, 10),
            modo_facturacion || 'INTERNA',
            pool
        );
        return res.json({
            success: true,
            data: resultado,
            message: resultado.modo_facturacion === 'ARCA'
                ? 'Factura Oficial ARCA de Servicio de Financiación emitida y asentada en Cuenta Corriente.'
                : 'Facturación Interna (Sin ARCA) de Servicio de Financiación emitida y asentada en Cuenta Corriente.'
        });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al facturar interés de pago:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Error al facturar el servicio de financiación.'
        });
    }
};

exports.registrarMovimientoManual = async (req, res) => {
    try {
        if (req.body && req.body.accion === 'FACTURAR_INTERES_PAGO') {
            return exports.facturarInteresPago(req, res);
        }
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
 * Filtra el conjunto de movimientos ordenados cronológicamente descendente
 * según el criterio seleccionado: todo el historial, último saldo cero inteligente, o movimiento específico.
 */
function filtrarMovimientosPorRango(movimientosOrdenados, { modo_corte, desde_movimiento_id, desde_ultimo_cero }) {
    if (!movimientosOrdenados || movimientosOrdenados.length === 0) return movimientosOrdenados;

    // 1. Corte por movimiento específico
    if (modo_corte === 'movimiento' && desde_movimiento_id) {
        const idx = movimientosOrdenados.findIndex(m => String(m.id) === String(desde_movimiento_id));
        if (idx !== -1) {
            console.log(`📌 [CC-CONTROLLER] Recortando desde movimiento ID ${desde_movimiento_id} (Índice: ${idx}, Total: ${idx + 1} ítems de ${movimientosOrdenados.length})`);
            return movimientosOrdenados.slice(0, idx + 1);
        }
    }

    // 2. Corte por último saldo cero (inteligente)
    if (modo_corte === 'ultimo_cero' || desde_ultimo_cero === true || desde_ultimo_cero === 'true') {
        const saldoReciente = Math.abs(parseFloat(
            movimientosOrdenados[0].saldo_resultante !== undefined ? movimientosOrdenados[0].saldo_resultante : (movimientosOrdenados[0].saldo_acumulado || 0)
        ));

        // Si el movimiento más reciente ya saldó la cuenta a $0 (ej: ajuste o pago reciente)
        if (saldoReciente < 0.01) {
            // Buscamos hacia atrás el primer movimiento con saldo distinto de cero
            const idxNonZero = movimientosOrdenados.findIndex(m => {
                const val = Math.abs(parseFloat(m.saldo_resultante !== undefined ? m.saldo_resultante : (m.saldo_acumulado || 0)));
                return val >= 0.01;
            });

            if (idxNonZero !== -1) {
                // Buscamos el saldo cero anterior que dio inicio al ciclo que culminó en el cero actual
                const idxPrevZero = movimientosOrdenados.findIndex((m, i) => {
                    if (i <= idxNonZero) return false;
                    const val = Math.abs(parseFloat(m.saldo_resultante !== undefined ? m.saldo_resultante : (m.saldo_acumulado || 0)));
                    return val < 0.01;
                });

                if (idxPrevZero !== -1) {
                    console.log(`✂️ [CC-CONTROLLER] Saldo reciente es $0. Recortando desde saldo cero PREVIO (Índice: ${idxPrevZero}, Total: ${idxPrevZero + 1} ítems de ${movimientosOrdenados.length})`);
                    return movimientosOrdenados.slice(0, idxPrevZero + 1);
                } else {
                    console.log(`✂️ [CC-CONTROLLER] Saldo reciente es $0 y no hubo cero anterior. Mostrando ciclo completo inicial (${movimientosOrdenados.length} ítems)`);
                    return movimientosOrdenados;
                }
            } else {
                return movimientosOrdenados;
            }
        }

        // Si la cuenta tiene saldo deudor o a favor actualmente (saldoReciente >= 0.01)
        const idxZero = movimientosOrdenados.findIndex(m => {
            const val = Math.abs(parseFloat(m.saldo_resultante !== undefined ? m.saldo_resultante : (m.saldo_acumulado !== undefined ? m.saldo_acumulado : 0)));
            return val < 0.01;
        });

        if (idxZero !== -1) {
            console.log(`✂️ [CC-CONTROLLER] Recortando desde el último saldo cero (Índice: ${idxZero}, Total: ${idxZero + 1} ítems de ${movimientosOrdenados.length})`);
            return movimientosOrdenados.slice(0, idxZero + 1);
        }

        return movimientosOrdenados;
    }

    // 3. Todo el historial (modo_corte === 'todo' o por defecto)
    return movimientosOrdenados;
}

/**
 * Generar reporte PDF de la cuenta corriente y transmitirlo al navegador
 */
exports.generarReportePdf = async (req, res) => {
    try {
        if (req.query && (req.query.tipo_doc === 'politicas_financiacion' || req.query.tipo_doc === 'politicas')) {
            return exports.generarPoliticasFinanciacionCuentaPdf(req, res);
        }
        const { id } = req.params;
        const detallado = req.query.detallado === 'true';
        const desde_ultimo_cero = req.query.desde_ultimo_cero === 'true';
        const detallar_balance = req.query.detallar_balance !== 'false';
        const modo_corte = req.query.modo_corte || (desde_ultimo_cero ? 'ultimo_cero' : 'todo');
        const desde_movimiento_id = req.query.desde_movimiento_id || null;
        
        console.log(`📄 [CC-CONTROLLER] Petición de generación de PDF para CC ID: ${id} (Detallado: ${detallado}, Modo corte: ${modo_corte}, Desde mov ID: ${desde_movimiento_id}, Detallar Balance: ${detallar_balance})`);

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
        let movimientosOrdenados = [...movimientos].sort((a, b) => {
            const dateDiff = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
            if (dateDiff !== 0) return dateDiff;
            return b.id - a.id;
        });

        movimientosOrdenados = filtrarMovimientosPorRango(movimientosOrdenados, {
            modo_corte,
            desde_movimiento_id,
            desde_ultimo_cero
        });

        if (detallado || detallar_balance) {
            await cargarDetallesMovimientos(movimientosOrdenados);
        }

        // 3. Calcular composición determinista y simulación Salvavidas (4 etapas LAMDA) si está habilitado
        let composicionInfo = null;
        let salvavidasInfo = null;
        if (detallar_balance) {
            try {
                composicionInfo = await composicionSaldoService.calcularComposicionSaldo(cuentaObj.id, pool);
                salvavidasInfo = await salvavidasService.calcularSimulacionCuenta(cuentaObj.id, { persistir_sombra: false }, pool);
            } catch (compErr) {
                console.warn('⚠️ [CC-CONTROLLER] Error al calcular composicion/salvavidas para PDF:', compErr.message);
            }
        }
        
        // 4. Obtener cliente
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(cuentaObj.codigo_bunker_cliente);
        if (!clienteObj) {
            return res.status(404).send('Cliente no encontrado.');
        }
        
        // 5. Instanciar PDFKit y configurar headers
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
        
        // 6. Construir contenido
        construirDocumentoPdf(doc, cuentaObj, movimientosOrdenados, clienteObj, detallado, composicionInfo, detallar_balance, salvavidasInfo);
        
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
        const desde_ultimo_cero = req.query.desde_ultimo_cero === 'true' || req.body.desde_ultimo_cero === 'true';
        const detallar_balance = req.query.detallar_balance !== 'false' && req.body.detallar_balance !== false;
        const modo_corte = req.query.modo_corte || req.body.modo_corte || (desde_ultimo_cero ? 'ultimo_cero' : 'todo');
        const desde_movimiento_id = req.query.desde_movimiento_id || req.body.desde_movimiento_id || null;
        
        console.log(`📱 [CC-CONTROLLER] Petición de envío de WhatsApp para CC ID: ${id} (Detallado: ${detallado}, Modo corte: ${modo_corte}, Desde mov ID: ${desde_movimiento_id}, Detallar Balance: ${detallar_balance})`);

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
        let movimientosOrdenados = [...movimientos].sort((a, b) => {
            const dateDiff = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
            if (dateDiff !== 0) return dateDiff;
            return b.id - a.id;
        });

        movimientosOrdenados = filtrarMovimientosPorRango(movimientosOrdenados, {
            modo_corte,
            desde_movimiento_id,
            desde_ultimo_cero
        });

        if (detallado) {
            await cargarDetallesMovimientos(movimientosOrdenados);
        }
        
        // 3. Obtener cliente
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(cuentaObj.codigo_bunker_cliente);
        if (!clienteObj) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
        }

        // 4. Calcular composición determinista y simulación Salvavidas si aplica
        let composicionInfo = null;
        let salvavidasInfo = null;
        if (detallar_balance) {
            try {
                composicionInfo = await composicionSaldoService.calcularComposicionSaldo(cuentaObj.id, pool);
                salvavidasInfo = await salvavidasService.calcularSimulacionCuenta(cuentaObj.id, { persistir_sombra: false }, pool);
            } catch (compErr) {
                console.warn('⚠️ [CC-CONTROLLER] Error al calcular composicion/salvavidas para WhatsApp:', compErr.message);
            }
        }

        // 5. Resolver números telefónicos de WhatsApp en la ficha del cliente
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

        // 6. Generar PDF en Buffer
        console.log(`📄 [CC-CONTROLLER] Generando PDF de cuenta corriente en memoria para ${clienteObj.codigo_bunker_cliente}...`);
        const pdfBuffer = await generarPdfBuffer(cuentaObj, movimientosOrdenados, clienteObj, detallado, composicionInfo, detallar_balance, salvavidasInfo);
        const pdfBase64 = pdfBuffer.toString('base64');

        // 7. Enviar al microservicio en Facturación con timeout controlado de 8 segundos
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
            if (esChequeReciente) {
                filename = `comprobante_cheque_${clienteObj.codigo_bunker_cliente}.pdf`;
            }

            let mensajeTexto = req.body.mensajeTexto;
            if (!mensajeTexto || !mensajeTexto.trim()) {
                // El detalle grueso (comprobantes, plazos, pagos parciales, beneficios de lista y CBU) va íntegro dentro del PDF.
                // El cuerpo del mensaje de WhatsApp se mantiene corto y directo.
                mensajeTexto = `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;

                if (esChequeReciente) {
                    mensajeTexto = `Te adjunto en PDF el comprobante de validación de cheque y el resumen de tu cuenta corriente.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
                }
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

function limpiarDocWhatsapp(desc) {
    if (!desc) return 'Comprobante';
    let clean = desc.split('(')[0].trim();
    clean = clean.replace(/(\b\d{4}-)0*(\d+)/, '$2');
    return clean;
}

function formatMontoWhatsapp(v) {
    const num = Math.abs(v || 0);
    const parts = num.toFixed(2).split('.');
    const formattedInt = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `$ ${formattedInt},${parts[1]}`;
}

function formatFechaCortaAR(val) {
    if (!val) return '-';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Construye un recuadro sintético en formato WhatsApp (> ) indicando
 * el diagnóstico de comprobantes pendientes y las 4 etapas de financiación LAMDA.
 */
function construirAvisoSaldoExcedido(composicionInfo, saldoTotal, salvavidasInfo = null) {
    if (saldoTotal <= 0.005) return '';

    const capasSim = (salvavidasInfo && Array.isArray(salvavidasInfo.capas_simuladas) && salvavidasInfo.capas_simuladas.length > 0)
        ? salvavidasInfo.capas_simuladas
        : null;

    if (capasSim && salvavidasInfo.reglas_aplicadas && salvavidasInfo.reglas_aplicadas.habilitado) {
        const reglas = salvavidasInfo.reglas_aplicadas;
        const modoSwitch = reglas.modo_switch || 'ACTIVO';
        const esSombra = modoSwitch === 'SOMBRA';
        const diasEst = reglas.dias_ventana_estandar || 7;
        const diasGracia = reglas.dias_gracia_natural || 3;
        const diasTopeGracia = reglas.dias_tope_sin_comodin || 10;
        const diasComodin = reglas.dias_total_cortesia || 14;
        const tasaPct = reglas.tasa_servicio_financiero || 3;
        const comodinesDisp = reglas.cortesias_disponibles_anio ?? 3;
        const cupoAnual = reglas.cupo_cortesias_anual ?? 3;
        const comodinesUsados = reglas.cortesias_usadas_anio ?? 0;

        const finCalcNeta = Number(salvavidasInfo.financiacion_calculada_neta ?? salvavidasInfo.financiacion_total ?? 0);
        const finCalcIva = Number(salvavidasInfo.financiacion_calculada_iva ?? salvavidasInfo.financiacion_iva ?? 0);
        const finCalcConIva = Number(salvavidasInfo.financiacion_calculada_con_iva ?? salvavidasInfo.financiacion_total_con_iva ?? 0);

        const lineas = [];
        lineas.push(`> 📌 *Diagnóstico de Cuenta y Plazos LAMDA${esSombra ? ' (Modo Informativo)' : ''} (Comodines año: ${comodinesDisp}/${cupoAnual} disp.):*`);

        for (const cs of capasSim) {
            const doc = limpiarDocWhatsapp(cs.descripcion);
            const fEnt = formatFechaCortaAR(cs.punto_cero);
            const f7d = formatFechaCortaAR(cs.fecha_vto_compromiso);
            const f10d = formatFechaCortaAR(cs.fecha_vto_gracia_natural);
            const f14d = formatFechaCortaAR(cs.fecha_vto_comodin);

            let estadoTag = '';
            if (cs.ventana_codigo === 'ASISTENCIA_FORMALIZADA') {
                estadoTag = esSombra
                    ? `🌓 *Día ${cs.antiguedad_dias} · Simulación Informativa* (+${formatMontoWhatsapp(cs.interes_financiacion)} + IVA ${formatMontoWhatsapp(cs.iva_financiacion)} = *${formatMontoWhatsapp(cs.interes_financiacion_con_iva)}*)`
                    : `🛡️ *Día ${cs.antiguedad_dias} · Financiación Activa* (+${formatMontoWhatsapp(cs.interes_financiacion)} + IVA ${formatMontoWhatsapp(cs.iva_financiacion)} = *${formatMontoWhatsapp(cs.interes_financiacion_con_iva)}*)`;
            } else if (cs.ventana_codigo === 'ASISTENCIA_CORTESIA') {
                estadoTag = `🎟️ *Día ${cs.antiguedad_dias}/${diasComodin} · Comodín Trimestral* (0% financiación bonificado)`;
            } else if (cs.ventana_codigo === 'GRACIA_NATURAL') {
                estadoTag = `⏳ *Día ${cs.antiguedad_dias}/${diasTopeGracia} · +${diasGracia}d Gracia Natural* (0% financiación · Sin usar comodín)`;
            } else {
                estadoTag = `🟢 *Día ${cs.antiguedad_dias}/${diasEst} · Compromiso Habitual* (0% financiación)`;
            }

            lineas.push(`> • *${doc}* (${formatMontoWhatsapp(cs.capital_pendiente)}): ${estadoTag}`);
            lineas.push(`>   _Entrega: ${fEnt} · 7d: ${f7d} · +3d Gracia: ${f10d} · Tope Comodín 14d: ${f14d}_`);
        }

        if (!esSombra && salvavidasInfo.financiacion_total_con_iva > 0) {
            lineas.push(`> 🛡️ *Financiación LAMDA (${tasaPct}% mensual + IVA = 0,1%/día + IVA):* ${formatMontoWhatsapp(salvavidasInfo.financiacion_total)} neto + IVA ${formatMontoWhatsapp(salvavidasInfo.financiacion_iva)} = *${formatMontoWhatsapp(salvavidasInfo.financiacion_total_con_iva)}*.`);
            lineas.push(`> 💰 *Total Real Actualizado a Pagar Hoy (c/IVA): ${formatMontoWhatsapp(salvavidasInfo.saldo_total_proyectado_con_iva)}*`);
        } else if (esSombra && finCalcConIva > 0) {
            lineas.push(`> 🌓 *Simulación Informativa de Financiación (${tasaPct}% mensual + IVA):* ${formatMontoWhatsapp(finCalcNeta)} neto + IVA ${formatMontoWhatsapp(finCalcIva)} = *${formatMontoWhatsapp(finCalcConIva)}* _(A modo informativo, sin cargo efectivo hoy)_.`);
            lineas.push(`> 💰 *Saldo de Capital Exigible Hoy: ${formatMontoWhatsapp(saldoTotal)}* _(Total simulado c/IVA: ${formatMontoWhatsapp(saldoTotal + finCalcConIva)})_`);
        } else {
            lineas.push(`> ✅ *Financiación actual: $ 0,00 (100% bonificada dentro de plazos).*`);
        }

        lineas.push(`> ℹ️ _Esquema LAMDA: 1-${diasEst}d Compromiso (0%) · ${diasEst + 1}-${diasTopeGracia}d Gracia Natural +${diasGracia}d (0% sin comodín) · ${diasTopeGracia + 1}-${diasComodin}d Comodín Trimestral (1 c/3 meses, ${comodinesUsados}/${cupoAnual} usado) · Día ${diasComodin + 1}+ Salvavidas (${tasaPct}% mensual + IVA desde Día 1)._`);

        return '\n\n' + lineas.join('\n');
    }

    if (!composicionInfo || !composicionInfo.capas || composicionInfo.capas.length === 0) return '';

    // Fallback clásico para cuentas exentas
    const capasExcedidas = composicionInfo.capas.filter(c => c.antiguedad_dias > 7);
    if (capasExcedidas.length === 0) return '';

    const lineas = [];
    lineas.push('> ⏱️ *Detalle de saldo excedido:*');

    for (const c of capasExcedidas) {
        const doc = limpiarDocWhatsapp(c.descripcion);
        const diasLabel = c.antiguedad_dias === 1 ? '1 día' : `${c.antiguedad_dias} días`;
        lineas.push(`> • *${formatMontoWhatsapp(c.monto_pendiente)}* (${doc}): lleva *${diasLabel}* desde la entrega.`);
    }

    return '\n\n' + lineas.join('\n');
}

/**
 * Construye un recuadro HTML con formato institucional para el correo electrónico indicando
 * el diagnóstico de cuenta y las 4 etapas de financiación LAMDA.
 */
function construirAvisoSaldoExcedidoHtml(composicionInfo, saldoTotal, salvavidasInfo = null) {
    if (saldoTotal <= 0.005) return '';

    const capasSim = (salvavidasInfo && Array.isArray(salvavidasInfo.capas_simuladas) && salvavidasInfo.capas_simuladas.length > 0)
        ? salvavidasInfo.capas_simuladas
        : null;

    if (capasSim && salvavidasInfo.reglas_aplicadas && salvavidasInfo.reglas_aplicadas.habilitado) {
        const reglas = salvavidasInfo.reglas_aplicadas;
        const diasEst = reglas.dias_ventana_estandar || 7;
        const diasGracia = reglas.dias_gracia_natural || 3;
        const diasTopeGracia = reglas.dias_tope_sin_comodin || 10;
        const diasComodin = reglas.dias_total_cortesia || 14;
        const tasaPct = reglas.tasa_servicio_financiero || 3;
        const comodinesDisp = reglas.cortesias_disponibles_anio ?? 3;
        const cupoAnual = reglas.cupo_cortesias_anual ?? 3;

        const listItems = capasSim.map(cs => {
            const doc = limpiarDocWhatsapp(cs.descripcion);
            const fEnt = formatFechaCortaAR(cs.punto_cero);
            const f7d = formatFechaCortaAR(cs.fecha_vto_compromiso);
            const f10d = formatFechaCortaAR(cs.fecha_vto_gracia_natural);
            const f14d = formatFechaCortaAR(cs.fecha_vto_comodin);
            let badgeHtml = '';
            if (cs.ventana_codigo === 'ASISTENCIA_FORMALIZADA') {
                badgeHtml = `<span style="color:#b45309;font-weight:700;">🛡️ Día ${cs.antiguedad_dias} · Financiación Activa (+${formatMontoWhatsapp(cs.interes_financiacion)} + IVA ${formatMontoWhatsapp(cs.iva_financiacion)} = ${formatMontoWhatsapp(cs.interes_financiacion_con_iva)})</span>`;
            } else if (cs.ventana_codigo === 'ASISTENCIA_CORTESIA') {
                badgeHtml = `<span style="color:#0369a1;font-weight:700;">🎟️ Día ${cs.antiguedad_dias}/${diasComodin} · Comodín Trimestral (0% financiación)</span>`;
            } else if (cs.ventana_codigo === 'GRACIA_NATURAL') {
                badgeHtml = `<span style="color:#0f766e;font-weight:700;">⏳ Día ${cs.antiguedad_dias}/${diasTopeGracia} · +${diasGracia}d Gracia Natural (0% · Sin comodín)</span>`;
            } else {
                badgeHtml = `<span style="color:#047857;font-weight:700;">🟢 Día ${cs.antiguedad_dias}/${diasEst} · Compromiso Habitual (0% financiación)</span>`;
            }
            return `<li style="margin-bottom:8px;">
                <strong>${doc}</strong> (Capital: <strong>${formatMontoWhatsapp(cs.capital_pendiente)}</strong>) — ${badgeHtml}<br/>
                <span style="font-size:12px;color:#64748b;">Entrega: ${fEnt} · 7d Compromiso: ${f7d} · +3d Gracia: ${f10d} · Tope Comodín 14d: ${f14d}</span>
            </li>`;
        }).join('');

        const totalBoxHtml = salvavidasInfo.financiacion_total_con_iva > 0
            ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #fcd34d;font-size:13.5px;color:#78350f;">
                <strong>Capital Comprobantes:</strong> ${formatMontoWhatsapp(saldoTotal)} + <strong>Financiación ${tasaPct}% + IVA:</strong> ${formatMontoWhatsapp(salvavidasInfo.financiacion_total_con_iva)}<br/>
                <strong style="color:#dc2626;font-size:15px;">Total Real Actualizado a Pagar Hoy (c/IVA): ${formatMontoWhatsapp(salvavidasInfo.saldo_total_proyectado_con_iva)}</strong>
               </div>`
            : `<div style="margin-top:8px;font-size:12.5px;color:#047857;font-weight:700;">✅ Financiación actual: $ 0,00 (100% bonificada dentro de plazos).</div>`;

        return `
        <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px 16px; margin: 20px 0;">
            <div style="font-size: 12px; font-weight: 700; color: #b45309; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                📌 Diagnóstico de Cuenta y Esquema de Financiación LAMDA (Comodines Año: ${comodinesDisp}/${cupoAnual} disp.)
            </div>
            <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #1e293b; line-height: 1.45;">${listItems}</ul>
            ${totalBoxHtml}
            <div style="margin-top:8px;font-size:11.5px;color:#64748b;line-height:1.4;">
                <strong>Esquema LAMDA:</strong> 1-${diasEst}d Compromiso (0%) · ${diasEst + 1}-${diasTopeGracia}d +${diasGracia}d Gracia Natural (0% sin comodín) · ${diasTopeGracia + 1}-${diasComodin}d Comodín Trimestral (1 c/3 meses a 0%) · Día ${diasComodin + 1}+ Salvavidas (${tasaPct}% mensual + IVA desde Día 1).
            </div>
        </div>
        `;
    }

    if (!composicionInfo || !composicionInfo.capas || composicionInfo.capas.length === 0) return '';
    const capasExcedidas = composicionInfo.capas.filter(c => c.antiguedad_dias > 7);
    if (capasExcedidas.length === 0) return '';

    const listItems = capasExcedidas.map(c => {
        const doc = limpiarDocWhatsapp(c.descripcion);
        const diasLabel = c.antiguedad_dias === 1 ? '1 día' : `${c.antiguedad_dias} días`;
        return `<li style="margin-bottom: 5px;"><strong style="color: #b45309;">${formatMontoWhatsapp(c.monto_pendiente)}</strong> (<em>${doc}</em>): lleva <strong>${diasLabel}</strong> desde la entrega.</li>`;
    }).join('');

    return `
    <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px 16px; margin: 20px 0;">
        <div style="font-size: 12px; font-weight: 700; color: #b45309; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
            <span>⏱️ Detalle de Saldo Excedido</span>
        </div>
        <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #78350f; line-height: 1.5;">${listItems}</ul>
    </div>
    `;
}

/**
 * Obtener mensaje de WhatsApp predeterminado compilado
 */
exports.obtenerMensajePredeterminadoWhatsapp = async (req, res) => {
    try {
        const { id } = req.params;
        const detallarBalance = req.query.detallar_balance !== 'false';
        
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

        const ultimoMov = movimientosOrdenados[0];
        const esChequeReciente = ultimoMov && (
            ultimoMov.tipo_comprobante === 'COBRO_CHEQUE' ||
            obtenerMedioPago(ultimoMov) === 'Cheque'
        );

        // 3. Calcular composición determinista de saldo y simulación Salvavidas
        let composicionInfo = null;
        let salvavidasInfo = null;
        if (detallarBalance) {
            try {
                composicionInfo = await composicionSaldoService.calcularComposicionSaldo(parseInt(id), pool);
                salvavidasInfo = await salvavidasService.calcularSimulacionCuenta(parseInt(id), { persistir_sombra: false }, pool);
            } catch (compErr) {
                console.warn('⚠️ [CC-CONTROLLER] No se pudo calcular composición/salvavidas para WhatsApp:', compErr.message);
            }
        }

        // Toda la explicación gruesa (saldo, comprobantes, 4 etapas, pagos parciales, 5% OFF con saldo $0 y CBU) va adentro del PDF.
        // El cuerpo del mensaje de WhatsApp se mantiene corto: indica que se adjunta el PDF y deja el link del portal.
        let mensajeTexto = `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;

        if (esChequeReciente) {
            mensajeTexto = `Te adjunto en PDF el comprobante de validación de cheque y el resumen de tu cuenta corriente.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
        }

        res.json({ success: true, mensajeTexto, composicion: composicionInfo, salvavidas: salvavidasInfo });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en obtenerMensajePredeterminadoWhatsapp:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo mensaje predeterminado.' });
    }
};

/**
 * Obtener la composición de saldo por capas y factor tiempo (Punto Cero Logístico)
 */
exports.obtenerComposicionSaldo = async (req, res) => {
    try {
        const { id } = req.params;
        const cuentaId = parseInt(id);
        if (isNaN(cuentaId)) {
            return res.status(400).json({ success: false, error: 'ID de cuenta inválido.' });
        }

        const data = await composicionSaldoService.calcularComposicionSaldo(cuentaId, pool);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Cuenta corriente no encontrada.' });
        }

        if (req.query && req.query.simular_monto !== undefined) {
            data.simulacion_pago = await composicionSaldoService.simularImputacionPago(cuentaId, parseFloat(req.query.simular_monto) || 0, pool);
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en obtenerComposicionSaldo:', error);
        res.status(500).json({ success: false, error: 'Error calculando composición de saldo y factor tiempo.' });
    }
};

/**
 * Simular la imputación de un pago entrante sobre una cuenta corriente (Capital vs. Interés / Opción de Bonificar)
 * GET /api/logistica/bunker/cuentas-corrientes/:id/simular-imputacion-pago?monto=XXXX
 */
exports.simularImputacionPagoCuenta = async (req, res) => {
    try {
        const { id } = req.params;
        const monto = parseFloat(req.query.monto) || 0;
        const cuentaId = parseInt(id);
        if (isNaN(cuentaId)) {
            return res.status(400).json({ success: false, error: 'ID de cuenta inválido.' });
        }

        const data = await composicionSaldoService.simularImputacionPago(cuentaId, monto, pool);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Cuenta corriente no encontrada.' });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en simularImputacionPagoCuenta:', error);
        res.status(500).json({ success: false, error: 'Error simulando imputación del pago.' });
    }
};

/**
 * Obtener la proyección de financiación en modo sombra ("Servicio Salvavidas") para una cuenta
 */
exports.obtenerSimulacionSalvavidas = async (req, res) => {
    try {
        const { id } = req.params;
        const persistir = req.query.persistir === 'true';
        const cuentaId = parseInt(id);
        if (isNaN(cuentaId)) {
            return res.status(400).json({ success: false, error: 'ID de cuenta inválido.' });
        }

        const data = await salvavidasService.calcularSimulacionCuenta(cuentaId, { persistir_sombra: persistir }, pool);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Cuenta corriente no encontrada.' });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en obtenerSimulacionSalvavidas:', error);
        res.status(500).json({ success: false, error: 'Error al calcular la simulación de financiación.' });
    }
};

/**
 * Obtener Dashboard de Métricas Sombra para toda la cartera
 */
exports.obtenerDashboardSalvavidas = async (req, res) => {
    try {
        const data = await salvavidasService.obtenerDashboardMetricasSombra(pool);
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en obtenerDashboardSalvavidas:', error);
        res.status(500).json({ success: false, error: 'Error al generar métricas consolidadas del Servicio Salvavidas.' });
    }
};

/**
 * Actualizar configuración de excepción comercial para un cliente
 */
exports.actualizarConfiguracionClienteSalvavidas = async (req, res) => {
    try {
        const { codigo } = req.params;
        const data = await salvavidasService.actualizarConfiguracionCliente(codigo, req.body, pool);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
        }
        // Sincronizar automáticamente hacia el Portal B2B en segundo plano
        try {
            const { spawn } = require('child_process');
            const scriptPath = path.join(__dirname, '../../actualizaPrecios/syncB2BCuentas.js');
            const child = spawn('node', [scriptPath], { detached: true, stdio: 'ignore' });
            child.unref();
        } catch (syncErr) {
            console.warn('⚠️ [CC-CONTROLLER] No se pudo lanzar syncB2BCuentas en background:', syncErr.message);
        }
        res.json({ success: true, data, message: 'Configuración comercial de financiación actualizada con éxito.' });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en actualizarConfiguracionClienteSalvavidas:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar configuración de cliente.' });
    }
};

/**
 * Obtener parámetros globales del Servicio Salvavidas
 */
exports.obtenerConfiguracionGlobalSalvavidas = async (req, res) => {
    try {
        const data = await salvavidasService.obtenerConfiguracionGlobal(pool);
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en obtenerConfiguracionGlobalSalvavidas:', error);
        res.status(500).json({ success: false, error: 'Error al obtener configuración global.' });
    }
};

/**
 * Actualizar parámetros globales del Servicio Salvavidas
 */
exports.actualizarConfiguracionGlobalSalvavidas = async (req, res) => {
    try {
        const data = await salvavidasService.actualizarConfiguracionGlobal(req.body, pool);
        res.json({ success: true, data, message: 'Configuración global actualizada con éxito.' });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en actualizarConfiguracionGlobalSalvavidas:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar configuración global.' });
    }
};

/**
 * Actualizar la parametrización predeterminada del reporte PDF para una cuenta
 */
exports.actualizarConfiguracionReporte = async (req, res) => {
    try {
        const { id } = req.params;
        const config = req.body.configuracion_reporte || req.body;
        
        console.log(`⚙️ [CC-CONTROLLER] Actualizando configuración de reporte para cuenta ID ${id}:`, config);

        const cuentaActualizada = await CuentaCorrienteService.actualizarConfiguracionReporte(parseInt(id), config);
        if (!cuentaActualizada) {
            return res.status(404).json({ success: false, error: 'Cuenta corriente no encontrada.' });
        }

        res.json({
            success: true,
            data: cuentaActualizada,
            message: 'Configuración predeterminada de reporte actualizada exitosamente.'
        });
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error en actualizarConfiguracionReporte:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar configuración de reporte.' });
    }
};

exports.enviarReporteEmail = async (req, res) => {
    try {
        const { id } = req.params;
        const detallado = req.query.detallado === 'true' || req.body.detallado === 'true';
        const desde_ultimo_cero = req.query.desde_ultimo_cero === 'true' || req.body.desde_ultimo_cero === 'true';
        const detallar_balance = req.query.detallar_balance !== 'false' && req.body.detallar_balance !== false && req.body.detallar_balance !== 'false';
        const modo_corte = req.query.modo_corte || req.body.modo_corte || (desde_ultimo_cero ? 'ultimo_cero' : 'todo');
        const desde_movimiento_id = req.query.desde_movimiento_id || req.body.desde_movimiento_id || null;
        
        console.log(`📧 [CC-CONTROLLER] Petición de envío de Email para CC ID: ${id} (Detallado: ${detallado}, Modo corte: ${modo_corte}, Desde mov ID: ${desde_movimiento_id}, Detallar Balance: ${detallar_balance})`);

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
        let movimientosOrdenados = [...movimientos].sort((a, b) => {
            const dateDiff = new Date(b.fecha_movimiento) - new Date(a.fecha_movimiento);
            if (dateDiff !== 0) return dateDiff;
            return b.id - a.id;
        });

        movimientosOrdenados = filtrarMovimientosPorRango(movimientosOrdenados, {
            modo_corte,
            desde_movimiento_id,
            desde_ultimo_cero
        });

        if (detallado) {
            await cargarDetallesMovimientos(movimientosOrdenados);
        }

        // 2.b. Obtener composición de deuda determinista y simulación Salvavidas (para PDF y aviso en email)
        let composicionInfo = null;
        let salvavidasInfo = null;
        if (detallar_balance || parseFloat(cuentaObj.saldo) > 0.005) {
            try {
                composicionInfo = await composicionSaldoService.calcularComposicionSaldo(parseInt(id), pool);
                salvavidasInfo = await salvavidasService.calcularSimulacionCuenta(parseInt(id), { persistir_sombra: false }, pool);
            } catch (errComposicion) {
                console.error('⚠️ [CC-CONTROLLER] Error al calcular composición/salvavidas de saldo para email:', errComposicion.message);
            }
        }
        const avisoSaldoExcedidoHtml = construirAvisoSaldoExcedidoHtml(composicionInfo, parseFloat(cuentaObj.saldo), salvavidasInfo);
        
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
        const pdfBuffer = await generarPdfBuffer(cuentaObj, movimientosOrdenados, clienteObj, detallado, composicionInfo, detallar_balance, salvavidasInfo);
        const pdfBase64 = pdfBuffer.toString('base64');

        // 6. Enviar al microservicio en Facturación con timeout controlado de 10 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 10000);

        try {
            console.log(`📧 [CC-CONTROLLER] Invocando microservicio de Correo para enviar reporte a: ${emailDestinos}`);
            
            const fechaCorte = new Date().toLocaleDateString('es-AR');
            const saldoBase = parseFloat(cuentaObj.saldo || 0);
            const saldoActual = (salvavidasInfo && salvavidasInfo.financiacion_total_con_iva > 0)
                ? parseFloat(salvavidasInfo.saldo_total_proyectado_con_iva)
                : saldoBase;

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
                    saldoActual,
                    avisoSaldoExcedidoHtml
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
        if (mov.tipo_comprobante === 'CREDITO_HORAS') {
            try {
                let meta = {};
                if (mov.metadatos) {
                    meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                }
                const jIds = Array.isArray(meta.jornadas_ids) && meta.jornadas_ids.length > 0 ? meta.jornadas_ids : [];
                const jRes = await pool.query(`
                    SELECT 
                        id, fecha_ingreso, fecha_egreso, horas_totales, minutos_totales, 
                        valor_hora_aplicado, monto_total, observacion_ingreso, observacion_egreso
                    FROM public.colaboradores_jornadas
                    WHERE cuenta_corriente_movimiento_id = $1
                       OR ($2::int[] IS NOT NULL AND id = ANY($2::int[]))
                    ORDER BY fecha_ingreso ASC
                `, [mov.id, jIds.length > 0 ? jIds : null]);
                mov.jornadas_detalle = jRes.rows;
            } catch (jErr) {
                console.error(`❌ [CC-CONTROLLER] Error al cargar jornadas para movimiento ID ${mov.id}:`, jErr.message);
                mov.jornadas_detalle = [];
            }
        } else if (mov.tipo_comprobante === 'CREDITO_RENDIMIENTO') {
            try {
                let meta = {};
                if (mov.metadatos) {
                    meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
                }
                mov.meta_parsed = meta;
                if (meta.carro_id) {
                    const cArtRes = await pool.query(`
                        SELECT articulo_numero, descripcion, cantidad
                        FROM public.carros_articulos
                        WHERE carro_id = $1
                    `, [parseInt(meta.carro_id)]);
                    mov.produccion_articulos = cArtRes.rows;
                }
            } catch (pErr) {
                console.error(`❌ [CC-CONTROLLER] Error al cargar detalles de produccion para movimiento ID ${mov.id}:`, pErr.message);
                mov.produccion_articulos = [];
            }
        } else if (mov.tipo_comprobante === 'FACTURA' || (mov.tipo_comprobante && mov.tipo_comprobante.startsWith('FACTURA_'))) {
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
                            descripcion, 
                            cantidad AS qty, 
                            precio1 AS p_unit, 
                            (cantidad * precio1) AS imp_neto 
                         FROM public.v_presupuestos_detalles_resueltos
                         WHERE id_presupuesto = $1
                         ORDER BY id ASC`,
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
const generarPdfBuffer = async (cuentaObj, movimientosOrdenados, clienteObj, detallado = false, composicionInfo = null, detallarBalance = true, salvavidasInfo = null) => {
    if (detallarBalance && !composicionInfo) {
        try {
            composicionInfo = await composicionSaldoService.calcularComposicionSaldo(cuentaObj.id, pool);
        } catch (compErr) {
            console.warn('⚠️ [CC-CONTROLLER] Error al calcular composicion en generarPdfBuffer:', compErr.message);
        }
    }
    if (detallarBalance && !salvavidasInfo) {
        try {
            salvavidasInfo = await salvavidasService.calcularSimulacionCuenta(cuentaObj.id, { persistir_sombra: false }, pool);
        } catch (salvErr) {
            console.warn('⚠️ [CC-CONTROLLER] Error al calcular salvavidas en generarPdfBuffer:', salvErr.message);
        }
    }
    if ((detallado || detallarBalance) && movimientosOrdenados) {
        try {
            await cargarDetallesMovimientos(movimientosOrdenados);
        } catch (detErr) {
            console.warn('⚠️ [CC-CONTROLLER] Error al cargar detalles en generarPdfBuffer:', detErr.message);
        }
    }
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 25, left: 40, right: 40 } });
            const buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                resolve(Buffer.concat(buffers));
            });
            doc.on('error', reject);
            
            construirDocumentoPdf(doc, cuentaObj, movimientosOrdenados, clienteObj, detallado, composicionInfo, detallarBalance, salvavidasInfo);
            doc.end();
        } catch (e) {
            reject(e);
        }
    });
};


/**
 * Construir el contenido visual estructurado del PDF
 */
const construirDocumentoPdf = (doc, cuentaObj, movimientos, clienteObj, detallado = false, composicionInfo = null, detallarBalance = true, salvavidasInfo = null) => {
    const pageWidth = doc.page.width;
    const pageMargin = doc.page.margins.left;
    const contentWidth = pageWidth - (pageMargin * 2);
    const leftColumn = pageMargin;
    
    let yPos = 40;
    
    // 1. CABECERA
    // Título a la izquierda
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#8e4785').text('Informe de Cuenta Corriente', leftColumn, yPos);
    doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text('Detalle cronológico de movimientos financieros, plazos y balance de cuenta', leftColumn, yPos + 17);
    
    // Alias de Transferencia Bancaria
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#8e4785').text('Alias CBU para Transferencias: ', leftColumn, yPos + 29, { continued: true })
       .font('Helvetica').fillColor('#1e293b').text('LAMDA.SER.MARTIN   |   Banco Galicia CTA: 4007844-1 373-4   |   CBU: 0070373230004007844141');
    
    // Isotipo "L" a la derecha (estático e independiente de logo_LAMDA_grande.png)
    const isotipoPath = path.join(__dirname, '../img/isotipo_L_LAMDA.png');
    const isoSize = 35;
    const isoX = pageWidth - pageMargin - isoSize;
    if (fs.existsSync(isotipoPath)) {
        doc.image(isotipoPath, isoX, yPos - 2, { width: isoSize, height: isoSize });
    } else {
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#8e4785').text('L', isoX, yPos - 2, { width: isoSize, align: 'right' });
    }
    
    yPos += 46;
    
    // Línea divisoria violeta de cabecera
    doc.moveTo(leftColumn, yPos).lineTo(pageWidth - pageMargin, yPos).strokeColor('#8e4785').lineWidth(1.5).stroke();
    
    yPos += 10;
    
    // 2. DATOS DEL CLIENTE Y BALANCE CONSOLIDADO (En paralelo)
    const clienteBoxWidth = 255;
    const balanceBoxWidth = contentWidth - clienteBoxWidth - 10; // 515 - 255 - 10 = 250
    const balanceBoxX = leftColumn + clienteBoxWidth + 10; // 40 + 255 + 10 = 305

    // Configuración de columnas internas para evitar solapamientos
    const colLeftX = leftColumn + 10;
    const colWidthLeft = 132;
    const colRightX = leftColumn + 146;
    const colWidthRight = clienteBoxWidth - 146 - 8;

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

    const razonSocialText = clienteObj.razon_social || clienteObj.cliente_nombre || 'S/D';
    const condicionIvaText = clienteObj.condicion_iva || 'Consumidor Final';
    const domicilioFiscalText = clienteObj.domicilio_fiscal || 'S/D';
    const cuitText = cuitFmt || 'S/D';
    const codigoHistoricoText = codigoHistorico;
    const codigoClienteText = clienteObj.codigo_bunker_cliente || 'S/D';

    // Medir alturas de textos para cálculo dinámico de boxHeight
    doc.fontSize(7.5).font('Helvetica-Bold');
    const hRazonSocial = doc.heightOfString(`Razón Social: ${razonSocialText}`, { width: colWidthLeft });
    const hCondicionIva = doc.heightOfString(`Condición IVA: ${condicionIvaText}`, { width: colWidthLeft });
    const hDomicilioFiscal = doc.heightOfString(`Domicilio Fiscal: ${domicilioFiscalText}`, { width: colWidthLeft });

    const hCuit = doc.heightOfString(`CUIT: ${cuitText}`, { width: colWidthRight });
    const hCodigoHistorico = doc.heightOfString(`Código Histórico: ${codigoHistoricoText}`, { width: colWidthRight });
    const hCodigoCliente = doc.heightOfString(`Código Cliente: ${codigoClienteText}`, { width: colWidthRight });

    // Altura total de datos
    const totalLeftHeight = hRazonSocial + 3 + hCondicionIva + 3 + hDomicilioFiscal;
    const totalRightHeight = hCuit + 3 + hCodigoHistorico + 3 + hCodigoCliente;
    const hClienteRequerida = 18 + Math.max(totalLeftHeight, totalRightHeight) + 8;

    // Datos de simulación Salvavidas (4 etapas LAMDA)
    const finalSaldo = parseFloat(cuentaObj.saldo) || 0;
    const capas = (detallarBalance && composicionInfo && composicionInfo.capas) ? composicionInfo.capas : [];
    const modoSwitch = salvavidasInfo?.reglas_aplicadas?.modo_switch || (salvavidasInfo?.reglas_aplicadas?.habilitado === false ? 'EXCLUIDO' : 'ACTIVO');
    const esModoSombra = modoSwitch === 'SOMBRA';
    const tieneSalvavidasHabilitado = Boolean(detallarBalance && salvavidasInfo && salvavidasInfo.reglas_aplicadas && salvavidasInfo.reglas_aplicadas.habilitado && modoSwitch !== 'EXCLUIDO');
    const capasSim = (tieneSalvavidasHabilitado && Array.isArray(salvavidasInfo.capas_simuladas)) ? salvavidasInfo.capas_simuladas : [];
    const finCalcNeta = Number(salvavidasInfo?.financiacion_calculada_neta ?? salvavidasInfo?.financiacion_total ?? 0);
    const finCalcIva = Number(salvavidasInfo?.financiacion_calculada_iva ?? salvavidasInfo?.financiacion_iva ?? 0);
    const finCalcConIva = Number(salvavidasInfo?.financiacion_calculada_con_iva ?? salvavidasInfo?.financiacion_total_con_iva ?? 0);
    const tieneInteresActivo = Boolean(tieneSalvavidasHabilitado && !esModoSombra && salvavidasInfo.financiacion_total_con_iva > 0);
    const tieneInteresSombra = Boolean(tieneSalvavidasHabilitado && esModoSombra && finCalcConIva > 0);
    const saldoTotalConIva = tieneInteresActivo ? parseFloat(salvavidasInfo.saldo_total_proyectado_con_iva) : finalSaldo;
    const saldoTotalSimuladoSombra = parseFloat((finalSaldo + finCalcConIva).toFixed(2));

    let hBalanceRequerida = 62;
    if (tieneInteresActivo || tieneInteresSombra) {
        hBalanceRequerida = 88;
    } else if (detallarBalance && finalSaldo > 0.005 && capas.length > 0 && !tieneSalvavidasHabilitado) {
        hBalanceRequerida = 46 + 14 + (capas.length * 19) + 6;
    } else if (tieneSalvavidasHabilitado && finalSaldo > 0.005) {
        hBalanceRequerida = 72;
    }

    // Altura final del box unificada
    const boxHeight = Math.max(64, hClienteRequerida, hBalanceRequerida);

    // A. Recuadro Datos Cliente
    doc.save();
    doc.roundedRect(leftColumn, yPos, clienteBoxWidth, boxHeight, 4).fillColor('#f8fafc').fill();
    doc.roundedRect(leftColumn, yPos, clienteBoxWidth, boxHeight, 4).strokeColor('#e2e8f0').lineWidth(0.75).stroke();
    doc.restore();
    
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#8e4785').text('DATOS FORMALES DEL CLIENTE', leftColumn + 10, yPos + 6);
    
    // Renderizado Columna Izquierda
    let yLeft = yPos + 18;
    doc.fontSize(7.5).font('Helvetica').fillColor('#1e293b');
    
    doc.font('Helvetica-Bold').text('Razón Social: ', colLeftX, yLeft, { continued: true, width: colWidthLeft })
       .font('Helvetica').text(razonSocialText);
    yLeft += hRazonSocial + 3;
    
    doc.font('Helvetica-Bold').text('Condición IVA: ', colLeftX, yLeft, { continued: true, width: colWidthLeft })
       .font('Helvetica').text(condicionIvaText);
    yLeft += hCondicionIva + 3;
    
    doc.font('Helvetica-Bold').text('Domicilio Fiscal: ', colLeftX, yLeft, { continued: true, width: colWidthLeft })
       .font('Helvetica').text(domicilioFiscalText);
       
    // Renderizado Columna Derecha
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
    doc.roundedRect(balanceBoxX, yPos, balanceBoxWidth, boxHeight, 4).fillColor(tieneInteresActivo ? '#fff1f2' : (tieneInteresSombra ? '#fffbeb' : '#fdf6fd')).fill();
    doc.roundedRect(balanceBoxX, yPos, balanceBoxWidth, boxHeight, 4).strokeColor(tieneInteresActivo ? '#e11d48' : (tieneInteresSombra ? '#f59e0b' : '#8e4785')).lineWidth(1).stroke();
    doc.restore();

    let labelDeuda = 'Al día / Sin deuda';
    let labelColor = '#047857';
    if (finalSaldo > 0.005) {
        labelDeuda = tieneInteresActivo
            ? 'Salvavidas de Financiación Activo'
            : (tieneInteresSombra ? 'Modo Sombra Informativo (Sin Cargo)' : 'Saldo Deudor');
        labelColor = tieneInteresSombra ? '#b45309' : '#b91c1c';
    } else if (finalSaldo < -0.005) {
        labelDeuda = 'Saldo a Favor';
        labelColor = '#047857';
    }

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#8e4785').text(
        tieneInteresActivo ? 'SALDO TOTAL CONSOLIDADO (C/IVA)' : 'ESTADO CONSOLIDADO',
        balanceBoxX + 10,
        yPos + 6
    );

    if (tieneSalvavidasHabilitado) {
        const disp = salvavidasInfo.reglas_aplicadas.cortesias_disponibles_anio ?? 3;
        const cupo = salvavidasInfo.reglas_aplicadas.cupo_cortesias_anual ?? 3;
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#6b21a8')
           .text(`Comodines Año: ${disp}/${cupo} disp.`, balanceBoxX + 130, yPos + 6, { width: balanceBoxWidth - 138, align: 'right' });
    }

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(labelColor).text(labelDeuda.toUpperCase(), balanceBoxX + 10, yPos + 16);

    if (tieneInteresActivo) {
        const tasaPct = salvavidasInfo.reglas_aplicadas?.tasa_servicio_financiero || 3;
        // Monto Total con Salvavidas + IVA destacado en rojo arriba
        doc.fontSize(12.5).font('Helvetica-Bold').fillColor('#b91c1c')
           .text(`TOTAL: ${formatCurrency(saldoTotalConIva)}`, balanceBoxX + 10, yPos + 26);

        // Desglose transparente debajo
        const yBreak = yPos + 42;
        doc.save();
        doc.roundedRect(balanceBoxX + 8, yBreak, balanceBoxWidth - 16, 40, 3).fillColor('#ffffff').fill();
        doc.roundedRect(balanceBoxX + 8, yBreak, balanceBoxWidth - 16, 40, 3).strokeColor('#fecdd3').lineWidth(0.6).stroke();
        doc.restore();

        doc.fontSize(6.5).font('Helvetica').fillColor('#334155')
           .text('Capital de comprobantes:', balanceBoxX + 13, yBreak + 4);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#1e293b')
           .text(formatCurrency(finalSaldo), balanceBoxX + 130, yBreak + 4, { width: balanceBoxWidth - 143, align: 'right' });

        const finNeta = salvavidasInfo.financiacion_total ?? salvavidasInfo.financiacion_neta_total ?? 0;
        const finIva = salvavidasInfo.financiacion_iva ?? salvavidasInfo.financiacion_iva_total ?? 0;
        doc.fontSize(6.5).font('Helvetica').fillColor('#9a3412')
           .text(`+ Salvavidas ${tasaPct}% (${formatCurrency(finNeta)}) + IVA (${formatCurrency(finIva)}):`, balanceBoxX + 13, yBreak + 15);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#b45309')
           .text(`+ ${formatCurrency(salvavidasInfo.financiacion_total_con_iva)}`, balanceBoxX + 165, yBreak + 15, { width: balanceBoxWidth - 178, align: 'right' });

        doc.moveTo(balanceBoxX + 13, yBreak + 26).lineTo(balanceBoxX + balanceBoxWidth - 13, yBreak + 26).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        doc.fontSize(7).font('Helvetica-Bold').fillColor('#881337')
           .text('Total Real a Pagar Hoy (c/IVA):', balanceBoxX + 13, yBreak + 29);
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#b91c1c')
           .text(formatCurrency(saldoTotalConIva), balanceBoxX + 145, yBreak + 29, { width: balanceBoxWidth - 158, align: 'right' });
    } else if (tieneInteresSombra) {
        const tasaPct = salvavidasInfo.reglas_aplicadas?.tasa_servicio_financiero || 3;
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a')
           .text(`SALDO: ${formatCurrency(finalSaldo)}`, balanceBoxX + 10, yPos + 26);

        const yBreak = yPos + 42;
        doc.save();
        doc.roundedRect(balanceBoxX + 8, yBreak, balanceBoxWidth - 16, 40, 3).fillColor('#ffffff').fill();
        doc.roundedRect(balanceBoxX + 8, yBreak, balanceBoxWidth - 16, 40, 3).strokeColor('#fde68a').lineWidth(0.6).stroke();
        doc.restore();

        doc.fontSize(6.5).font('Helvetica').fillColor('#334155')
           .text('Capital exigible hoy:', balanceBoxX + 13, yBreak + 4);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#1e293b')
           .text(formatCurrency(finalSaldo), balanceBoxX + 130, yBreak + 4, { width: balanceBoxWidth - 143, align: 'right' });

        doc.fontSize(6.3).font('Helvetica').fillColor('#92400e')
           .text(`Simulación Informativa ${tasaPct}% (${formatCurrency(finCalcNeta)} + IVA ${formatCurrency(finCalcIva)}):`, balanceBoxX + 13, yBreak + 15);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#b45309')
           .text(`+ ${formatCurrency(finCalcConIva)}`, balanceBoxX + 165, yBreak + 15, { width: balanceBoxWidth - 178, align: 'right' });

        doc.moveTo(balanceBoxX + 13, yBreak + 26).lineTo(balanceBoxX + balanceBoxWidth - 13, yBreak + 26).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#92400e')
           .text('Total Simulado (Informativo):', balanceBoxX + 13, yBreak + 29);
        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#b45309')
           .text(formatCurrency(saldoTotalSimuladoSombra), balanceBoxX + 145, yBreak + 29, { width: balanceBoxWidth - 158, align: 'right' });
    } else {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#8e4785');
        doc.text('SALDO TOTAL: ', balanceBoxX + 10, yPos + 27, { continued: true });
        doc.fillColor(labelColor).text(formatCurrency(finalSaldo));

        if (tieneSalvavidasHabilitado && finalSaldo > 0.005) {
            const estGral = salvavidasInfo.estado_general || 'EN_TERMINO';
            let txtEtapa = 'Dentro de Compromiso Habitual (Días 1 a 7) · 0% Financiación';
            let colEtapa = '#047857';
            if (estGral === 'ASISTENCIA_CORTESIA') {
                txtEtapa = 'En Comodín Trimestral (Días 11 a 14) · 0% Financiación Bonificada';
                colEtapa = '#b45309';
            } else if (estGral === 'GRACIA_NATURAL') {
                txtEtapa = 'En +3 Días de Gracia Natural (Días 8 a 10) · 0% Financiación (Sin Comodín)';
                colEtapa = '#0369a1';
            }
            doc.fontSize(6.5).font('Helvetica-Bold').fillColor(colEtapa)
               .text(txtEtapa, balanceBoxX + 10, yPos + 43, { width: balanceBoxWidth - 20 });
            doc.fontSize(6.2).font('Helvetica').fillColor('#64748b')
               .text('Ver debajo el cronograma exacto de fechas y las 4 etapas de financiación.', balanceBoxX + 10, yPos + 53, { width: balanceBoxWidth - 20 });
        } else if (detallarBalance && finalSaldo > 0.005 && capas.length > 0 && !tieneSalvavidasHabilitado) {
            const yDiv = yPos + 44;
            doc.moveTo(balanceBoxX + 8, yDiv).lineTo(balanceBoxX + balanceBoxWidth - 8, yDiv).strokeColor('#e9d5ff').lineWidth(0.75).stroke();

            let yCapa = yDiv + 4;
            doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#6b21a8')
               .text(`COMPOSICIÓN DE LA DEUDA (${capas.length} ${capas.length === 1 ? 'comprobante' : 'comprobantes'}):`, balanceBoxX + 10, yCapa);
            
            yCapa += 10;

            const colDescX = balanceBoxX + 10;
            const colDescW = 142;
            const colMontoX = balanceBoxX + 155;
            const colMontoW = balanceBoxWidth - 155 - 10;

            for (const c of capas) {
                let nombreCbte = c.descripcion ? c.descripcion.split('(')[0].trim() : 'Comprobante';
                if (nombreCbte.length > 25) nombreCbte = nombreCbte.substring(0, 24) + '...';

                const fmtMonto = formatCurrency(c.monto_pendiente);
                const esParcial = c.porcentaje_impago < 99.9;

                let semaforoColor = '#047857';
                if (c.antiguedad_dias > 21) semaforoColor = '#b91c1c';
                else if (c.antiguedad_dias > 7) semaforoColor = '#d97706';

                const fechaObj = new Date(c.punto_cero);
                const diaMes = `${String(fechaObj.getDate()).padStart(2, '0')}/${String(fechaObj.getMonth() + 1).padStart(2, '0')}`;
                let antiguedadLabel = c.antiguedad_dias === 0 ? 'Hoy' : c.antiguedad_dias === 1 ? '1 día' : `${c.antiguedad_dias} días`;
                if (c.antiguedad_dias > 21) {
                    antiguedadLabel += ' (Vencido)';
                }

                let canalCorto = 'Reparto';
                if (c.tipo_punto_cero === 'RETIRO_DEPOSITO') canalCorto = 'Depósito';
                else if (c.tipo_punto_cero === 'REPARTO_CONFIRMADO' || c.tipo_punto_cero === 'REPARTO_REAL') canalCorto = 'Reparto';
                else if (c.tipo_punto_cero === 'EMISION_ELECTRONICA') canalCorto = 'Emisión';
                else if (c.tipo_punto_cero === 'APERTURA') canalCorto = 'Apertura';
                else canalCorto = 'Admin';

                doc.fontSize(7).font('Helvetica-Bold').fillColor('#1e293b')
                   .text(`• ${nombreCbte}`, colDescX, yCapa, { width: colDescW, lineBreak: false });

                doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#8e4785')
                   .text(fmtMonto, colMontoX, yCapa, { width: colMontoW, align: 'right', lineBreak: false });

                yCapa += 9;

                doc.fontSize(6.5).font('Helvetica-Bold').fillColor(semaforoColor)
                   .text(`  Hace ${antiguedadLabel}`, colDescX, yCapa, { continued: true })
                   .font('Helvetica').fillColor('#64748b')
                   .text(` · ${canalCorto} (${diaMes})`, { width: colDescW });

                if (esParcial) {
                    doc.fontSize(6).font('Helvetica-Oblique').fillColor('#64748b')
                       .text(`saldo de ${formatCurrency(c.monto_original)}`, colMontoX, yCapa, { width: colMontoW, align: 'right', lineBreak: false });
                }

                yCapa += 10;
            }
        } else if (finalSaldo <= 0.005 && finalSaldo >= -0.005) {
            doc.fontSize(7).font('Helvetica').fillColor('#047857')
               .text('Cuenta al día. Sin comprobantes pendientes de cobro.', balanceBoxX + 10, yPos + 44);
        } else if (finalSaldo < -0.005) {
            doc.fontSize(7).font('Helvetica').fillColor('#047857')
               .text('Saldo a favor del cliente para próximas compras.', balanceBoxX + 10, yPos + 44);
        }
    }

    yPos += boxHeight + 10;

    // 2.B. BLOQUE DE DIAGNÓSTICO DE CUENTA Y ESQUEMA DE FINANCIACIÓN LAMDA (4 ETAPAS + FECHAS POR COMPROBANTE)
    if (tieneSalvavidasHabilitado) {
        const reglas = salvavidasInfo.reglas_aplicadas;
        const diasEst = reglas.dias_ventana_estandar || 7;
        const diasGracia = reglas.dias_gracia_natural || 3;
        const diasTopeGracia = reglas.dias_tope_sin_comodin || 10;
        const diasComodin = reglas.dias_total_cortesia || 14;
        const tasaPct = reglas.tasa_servicio_financiero || 3;
        const comodinesDisp = reglas.cortesias_disponibles_anio ?? 3;
        const cupoAnual = reglas.cupo_cortesias_anual ?? 3;
        const comodinesUsados = reglas.cortesias_usadas_anio ?? 0;
        const histComodines = Array.isArray(salvavidasInfo.comodines_historial) ? salvavidasInfo.comodines_historial : [];

        // Calcular altura dinámica del panel de Diagnóstico y Política LAMDA
        const headerDiagH = 16;
        const stagesGridH = 42;
        const capasBlockH = capasSim.length > 0 ? (15 + (capasSim.length * 29)) : 0;
        const histBlockH = histComodines.length > 0 ? 14 : 0;
        const politicasFooterH = 26;
        const totalDiagH = headerDiagH + stagesGridH + capasBlockH + histBlockH + politicasFooterH + 8;

        if (yPos + totalDiagH > doc.page.height - 70) {
            doc.addPage();
            yPos = 40;
        }

        // Contenedor principal del Diagnóstico
        doc.save();
        doc.roundedRect(leftColumn, yPos, contentWidth, totalDiagH, 4).fillColor('#f8fafc').fill();
        doc.roundedRect(leftColumn, yPos, contentWidth, totalDiagH, 4).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
        // Banda superior de título
        doc.roundedRect(leftColumn, yPos, contentWidth, headerDiagH, 4).fillColor('#f1f5f9').fill();
        doc.restore();

        doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#475569')
           .text(`DIAGNÓSTICO DE CUENTA Y ESQUEMA DE FINANCIACIÓN LAMDA (4 ETAPAS${esModoSombra ? ' — MODO INFORMATIVO' : ''})`, leftColumn + 8, yPos + 4.5);

        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#6b21a8')
           .text(`Comodines Trimestrales Año: ${comodinesDisp} de ${cupoAnual} disponibles (Usados: ${comodinesUsados})`, leftColumn + 270, yPos + 4.5, { width: contentWidth - 278, align: 'right' });

        let yInner = yPos + headerDiagH + 4;

        // Grilla de las 4 Etapas LAMDA (4 columnas de ~123pt)
        const stageGap = 5;
        const stageW = (contentWidth - 16 - (stageGap * 3)) / 4; // (515 - 16 - 15) / 4 = 121
        const estGeneral = salvavidasInfo.estado_general || 'EN_TERMINO';

        const stagesData = [
            {
                titulo: `1. Días 1 a ${diasEst}: Compromiso`,
                desc: `Plazo habitual de pago desde la entrega. 0% financiación y sin usar comodín.`,
                color: '#047857',
                bg: '#f0fdf4',
                active: finalSaldo > 0.005 && capasSim.some(c => c.ventana_codigo === 'MARGEN_ESTANDAR')
            },
            {
                titulo: `2. Días ${diasEst + 1} a ${diasTopeGracia}: +${diasGracia}d Gracia`,
                desc: `${diasGracia} días naturales extra (bancos / fin de semana). 0% financiación y NO usa comodín.`,
                color: '#0369a1',
                bg: '#f0f9ff',
                active: finalSaldo > 0.005 && capasSim.some(c => c.ventana_codigo === 'GRACIA_NATURAL')
            },
            {
                titulo: `3. Días ${diasTopeGracia + 1} a ${diasComodin}: Comodín`,
                desc: `1 comodín cada 3 meses (${cupoAnual}/año) hasta el Día ${diasComodin} con 0% financiación.`,
                color: '#b45309',
                bg: '#fffbeb',
                active: finalSaldo > 0.005 && capasSim.some(c => c.ventana_codigo === 'ASISTENCIA_CORTESIA')
            },
            {
                titulo: `4. Día ${diasComodin + 1}+: Financiación ${tasaPct}%`,
                desc: `${tasaPct}% mensual + IVA (0,1%/día + IVA desde Día 1 sobre saldo impago).`,
                color: '#b91c1c',
                bg: '#fff1f2',
                active: finalSaldo > 0.005 && capasSim.some(c => c.ventana_codigo === 'ASISTENCIA_FORMALIZADA')
            }
        ];

        stagesData.forEach((st, idx) => {
            const stX = leftColumn + 8 + (idx * (stageW + stageGap));
            doc.save();
            doc.roundedRect(stX, yInner, stageW, 36, 3).fillColor(st.active ? st.bg : '#ffffff').fill();
            doc.roundedRect(stX, yInner, stageW, 36, 3).strokeColor(st.active ? st.color : '#e2e8f0').lineWidth(st.active ? 1.1 : 0.6).stroke();
            doc.rect(stX, yInner, stageW, 2.5).fillColor(st.color).fill();
            doc.restore();

            doc.fontSize(6.5).font('Helvetica-Bold').fillColor(st.color)
               .text(st.titulo, stX + 4, yInner + 5, { width: stageW - 8, lineBreak: false });
            doc.fontSize(5.8).font('Helvetica').fillColor('#334155')
               .text(st.desc, stX + 4, yInner + 14, { width: stageW - 8 });
        });

        yInner += stagesGridH;

        // Cronograma detallado de cada comprobante pendiente con sus 4 fechas clave
        if (capasSim.length > 0) {
            doc.moveTo(leftColumn + 8, yInner - 2).lineTo(leftColumn + contentWidth - 8, yInner - 2).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#1e293b')
               .text(`CRONOGRAMA Y ESTADO DE COMPROBANTES PENDIENTES (${capasSim.length}):`, leftColumn + 8, yInner + 1);
            yInner += 12;

            for (const cs of capasSim) {
                let nomDoc = cs.descripcion ? cs.descripcion.split('(')[0].trim() : 'Comprobante';
                nomDoc = nomDoc.replace(/^Fac\s+X(?=\d)/i, 'Fac X ');
                if (nomDoc.length > 42) nomDoc = nomDoc.substring(0, 41) + '...';

                const fEnt = formatFechaCortaAR(cs.punto_cero);
                const f7d = formatFechaCortaAR(cs.fecha_vto_compromiso);
                const f10d = formatFechaCortaAR(cs.fecha_vto_gracia_natural);
                const f14d = formatFechaCortaAR(cs.fecha_vto_comodin);

                let badgeTexto = '';
                let badgeColor = '#047857';
                let rowBg = '#f0fdf4';
                if (cs.ventana_codigo === 'ASISTENCIA_FORMALIZADA') {
                    badgeTexto = esModoSombra
                        ? `Día ${cs.antiguedad_dias} · En Sombra Informativo (+ ${formatCurrency(cs.interes_financiacion)} + IVA ${formatCurrency(cs.iva_financiacion)} = + ${formatCurrency(cs.interes_financiacion_con_iva)})`
                        : `Día ${cs.antiguedad_dias} · Financiación Activa (+ ${formatCurrency(cs.interes_financiacion)} + IVA ${formatCurrency(cs.iva_financiacion)} = + ${formatCurrency(cs.interes_financiacion_con_iva)})`;
                    badgeColor = esModoSombra ? '#b45309' : '#b91c1c';
                    rowBg = esModoSombra ? '#fffbeb' : '#fff1f2';
                } else if (cs.ventana_codigo === 'ASISTENCIA_CORTESIA') {
                    badgeTexto = `Día ${cs.antiguedad_dias}/${diasComodin} · Comodín Trimestral (0% financiación bonificada)`;
                    badgeColor = '#b45309';
                    rowBg = '#fffbeb';
                } else if (cs.ventana_codigo === 'GRACIA_NATURAL') {
                    badgeTexto = `Día ${cs.antiguedad_dias}/${diasTopeGracia} · +${diasGracia}d Gracia Natural (0% financiación · Sin usar comodín)`;
                    badgeColor = '#0369a1';
                    rowBg = '#f0f9ff';
                } else {
                    badgeTexto = `Día ${cs.antiguedad_dias}/${diasEst} · Compromiso Habitual (0% financiación)`;
                    badgeColor = '#047857';
                    rowBg = '#f0fdf4';
                }

                doc.save();
                doc.roundedRect(leftColumn + 8, yInner, contentWidth - 16, 26, 3).fillColor(rowBg).fill();
                doc.roundedRect(leftColumn + 8, yInner, contentWidth - 16, 26, 3).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
                doc.rect(leftColumn + 8, yInner, 3, 26).fillColor(badgeColor).fill();
                doc.restore();

                // Línea 1 del comprobante: Nombre + Saldo pendiente + Estado/Interés
                const montoPendienteCapa = cs.capital_pendiente ?? cs.monto_pendiente ?? 0;
                const porcImpago = cs.porcentaje_impago ?? (cs.monto_original > 0 ? (montoPendienteCapa / cs.monto_original) * 100 : 100);
                let textoParcial = '';
                if (porcImpago < 99.9) {
                    const capPag = parseFloat(cs.capital_pagado) || 0;
                    const finPag = parseFloat(cs.financiacion_pagada_con_iva) || 0;
                    if (capPag > 0 && finPag > 0) {
                        textoParcial = ` (de ${formatCurrency(cs.monto_original)} · Canceló ${formatCurrency(capPag)} cap. + ${formatCurrency(finPag)} financ.)`;
                    } else {
                        textoParcial = ` (saldo de ${formatCurrency(cs.monto_original)})`;
                    }
                }
                doc.fontSize(6.6).font('Helvetica-Bold').fillColor('#0f172a')
                   .text(`• ${nomDoc}: `, leftColumn + 15, yInner + 3.5, { continued: true })
                   .fillColor('#8e4785').text(`${formatCurrency(montoPendienteCapa)}${textoParcial}`);

                doc.fontSize(6.5).font('Helvetica-Bold').fillColor(badgeColor)
                   .text(badgeTexto, leftColumn + 215, yInner + 3.5, { width: contentWidth - 227, align: 'right', lineBreak: false });

                // Línea 2 del comprobante: Las 4 Fechas Clave
                const yFechas = yInner + 14.5;
                doc.fontSize(6.2).font('Helvetica-Bold').fillColor('#475569')
                   .text('Fechas clave:  ', leftColumn + 15, yFechas, { continued: true })
                   .font('Helvetica').fillColor('#334155').text(`Entrega (Día 1): `, { continued: true })
                   .font('Helvetica-Bold').fillColor('#0f172a').text(`${fEnt}    |    `, { continued: true })
                   .font('Helvetica').fillColor('#047857').text(`Compromiso (${diasEst}d): `, { continued: true })
                   .font('Helvetica-Bold').text(`${f7d}    |    `, { continued: true })
                   .font('Helvetica').fillColor('#0369a1').text(`+${diasGracia}d Gracia (${diasTopeGracia}d): `, { continued: true })
                   .font('Helvetica-Bold').text(`${f10d}    |    `, { continued: true })
                   .font('Helvetica').fillColor('#b45309').text(`Tope Comodín (${diasComodin}d): `, { continued: true })
                   .font('Helvetica-Bold').text(`${f14d}`);

                yInner += 29;
            }
        }

        // Historial de Comodines Trimestrales usados en el año (si existen)
        if (histComodines.length > 0) {
            const resumenHist = histComodines.map((h, i) => {
                const nom = limpiarDocWhatsapp(h.descripcion);
                return `#${i + 1}: ${nom} (${h.dias_al_cancelar}d · pagada el ${formatFechaCortaAR(h.fecha_cancelacion)})`;
            }).join('   |   ');
            doc.fontSize(6.2).font('Helvetica-Bold').fillColor('#92400e')
               .text(`Comodines usados este año (${histComodines.length}/${cupoAnual}): `, leftColumn + 8, yInner + 2, { continued: true })
               .font('Helvetica').fillColor('#78350f').text(resumenHist, { width: contentWidth - 16, lineBreak: false });
            yInner += 14;
        }

        // Bloque sintético dentro del PDF con Pagos Parciales, Beneficio de Lista (5% OFF con Saldo $0) y Medios de Pago
        doc.moveTo(leftColumn + 8, yInner).lineTo(leftColumn + contentWidth - 8, yInner).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
        doc.fontSize(6.1).font('Helvetica-Bold').fillColor('#0f766e')
           .text('• Pagos Parciales y Beneficios de Lista: ', leftColumn + 8, yInner + 3, { continued: true })
           .font('Helvetica').fillColor('#334155')
           .text('Podés realizar entregas parciales a tu ritmo (descuentan capital en el acto sobre el comprobante más antiguo y mantienen tu cuenta habilitada). Con Cuenta al Día (Saldo $ 0,00) se activa el 5% OFF por volumen (> $300.000 neto) y el acceso a ofertas.', { width: contentWidth - 16 });
        doc.fontSize(6.0).font('Helvetica-Bold').fillColor('#475569')
           .text('• Medios de Pago: ', leftColumn + 8, yInner + 16.5, { continued: true })
           .font('Helvetica').fillColor('#334155')
           .text('1) Transferencia Galicia (Alias: LAMDA.SER.MARTIN | CBU: 0070373230004007844141)   ·   2) Depósito Efectivo 24 hs s/sobre en Cajeros Galicia (CTA Pesos 4007844-1 373-4)   ·   3) Efectivo ensobrado con reparto.', { width: contentWidth - 16, lineBreak: false });

        yPos += totalDiagH + 10;
    }
    
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
        } else if (mov.tipo_comprobante === 'PENDIENTE_FACTURACION') {
            tipoComp = 'Pend. Fact.';
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

        const metaMov = mov.metadatos
            ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
            : {};

        let desc = mov.descripcion || 'Sin concepto';
        desc = desc.replace(/\r/g, '').trim();
        if (mov.tipo_comprobante === 'RECIBO_PAGO') {
            if (metaMov.es_pago_capital_separado || metaMov.es_pago_financiacion) {
                desc = mov.descripcion || desc;
            } else {
                const medioPago = obtenerMedioPago(mov) || 'Efectivo';
                desc = metaMov.codigo_sobre
                    ? `Rec/Pago - ${medioPago} (Sobre #${metaMov.codigo_sobre})`
                    : `Rec/Pago - ${medioPago}`;
            }
        } else if (mov.tipo_comprobante === 'PAGO_A_CLIENTE' || mov.tipo_comprobante === 'DEBITO_BANCARIO') {
            desc = 'Pago Galicia - Transferencia a terceros';
        } else {
            desc = desc.replace(/^Factura Puesto 007 - Nro\s+/, 'Fac ');
            desc = desc.replace(/^Cobro Banc?[ao]rio?\s+/, 'Bco ');
            desc = desc.replace(/-\s+Concepto:\s+/i, '- cpto.: ');
        }

        // Cruzar con simulación Salvavidas (comprobantes abiertos, cancelados o pagos con imputación de financiación)
        const capaSimMatch = (tieneSalvavidasHabilitado && capasSim.length > 0)
            ? capasSim.find(c => c.mov_id === mov.id || (mov.comprobante_id && c.comprobante_id === mov.comprobante_id))
            : null;
        const canceladoMatch = (!capaSimMatch && tieneSalvavidasHabilitado && Array.isArray(salvavidasInfo.comprobantes_cancelados))
            ? salvavidasInfo.comprobantes_cancelados.find(c => c.mov_id === mov.id || (mov.comprobante_id && c.comprobante_id === mov.comprobante_id))
            : null;
        const impPagoMatch = (!esDebito && tieneSalvavidasHabilitado && salvavidasInfo.imputaciones_por_movimiento)
            ? salvavidasInfo.imputaciones_por_movimiento[String(mov.id)]
            : null;
        const capaMatch = (detallarBalance && capas && capas.length > 0)
            ? capas.find(c => c.mov_id === mov.id || (mov.comprobante_id && c.comprobante_id === mov.comprobante_id))
            : null;

        let subLineaMov = '';
        let subLineaColor = '#64748b';
        if (capaSimMatch) {
            const capResto = capaSimMatch.capital_pendiente ?? capaSimMatch.monto_pendiente ?? 0;
            const capPag = parseFloat(capaSimMatch.capital_pagado) || 0;
            const sufijoParcial = capPag > 0 ? ` · Continúa: ${formatCurrency(capResto)} (Canceló ${formatCurrency(capPag)} cap.)` : '';
            if (capaSimMatch.ventana_codigo === 'ASISTENCIA_FORMALIZADA') {
                subLineaMov = `Día ${capaSimMatch.antiguedad_dias} · Financiación (+${formatCurrency(capaSimMatch.interes_financiacion)} + IVA ${formatCurrency(capaSimMatch.iva_financiacion)} = +${formatCurrency(capaSimMatch.interes_financiacion_con_iva)})${sufijoParcial}`;
                subLineaColor = '#b91c1c';
            } else if (capaSimMatch.ventana_codigo === 'ASISTENCIA_CORTESIA') {
                subLineaMov = `Día ${capaSimMatch.antiguedad_dias}/14 · En Comodín Trimestral (0% financiación bonificada)${sufijoParcial}`;
                subLineaColor = '#b45309';
            } else if (capaSimMatch.ventana_codigo === 'GRACIA_NATURAL') {
                subLineaMov = `Día ${capaSimMatch.antiguedad_dias}/10 · En +3d Gracia Natural (0% financiación · Sin usar comodín)${sufijoParcial}`;
                subLineaColor = '#0369a1';
            } else {
                subLineaMov = `Día ${capaSimMatch.antiguedad_dias}/7 · En Compromiso Habitual (0% financiación)${sufijoParcial}`;
                subLineaColor = '#047857';
            }
        } else if (esDebito && metaMov.es_cargo_financiacion) {
            const refOrigen = metaMov.codigo_sobre
                ? `Sobre #${metaMov.codigo_sobre}`
                : (metaMov.movimiento_bancario_id ? `Transf. [Mov: ${metaMov.movimiento_bancario_id}]` : `Pago #${metaMov.pago_origen_id}`);
            subLineaMov = `100% Cancelado con ${refOrigen} · Financiación (${formatCurrency(metaMov.financiacion_neta)} neto + ${formatCurrency(metaMov.financiacion_iva)} IVA 21%) s/ ${formatCurrency(metaMov.capital_cancelado)} cap.`;
            subLineaColor = '#047857';
        } else if (!esDebito && metaMov.es_pago_capital_separado) {
            const etiqOrigenCap = metaMov.codigo_sobre
                ? `Total Sobre #${metaMov.codigo_sobre}`
                : (metaMov.movimiento_bancario_id ? `Total Transf. [Mov: ${metaMov.movimiento_bancario_id}]` : 'Total Pago');
            subLineaMov = `Canceló Capital ya facturado (${formatCurrency(mov.monto)}) · ${etiqOrigenCap}: ${formatCurrency(metaMov.monto_total_sobre || mov.monto)}`;
            subLineaColor = '#0f766e';
        } else if (!esDebito && metaMov.es_pago_financiacion) {
            const etiqOrigenInt = metaMov.codigo_sobre ? 'Total Sobre' : 'Total Transf.';
            subLineaMov = `Canceló Interés Financiación (${formatCurrency(metaMov.financiacion_neta_sobre)} neto + ${formatCurrency(metaMov.financiacion_iva_sobre)} IVA 21%) · ${etiqOrigenInt}: ${formatCurrency(metaMov.monto_total_sobre || mov.monto)}`;
            subLineaColor = '#b45309';
        } else if (impPagoMatch && impPagoMatch.tiene_financiacion_imputada) {
            const tagFac = impPagoMatch.financiacion_facturada
                ? (impPagoMatch.modo_facturacion === 'ARCA' ? 'Factura ARCA' : 'Fac. Interna')
                : 'Pend. Facturar';
            subLineaMov = `Canceló: ${formatCurrency(impPagoMatch.capital_cancelado_total)} Capital + ${formatCurrency(impPagoMatch.financiacion_con_iva_cancelada)} Financiación c/IVA (${tagFac})`;
            subLineaColor = '#0f766e';
        } else if (canceladoMatch) {
            if (canceladoMatch.uso_comodin) {
                subLineaMov = `Pagada a los ${canceladoMatch.dias_al_cancelar} días · Usó Comodín Trimestral #${canceladoMatch.numero_comodin_anio || 1} (0% financiación)`;
                subLineaColor = '#b45309';
            } else if (canceladoMatch.en_gracia_natural) {
                subLineaMov = `Pagada a los ${canceladoMatch.dias_al_cancelar} días · +3d Gracia Natural (Sin usar comodín)`;
                subLineaColor = '#0369a1';
            } else if (canceladoMatch.dias_al_cancelar <= 7) {
                subLineaMov = `Pagada a los ${canceladoMatch.dias_al_cancelar} días · En Compromiso Habitual (7d)`;
                subLineaColor = '#047857';
            }
        }

        // Calcular altura dinámica del renglón según el concepto + sub-línea de estado
        doc.fontSize(8).font('Helvetica-Bold');
        const descHeight = doc.heightOfString(desc, { width: 185 });
        const subHeight = subLineaMov ? 9 : 0;
        doc.font('Helvetica');
        const rowHeight = Math.max(14, descHeight + subHeight) + 3;

        // Calcular altura de la caja detallada si corresponde
        const esDetalladoFactura = Boolean(detallado) && (mov.tipo_comprobante === 'FACTURA' || mov.tipo_comprobante === 'PENDIENTE_FACTURACION');
        const esDetalladoHoras = Boolean(detallarBalance) && mov.tipo_comprobante === 'CREDITO_HORAS' && mov.jornadas_detalle && mov.jornadas_detalle.length > 0;
        const esDetalladoRendimiento = Boolean(detallarBalance) && mov.tipo_comprobante === 'CREDITO_RENDIMIENTO' && (mov.metadatos || mov.meta_parsed);
        const esDetalladoPago = Boolean(detallarBalance) && (mov.tipo_comprobante === 'PAGO_A_CLIENTE' || mov.tipo_comprobante === 'DEBITO_BANCARIO');

        let detailedBoxHeight = 0;
        if (esDetalladoFactura) {
            detailedBoxHeight = (45 + (mov.items && mov.items.length > 0 ? mov.items.length * 13 + 17 : 13) + 35);
        } else if (esDetalladoHoras) {
            detailedBoxHeight = 48 + (mov.jornadas_detalle.length * 13) + 16;
        } else if (esDetalladoRendimiento) {
            detailedBoxHeight = 58;
        } else if (esDetalladoPago) {
            detailedBoxHeight = 46;
        }
        
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
        
        // Resaltado si coincide con una factura impaga abierta
        if (capaSimMatch || capaMatch) {
            let semBg = '#f0fdf4'; // Verde
            let semAccent = '#047857';
            const ventana = capaSimMatch ? capaSimMatch.ventana_codigo : null;
            const diasAnt = capaSimMatch ? capaSimMatch.antiguedad_dias : capaMatch.antiguedad_dias;

            if (ventana === 'ASISTENCIA_FORMALIZADA' || diasAnt > 14) {
                semBg = '#fef2f2'; // Rojo
                semAccent = '#b91c1c';
            } else if (ventana === 'ASISTENCIA_CORTESIA' || diasAnt > 10) {
                semBg = '#fffbeb'; // Ámbar
                semAccent = '#d97706';
            } else if (ventana === 'GRACIA_NATURAL' || diasAnt > 7) {
                semBg = '#f0f9ff'; // Celeste Gracia Natural
                semAccent = '#0369a1';
            }

            doc.save();
            doc.rect(leftColumn, yPos - 2, contentWidth, rowHeight).fillColor(semBg).fill();
            doc.rect(leftColumn, yPos - 2, 3.5, rowHeight).fillColor(semAccent).fill();
            doc.restore();
        }

        // Renderizar fila principal
        doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        doc.text(fechaStr, leftColumn + 8, yPos);
        
        // Escribir el concepto con wrap y ancho limitado
        doc.font('Helvetica-Bold').text(desc, leftColumn + 80, yPos, { width: 185 }).font('Helvetica');
        if (subLineaMov) {
            doc.fontSize(6.2).font('Helvetica-Bold').fillColor(subLineaColor)
               .text(subLineaMov, leftColumn + 80, yPos + descHeight + 0.5, { width: 235, lineBreak: false });
            doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
        }
        
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
                const receptorName = log.receptor_nombre ? String(log.receptor_nombre).trim() : '';
                if (log.estado_logistico === 'ENTREGADO') {
                    const receptorVinculo = log.receptor_vinculo ? ` (${String(log.receptor_vinculo).trim()})` : '';
                    const dniText = log.dni_receptor ? ` - DNI: ${String(log.dni_receptor).trim()}` : '';
                    recepcionText = receptorName ? `Recibido por ${receptorName}${receptorVinculo}${dniText}` : 'Entregado';
                } else if (log.estado_logistico === 'RECHAZADO') {
                    recepcionText = `Rechazado en destino`;
                }

                doc.font('Helvetica-Bold').text(receptorName ? 'Estado / Receptor: ' : 'Estado: ', colRight, boxYPos, { continued: true })
                   .font('Helvetica').text(recepcionText);

                const fechaEnt = log.event_fecha_entrega || log.fecha_entrega_real;
                doc.font('Helvetica-Bold').text('Fecha de Entrega: ', colRight, boxYPos + 9, { continued: true })
                   .font('Helvetica').text(fechaEnt ? new Date(fechaEnt).toLocaleString('es-AR') : 'S/D');

                const tieneFirma = log.firma_digital !== null && log.firma_digital !== undefined && String(log.firma_digital).trim() !== '';
                if (tieneFirma) {
                    doc.font('Helvetica-Bold').text('Conformidad: ', colRight, boxYPos + 18, { continued: true })
                       .font('Helvetica').text('Confirmada digitalmente (QR / Firma)');
                }
            } else {
                doc.text('No se encontraron registros de logística o despacho asociados en el sistema.', leftColumn + 25, boxYPos);
            }

            yPos += detailedBoxHeight + 10;
        } else if (esDetalladoHoras) {
            doc.save();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).fillColor('#faf5ff').fill();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).strokeColor('#d8b4fe').lineWidth(0.5).stroke();
            doc.restore();

            let boxYPos = yPos + 7;
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#7e22ce');
            doc.text(`DESGLOSE DE JORNADAS LIQUIDADAS (${mov.jornadas_detalle.length} ${mov.jornadas_detalle.length === 1 ? 'jornada' : 'jornadas'} en depósito)`, leftColumn + 25, boxYPos);
            
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b');
            doc.text('Fecha', leftColumn + 25, boxYPos + 12);
            doc.text('Horario (Entrada - Salida)', leftColumn + 90, boxYPos + 12);
            doc.text('Horas', leftColumn + 235, boxYPos + 12, { width: 45, align: 'right' });
            doc.text('Tarifa / Hora', leftColumn + 295, boxYPos + 12, { width: 65, align: 'right' });
            doc.text('Subtotal', leftColumn + 375, boxYPos + 12, { width: 55, align: 'right' });

            boxYPos += 22;
            doc.font('Helvetica').fontSize(7).fillColor('#334155');
            
            let sumHoras = 0;
            let sumMonto = 0;
            
            mov.jornadas_detalle.forEach(j => {
                const fIng = new Date(j.fecha_ingreso);
                const fEgr = j.fecha_egreso ? new Date(j.fecha_egreso) : null;
                const diaStr = fIng.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const horaIngStr = fIng.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                const horaEgrStr = fEgr ? fEgr.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'En curso';
                
                const hsVal = parseFloat(j.horas_totales) || 0;
                const minVal = parseInt(j.minutos_totales) || Math.round(hsVal * 60);
                const hEntera = Math.floor(minVal / 60);
                const mResto = minVal % 60;
                const duracionStr = `${horaIngStr} a ${horaEgrStr} (${hEntera}h ${mResto}m)`;
                
                const tarifaVal = parseFloat(j.valor_hora_aplicado) || 0;
                const subVal = parseFloat(j.monto_total) || (hsVal * tarifaVal);
                
                sumHoras += hsVal;
                sumMonto += subVal;

                doc.text(diaStr, leftColumn + 25, boxYPos);
                doc.text(duracionStr, leftColumn + 90, boxYPos);
                doc.text(`${hsVal.toFixed(2)} hs`, leftColumn + 235, boxYPos, { width: 45, align: 'right' });
                doc.text(formatCurrency(tarifaVal), leftColumn + 295, boxYPos, { width: 65, align: 'right' });
                doc.text(formatCurrency(subVal), leftColumn + 375, boxYPos, { width: 55, align: 'right' });
                boxYPos += 13;
            });

            // Línea de totales
            doc.moveTo(leftColumn + 25, boxYPos).lineTo(leftColumn + 430, boxYPos).strokeColor('#d8b4fe').lineWidth(0.5).stroke();
            boxYPos += 4;

            doc.fontSize(7).font('Helvetica-Bold').fillColor('#7e22ce');
            doc.text(`TOTAL LIQUIDADO (${mov.jornadas_detalle.length} JORNADAS):`, leftColumn + 25, boxYPos);
            doc.text(`${sumHoras.toFixed(2)} hs`, leftColumn + 235, boxYPos, { width: 45, align: 'right' });
            doc.text(formatCurrency(sumMonto), leftColumn + 375, boxYPos, { width: 55, align: 'right' });

            yPos += detailedBoxHeight + 10;
        } else if (esDetalladoRendimiento) {
            doc.save();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).fillColor('#f0fdf4').fill();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).strokeColor('#86efac').lineWidth(0.5).stroke();
            doc.restore();

            let boxYPos = yPos + 7;
            const meta = mov.meta_parsed || (mov.metadatos ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos) : {});
            const nroCarro = meta.carro_id ? `#${meta.carro_id}` : 'Externo';
            
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#15803d');
            doc.text(`DESGLOSE DE PRODUCCIÓN EXTERNA / RENDIMIENTO (CARRO ${nroCarro})`, leftColumn + 25, boxYPos);
            
            doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b');
            doc.text('Artículo Elaborado / Proceso', leftColumn + 25, boxYPos + 12);
            doc.text('Cantidad', leftColumn + 235, boxYPos + 12, { width: 45, align: 'right' });
            doc.text('Tarifa / Unidad', leftColumn + 295, boxYPos + 12, { width: 65, align: 'right' });
            doc.text('Subtotal', leftColumn + 375, boxYPos + 12, { width: 55, align: 'right' });

            boxYPos += 22;
            doc.font('Helvetica').fontSize(7).fillColor('#334155');

            const artNombre = meta.articulo_nombre || meta.articulo_codigo || 'Producción';
            const artCodigo = meta.articulo_codigo ? ` (${meta.articulo_codigo})` : '';
            const cantVal = parseFloat(meta.cantidad) || 1;
            const umVal = meta.unidad_medida || 'kg';
            const montoVal = parseFloat(mov.monto) || 0;
            const tarifaUnit = cantVal > 0 ? (montoVal / cantVal) : montoVal;

            let tareaDesc = '';
            if (mov.produccion_articulos && mov.produccion_articulos.length > 0) {
                tareaDesc = ` | Tarea: ${mov.produccion_articulos[0].descripcion}`;
            }

            doc.text(`${artNombre}${artCodigo}${tareaDesc}`, leftColumn + 25, boxYPos, { width: 205 });
            doc.text(`${cantVal.toFixed(2)} ${umVal}`, leftColumn + 235, boxYPos, { width: 45, align: 'right' });
            doc.text(formatCurrency(tarifaUnit), leftColumn + 295, boxYPos, { width: 65, align: 'right' });
            doc.text(formatCurrency(montoVal), leftColumn + 375, boxYPos, { width: 55, align: 'right' });

            yPos += detailedBoxHeight + 10;
        } else if (esDetalladoPago) {
            doc.save();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).fillColor('#fef2f2').fill();
            doc.roundedRect(leftColumn + 15, yPos, contentWidth - 30, detailedBoxHeight, 4).strokeColor('#fecaca').lineWidth(0.5).stroke();
            doc.restore();

            let boxYPos = yPos + 7;
            let nroTransfStr = mov.numero_comprobante || `PAGO-TRANSF-${String(mov.id).padStart(8, '0')}`;
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#991b1b');
            doc.text('DETALLE DE PAGO / TRANSFERENCIA BANCARIA EMITIDA', leftColumn + 25, boxYPos);

            boxYPos += 14;
            doc.fontSize(7).font('Helvetica').fillColor('#334155');
            doc.text(`Banco: Banco Galicia   |   Tipo: Transferencia a Terceros   |   Comprobante: ${nroTransfStr}   |   Importe: - ${formatCurrency(mov.monto)}`, leftColumn + 25, boxYPos, { width: contentWidth - 50 });

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
    const num = Number(value);
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2
    }).format(Number.isFinite(num) ? num : 0);
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
/**
 * Obtiene el buffer PDF y los datos del movimiento de un comprobante individual
 */
async function obtenerComprobantePdfBuffer(movimientoId, syncArqueoPayload = null) {
    // 1. Buscar el movimiento en la base de datos
    const queryMov = `
        SELECT m.*, cc.codigo_bunker_cliente, cc.saldo AS saldo_actual, bc.razon_social, bc.cuit_cuil AS cuit 
        FROM public.factura_cuenta_corriente_movimientos m
        JOIN public.factura_cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
        LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente
        WHERE m.id = $1
    `;
    const resMov = await pool.query(queryMov, [parseInt(movimientoId)]);

    if (resMov.rows.length === 0) {
        throw new Error('Movimiento no encontrado.');
    }

    const mov = resMov.rows[0];

    // 1b. Si se recibió desglose_auditado / diferencias_arqueo desde Recepción de Efectivo, sincronizar en metadatos
    if (syncArqueoPayload && typeof syncArqueoPayload === 'object') {
        try {
            const currentMeta = mov.metadatos
                ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
                : {};
            const mergedMeta = {
                ...currentMeta,
                ...(syncArqueoPayload.desglose_auditado ? { desglose_auditado: syncArqueoPayload.desglose_auditado } : {}),
                ...(Array.isArray(syncArqueoPayload.diferencias_arqueo) ? { diferencias_arqueo: syncArqueoPayload.diferencias_arqueo } : {})
            };
            await pool.query(
                `UPDATE public.factura_cuenta_corriente_movimientos SET metadatos = $1 WHERE id = $2`,
                [JSON.stringify(mergedMeta), mov.id]
            );
            mov.metadatos = mergedMeta;
        } catch (errMeta) {
            console.warn('⚠️ [CC-CONTROLLER] No se pudo actualizar metadatos de arqueo en movimiento:', errMeta.message);
        }
    }

    // 2. Determinar si es un comprobante de facturacion (FC, NC, ND, PENDIENTE) o de pago (RC)
    const isFactura = ['FACTURA', 'FACTURA_A', 'NOTA_CREDITO', 'NOTA_DEBITO', 'PENDIENTE_FACTURACION'].includes(mov.tipo_comprobante);

    if (isFactura && mov.comprobante_id) {
        console.log(`\ud83d\udd04 [CC-CONTROLLER] Reenviando solicitud de PDF para Factura ID: ${mov.comprobante_id} al modulo de Facturacion...`);
        const response = await fetch(`http://localhost:3004/facturacion/facturas/${mov.comprobante_id}/pdf`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return { buffer, mov };
    } else {
        // Es un recibo de pago o cobro (RECIBO_PAGO, COBRO_BANCARIO, COBRO_CHEQUE, AJUSTE_MANUAL, AJUSTE_AUTOMATICO, etc.)
        console.log(`\ud83d\udcc4 [CC-CONTROLLER] Generando recibo PDF en caliente para Movimiento ID: ${mov.id}`);

        if (mov.cuenta_corriente_id) {
            try {
                mov.salvavidas_info = await salvavidasService.calcularSimulacionCuenta(mov.cuenta_corriente_id, { persistir_sombra: false }, pool);
            } catch (errSalv) {
                console.warn('⚠️ [CC-CONTROLLER] No se pudo calcular salvavidas para recibo PDF:', errSalv.message);
            }
        }
        
        return new Promise((resolve, reject) => {
            const esPagoDoc = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
            const esAjusteDoc = ['AJUSTE_MANUAL', 'AJUSTE_AUTOMATICO'].includes(mov.tipo_comprobante);
            const docTitlePrefix = esPagoDoc ? 'Comprobante de Pago' : (esAjusteDoc ? 'Comprobante de Ajuste' : 'Recibo de Pago');
            const docNro = mov.numero_comprobante || (esPagoDoc ? `PAGO-TRANSF-${String(mov.id).padStart(8, '0')}` : mov.id);
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 40, bottom: 25, left: 40, right: 40 },
                info: {
                    Title: `${docTitlePrefix} - ${docNro}`,
                    Author: 'LAMDA'
                }
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), mov }));
            doc.on('error', err => reject(err));

            dibujarReciboPDF(doc, mov);
            doc.end();
        });
    }
}

/**
 * Dibuja el contenido del recibo en el documento PDF
 */
function dibujarReciboPDF(doc, mov) {
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
    doc.text('Direcci\u00f3n: Av. 19 N\u00ba 406', leftColumn, companyY);
    doc.text('Condici\u00f3n frente al IVA: Responsable Inscripto', leftColumn, companyY + 9);
    doc.text('Tel / WA: 221-6615746', leftColumn, companyY + 18);
    doc.text('CUIT: 23-24892174-9', leftColumn, companyY + 27);

    const esAjuste = ['AJUSTE_MANUAL', 'AJUSTE_AUTOMATICO'].includes(mov.tipo_comprobante);
    const esPagoEmitido = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
    const themeColor = esPagoEmitido ? '#991b1b' : (esAjuste ? '#0369a1' : '#8e4785');
    const boxLetter = esPagoEmitido ? 'P' : (esAjuste ? 'A' : 'R');
    const boxLabel = esPagoEmitido ? 'PAGO EMITIDO' : (esAjuste ? 'AJUSTE' : 'COMPROBANTE');
    const labelTitulo = esAjuste ? 'COMPROBANTE DE AJUSTE' : (esPagoEmitido ? 'COMPROBANTE DE PAGO' : 'RECIBO DE PAGO');

    // Letra distintiva en recuadro
    const boxWidth = 32;
    const boxHeight = 32;
    const boxX = (pageWidth / 2) - (boxWidth / 2);
    const boxY = 40;
    doc.save();
    doc.rect(boxX, boxY, boxWidth, boxHeight).fillColor(themeColor).fill();
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff').text(boxLetter, boxX, boxY + 6, { width: boxWidth, align: 'center' });
    doc.restore();
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(themeColor).text(boxLabel, (pageWidth / 2) - 35, boxY + boxHeight + 4, { width: 70, align: 'center' });

    // Linea divisoria vertical
    doc.moveTo(pageWidth / 2, boxY + boxHeight + 16)
       .lineTo(pageWidth / 2, 40 + 82)
       .strokeColor('#e2e8f0')
       .lineWidth(1)
       .stroke();

    // Columna Derecha - Datos del Comprobante
    let rightY = 40;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(themeColor).text(labelTitulo, (pageWidth / 2) + 35, rightY);
    
    let nroComprobanteStr = mov.numero_comprobante;
    if (!nroComprobanteStr || (esPagoEmitido && nroComprobanteStr.startsWith('REC-'))) {
        nroComprobanteStr = esPagoEmitido 
            ? `PAGO-TRANSF-${String(mov.id).padStart(8, '0')}`
            : (esAjuste ? `AJUSTE-${String(mov.id).padStart(8, '0')}` : `REC-PAGO-${String(mov.id).padStart(8, '0')}`);
    }
    if (nroComprobanteStr.includes('[')) {
        const parts = nroComprobanteStr.split('[');
        const firstPart = parts[0].trim();
        if (firstPart.startsWith('Val Ch')) {
            nroComprobanteStr = firstPart;
        } else {
            const matchVto = nroComprobanteStr.match(/Vto:\s*([^\s\]]+)/i);
            if (matchVto) {
                nroComprobanteStr = `${firstPart} (Vto: ${matchVto[1]})`;
            } else {
                nroComprobanteStr = firstPart;
            }
        }
    }
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text(`Nro: ${nroComprobanteStr}`, (pageWidth / 2) + 35, rightY + 14);
    doc.fontSize(8).font('Helvetica').fillColor('#475569').text(`Fecha de Emisi\u00f3n: ${new Date(mov.fecha_movimiento).toLocaleDateString('es-AR')}`, (pageWidth / 2) + 35, rightY + 26);
    doc.text(`C\u00f3digo Cliente: ${mov.codigo_bunker_cliente || 'N/D'}`, (pageWidth / 2) + 35, rightY + 35);
    
    if (mov.cuit) {
        doc.text(`CUIT Cliente: ${mov.cuit}`, (pageWidth / 2) + 35, rightY + 44);
    }

    // Bloque del Receptor (Cliente)
    let clientBoxY = 40 + 82 + 20;
    doc.save();
    doc.rect(leftColumn, clientBoxY, contentWidth, 34).fillColor('#f8fafc').fill();
    doc.rect(leftColumn, clientBoxY, contentWidth, 34).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.restore();

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(themeColor).text(esPagoEmitido ? 'DESTINATARIO / BENEFICIARIO' : 'RECEPTOR / CLIENTE', leftColumn + 10, clientBoxY + 5);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text(mov.razon_social || 'Cliente Consumidor Final', leftColumn + 10, clientBoxY + 15);

    // Detalle del Comprobante (Tabla de Concepto)
    let tableTop = clientBoxY + 34 + 20;
    const formatCurrencyLocal = (val) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(parseFloat(val) || 0);
    };

    const salvInfo = mov.salvavidas_info || null;
    const impMovRecibo = (salvInfo && salvInfo.imputaciones_por_movimiento)
        ? salvInfo.imputaciones_por_movimiento[String(mov.id)]
        : null;
    const metaRecibo = mov.metadatos
        ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
        : {};
    const tieneDesgloseCapitalInteres = Boolean(
        (impMovRecibo && impMovRecibo.tiene_financiacion_imputada) ||
        metaRecibo.es_desglose_separado_en_cc
    );
    let tableHeight = tieneDesgloseCapitalInteres ? 78 : 60;

    // Encabezado de Tabla
    doc.save();
    doc.rect(leftColumn, tableTop, contentWidth, 20).fillColor(themeColor).fill();
    doc.restore();

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ffffff').text('CONCEPTO / RAZ\u00d3N DEL COMPROBANTE', leftColumn + 10, tableTop + 6);
    doc.text(esPagoEmitido ? 'MONTO PAGADO' : 'IMPORTE', pageWidth - leftColumn - 108, tableTop + 6, { width: 100, align: 'right' });

    let rowY = tableTop + 20;
    doc.save();
    doc.rect(leftColumn, rowY, contentWidth, tableHeight).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.restore();

    if (tieneDesgloseCapitalInteres) {
        const capCanc = impMovRecibo?.capital_cancelado_total ?? metaRecibo.capital_cancelado_sobre ?? mov.monto;
        const intConIva = impMovRecibo?.financiacion_con_iva_cancelada ?? metaRecibo.financiacion_con_iva_sobre ?? 0;
        const intNeto = impMovRecibo?.financiacion_neta_cancelada ?? metaRecibo.financiacion_neta_sobre ?? 0;
        const intIva = impMovRecibo?.financiacion_iva_cancelada ?? metaRecibo.financiacion_iva_sobre ?? 0;
        const totalSobreRecibo = impMovRecibo?.monto_pago_total ?? metaRecibo.monto_total_sobre ?? (parseFloat(capCanc) + parseFloat(intConIva));
        const refSobreStr = metaRecibo.codigo_sobre
            ? `Sobre #${metaRecibo.codigo_sobre}`
            : (metaRecibo.movimiento_bancario_id ? `Transferencia [Mov: ${metaRecibo.movimiento_bancario_id}]` : `Recibo #${mov.id}`);
        const refFacInt = (impMovRecibo?.financiacion_facturada && impMovRecibo?.factura_financiacion_descripcion)
            ? ` · ${impMovRecibo.factura_financiacion_descripcion.split('—')[0].trim()}`
            : (metaRecibo.financiacion_facturada_nro ? ` · ${metaRecibo.financiacion_facturada_nro}` : '');

        // Renglón 1: Cancelación de Capital
        doc.fontSize(8.2).font('Helvetica-Bold').fillColor('#0f766e').text(
            `1. Cancelaci\u00f3n de Capital ya facturado (${refSobreStr})`,
            leftColumn + 10,
            rowY + 7,
            { width: contentWidth - 130 }
        );
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f766e').text(
            formatCurrencyLocal(capCanc),
            pageWidth - leftColumn - 108,
            rowY + 7,
            { width: 100, align: 'right' }
        );

        doc.moveTo(leftColumn + 8, rowY + 23).lineTo(leftColumn + contentWidth - 8, rowY + 23).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        // Renglón 2: Cancelación de Interés de Financiación
        doc.fontSize(8.2).font('Helvetica-Bold').fillColor('#b45309').text(
            `2. Cancelaci\u00f3n de Inter\u00e9s de Financiaci\u00f3n (${formatCurrencyLocal(intNeto)} neto + ${formatCurrencyLocal(intIva)} IVA 21%)${refFacInt}`,
            leftColumn + 10,
            rowY + 28,
            { width: contentWidth - 130 }
        );
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#b45309').text(
            formatCurrencyLocal(intConIva),
            pageWidth - leftColumn - 108,
            rowY + 28,
            { width: 100, align: 'right' }
        );

        // Banda inferior de Total Recibido en el Sobre
        doc.save();
        doc.rect(leftColumn + 1, rowY + 50, contentWidth - 2, 27).fillColor('#f0fdf4').fill();
        doc.moveTo(leftColumn, rowY + 50).lineTo(leftColumn + contentWidth, rowY + 50).strokeColor('#cbd5e1').lineWidth(0.6).stroke();
        doc.restore();

        doc.fontSize(8.8).font('Helvetica-Bold').fillColor('#1e293b').text(
            `TOTAL RECIBIDO E IMPUTADO (${refSobreStr} — Capital + Inter\u00e9s):`,
            leftColumn + 10,
            rowY + 59,
            { width: contentWidth - 130 }
        );
        doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#16a34a').text(
            formatCurrencyLocal(totalSobreRecibo),
            pageWidth - leftColumn - 108,
            rowY + 58,
            { width: 100, align: 'right' }
        );
    } else {
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#1e293b').text(mov.descripcion || 'Cobro o ajuste imputado en cuenta corriente.', leftColumn + 10, rowY + 8, { width: contentWidth - 130 });
        if (esPagoEmitido) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#b91c1c').text(`- ${formatCurrencyLocal(mov.monto)}`, pageWidth - leftColumn - 108, rowY + 12, { width: 100, align: 'right' });
        } else {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#16a34a').text(formatCurrencyLocal(mov.monto), pageWidth - leftColumn - 108, rowY + 12, { width: 100, align: 'right' });
        }
    }

    // Metodos de Pago o Metadata Adicional
    let metaY = rowY + tableHeight + 10;
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(themeColor).text('METADATOS DE TRANSACCIÓN', leftColumn, metaY);
    
    // Determinar forma de cobro por defecto segun el tipo de comprobante
    let defaultTipo = esPagoEmitido ? 'Transferencia Bancaria Emitida (Banco Galicia)' : 'Efectivo';
    if (mov.tipo_comprobante === 'COBRO_BANCARIO') defaultTipo = 'Transferencia';
    else if (mov.tipo_comprobante === 'COBRO_CHEQUE') defaultTipo = 'Cheque';
    else if (mov.tipo_comprobante === 'AJUSTE_MANUAL' || mov.tipo_comprobante === 'AJUSTE_AUTOMATICO') defaultTipo = 'Ajuste de Saldo';

    let metaText = esPagoEmitido ? `Tipo de operación: ${defaultTipo}` : `Forma de cobro: ${defaultTipo}`;
    let desgloseText = '';
    let diferenciaArqueoText = '';
    let extraMetaText = '';

    if (mov.metadatos) {
        const meta = typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos;
        const tipoPago = meta.tipo_pago || defaultTipo;
        metaText = `Forma de cobro: ${tipoPago}`;
        if (meta.codigo_sobre) metaText += ` | Sobre N\u00ba: ${meta.codigo_sobre}`;
        if (meta.banco_origen) metaText += ` | Banco de origen: ${meta.banco_origen}`;
        if (meta.nro_operacion) metaText += ` | Operaci\u00f3n Nro: ${meta.nro_operacion}`;
        if (meta.auditado_por) extraMetaText += `Recepci\u00f3n / Auditor\u00eda: ${meta.auditado_por}`;

        const desgloseReal = (meta.desglose_auditado && typeof meta.desglose_auditado === 'object' && Object.keys(meta.desglose_auditado).length > 0)
            ? meta.desglose_auditado
            : meta.desglose_billetes;

        if (desgloseReal && typeof desgloseReal === 'object') {
            const billetesArr = Object.entries(desgloseReal)
                .filter(([_, cant]) => parseInt(cant, 10) > 0)
                .sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10))
                .map(([den, cant]) => {
                    const denNum = parseInt(den, 10);
                    const cantNum = parseInt(cant, 10);
                    const declCant = (meta.desglose_billetes && meta.desglose_billetes[den] !== undefined)
                        ? parseInt(meta.desglose_billetes[den], 10)
                        : cantNum;
                    const sufijoDif = declCant !== cantNum ? ` (decl: ${declCant} u.)` : '';
                    return `${cantNum}x $${denNum.toLocaleString('es-AR')}${sufijoDif}`;
                });

            if (billetesArr.length > 0) {
                desgloseText = `Billetes contados en arqueo: ${billetesArr.join(' \u2022 ')}`;
            }
        }

        const montoDecl = parseFloat(meta.monto_declarado) || 0;
        const montoAud = parseFloat(meta.monto_auditado || mov.monto) || 0;
        if (montoDecl > 0 && Math.abs(montoAud - montoDecl) >= 0.01) {
            const difVal = montoAud - montoDecl;
            const signoDif = difVal > 0 ? '+' : '-';
            diferenciaArqueoText = `Nota de Arqueo: Declarado ${formatCurrencyLocal(montoDecl)} vs. Contado Real ${formatCurrencyLocal(montoAud)} (Dif: ${signoDif}${formatCurrencyLocal(Math.abs(difVal))})`;
            if (Array.isArray(meta.diferencias_arqueo) && meta.diferencias_arqueo.length > 0) {
                const detStr = meta.diferencias_arqueo.map(d =>
                    `Denom. $${Number(d.denom).toLocaleString('es-AR')}: contados ${d.contado} u. s/ ${d.declarado} u. declaradas`
                ).join('; ');
                diferenciaArqueoText += ` — ${detStr}`;
            } else if (meta.observaciones) {
                diferenciaArqueoText += ` — ${meta.observaciones}`;
            }
        } else if (meta.observaciones) {
            extraMetaText += (extraMetaText ? ' | ' : '') + `Obs: ${meta.observaciones}`;
        }
    }

    doc.fontSize(8).font('Helvetica').fillColor('#475569').text(metaText, leftColumn + 8, metaY + 10, { width: pageWidth - leftColumn - 245 });
    
    let curMetaY = metaY + 20;
    if (desgloseText) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#16a34a').text(desgloseText, leftColumn + 8, curMetaY, { width: pageWidth - leftColumn - 245 });
        curMetaY += 11;
    }
    if (diferenciaArqueoText) {
        doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#b45309').text(diferenciaArqueoText, leftColumn + 8, curMetaY, { width: pageWidth - leftColumn - 245 });
        curMetaY += 18;
    }
    if (extraMetaText) {
        doc.fontSize(7.2).font('Helvetica').fillColor('#64748b').text(extraMetaText, leftColumn + 8, curMetaY, { width: pageWidth - leftColumn - 245 });
    }

    // Cuadro de Totales y Saldo Consolidado (integrando Salvavidas de Financiación + IVA si aplica)
    let totalsY = tableTop + tableHeight + 12;
    const saldoCapital = parseFloat((mov.saldo_actual !== undefined && mov.saldo_actual !== null) ? mov.saldo_actual : mov.saldo_resultante) || 0;
    const tieneSalvavidasHabilitado = Boolean(salvInfo && salvInfo.reglas_aplicadas && salvInfo.reglas_aplicadas.habilitado);
    const tieneInteresActivo = Boolean(tieneSalvavidasHabilitado && salvInfo.financiacion_total_con_iva > 0);
    const saldoTotalConIva = tieneInteresActivo ? parseFloat(salvInfo.saldo_total_proyectado_con_iva) : saldoCapital;

    const balBoxW = 235;
    const balBoxX = pageWidth - leftColumn - balBoxW;
    const balBoxH = tieneInteresActivo ? 88 : 54;

    doc.save();
    doc.roundedRect(balBoxX, totalsY, balBoxW, balBoxH, 4).fillColor(tieneInteresActivo ? '#fff1f2' : '#f8fafc').fill();
    doc.roundedRect(balBoxX, totalsY, balBoxW, balBoxH, 4).strokeColor(tieneInteresActivo ? '#e11d48' : '#cbd5e1').lineWidth(0.8).stroke();
    doc.restore();

    if (tieneInteresActivo) {
        const tasaPct = salvInfo.reglas_aplicadas?.tasa_servicio_financiero || 3;
        const disp = salvInfo.reglas_aplicadas?.cortesias_disponibles_anio ?? 3;
        const cupo = salvInfo.reglas_aplicadas?.cupo_cortesias_anual ?? 3;
        const finNeta = salvInfo.financiacion_total ?? salvInfo.financiacion_neta_total ?? 0;
        const finIva = salvInfo.financiacion_iva ?? salvInfo.financiacion_iva_total ?? 0;

        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#8e4785').text('SALDO TOTAL CONSOLIDADO (C/IVA)', balBoxX + 8, totalsY + 6);
        doc.fontSize(6.2).font('Helvetica-Bold').fillColor('#6b21a8').text(
            `Comodines Año: ${disp}/${cupo} disp.`,
            balBoxX + 125,
            totalsY + 6,
            { width: balBoxW - 133, align: 'right' }
        );
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#b91c1c').text('SALVAVIDAS DE FINANCIACIÓN ACTIVO', balBoxX + 8, totalsY + 15);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#b91c1c').text(`TOTAL: ${formatCurrencyLocal(saldoTotalConIva)}`, balBoxX + 8, totalsY + 25);

        const yBreak = totalsY + 41;
        doc.save();
        doc.roundedRect(balBoxX + 6, yBreak, balBoxW - 12, 41, 3).fillColor('#ffffff').fill();
        doc.roundedRect(balBoxX + 6, yBreak, balBoxW - 12, 41, 3).strokeColor('#fecdd3').lineWidth(0.6).stroke();
        doc.restore();

        doc.fontSize(6.5).font('Helvetica').fillColor('#334155').text('Capital de comprobantes:', balBoxX + 10, yBreak + 4);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#1e293b').text(formatCurrencyLocal(saldoCapital), balBoxX + 120, yBreak + 4, { width: balBoxW - 130, align: 'right' });

        doc.fontSize(6.2).font('Helvetica').fillColor('#9a3412').text(`+ Salvavidas ${tasaPct}% (${formatCurrencyLocal(finNeta)}) + IVA (${formatCurrencyLocal(finIva)}):`, balBoxX + 10, yBreak + 15);
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#b45309').text(`+ ${formatCurrencyLocal(salvInfo.financiacion_total_con_iva)}`, balBoxX + 150, yBreak + 15, { width: balBoxW - 160, align: 'right' });

        doc.moveTo(balBoxX + 10, yBreak + 26).lineTo(balBoxX + balBoxW - 10, yBreak + 26).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#881337').text('Total Real a Pagar Hoy (c/IVA):', balBoxX + 10, yBreak + 29);
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#b91c1c').text(formatCurrencyLocal(saldoTotalConIva), balBoxX + 135, yBreak + 29, { width: balBoxW - 145, align: 'right' });
    } else {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569').text('SALDO DE CUENTA RESULTANTE', balBoxX + 10, totalsY + 8);
        doc.fontSize(13).font('Helvetica-Bold').fillColor(saldoCapital <= 0.005 ? '#047857' : '#1e293b').text(formatCurrencyLocal(saldoCapital), balBoxX + 10, totalsY + 21, { width: balBoxW - 20, align: 'left' });
        if (tieneSalvavidasHabilitado && saldoCapital > 0.005) {
            const disp = salvInfo.reglas_aplicadas?.cortesias_disponibles_anio ?? 3;
            const cupo = salvInfo.reglas_aplicadas?.cupo_cortesias_anual ?? 3;
            doc.fontSize(6.2).font('Helvetica-Bold').fillColor('#047857').text(
                `0% Financiación Bonificada · Comodines: ${disp}/${cupo} disp.`,
                balBoxX + 10,
                totalsY + 38
            );
        } else if (saldoCapital <= 0.005) {
            const txtCero = (impMovRecibo && impMovRecibo.tiene_financiacion_bonificada)
                ? `Cuenta al día ($ 0,00) · Financiación (${formatCurrencyLocal(impMovRecibo.financiacion_bonificada_con_iva)}) 100% Bonificada`
                : `Cuenta Corriente al día (Sin comprobantes pendientes)`;
            doc.fontSize(6.1).font('Helvetica-Bold').fillColor('#047857').text(
                txtCero,
                balBoxX + 10,
                totalsY + 38,
                { width: balBoxW - 18 }
            );
        }
    }

    let nextBlockY = Math.max(curMetaY + 8, totalsY + balBoxH + 14);
    const capasAbiertasRec = (tieneSalvavidasHabilitado && Array.isArray(salvInfo.comprobantes)) ? salvInfo.comprobantes : [];
    const tieneBonifEnRecibo = Boolean(impMovRecibo && impMovRecibo.tiene_financiacion_bonificada);

    // Bloque explicativo de Imputación del Pago y Continuidad de Deuda
    if (tieneSalvavidasHabilitado && ((impMovRecibo && (impMovRecibo.tiene_financiacion_imputada || tieneBonifEnRecibo)) || capasAbiertasRec.length > 0)) {
        const cantCapas = capasAbiertasRec.length;
        const tieneImp = Boolean(impMovRecibo && impMovRecibo.tiene_financiacion_imputada);
        const boxDetH = 22 + ((tieneImp || tieneBonifEnRecibo) ? 36 : 16) + (cantCapas > 0 ? 18 + (cantCapas * 14) : 14);

        doc.save();
        doc.roundedRect(leftColumn, nextBlockY, contentWidth, boxDetH, 4).fillColor('#f8fafc').fill();
        doc.roundedRect(leftColumn, nextBlockY, contentWidth, boxDetH, 4).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
        doc.roundedRect(leftColumn, nextBlockY, contentWidth, 16, 4).fillColor('#f1f5f9').fill();
        doc.restore();

        doc.fontSize(7.4).font('Helvetica-Bold').fillColor('#475569').text(
            'DETALLE DE IMPUTACIÓN DEL PAGO Y CONTINUIDAD DE COMPROBANTES EN CUENTA CORRIENTE',
            leftColumn + 10,
            nextBlockY + 4.5
        );

        let yDet = nextBlockY + 21;
        if (tieneImp) {
            const dets = (impMovRecibo.detalles_comprobantes || []).filter(d => d.con_financiacion);
            const docsStr = dets.map(d => (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim()).join(' + ');
            const tagComp = impMovRecibo.financiacion_facturada && impMovRecibo.factura_financiacion_descripcion
                ? ` (${impMovRecibo.factura_financiacion_descripcion.split('—')[0].trim()})`
                : '';

            doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#0f766e').text(
                `1) ¿Qué canceló este pago de ${formatCurrencyLocal(mov.monto)}?`,
                leftColumn + 10,
                yDet
            );
            yDet += 10.5;
            doc.fontSize(6.9).font('Helvetica').fillColor('#1e293b').text(
                `Canceló ${formatCurrencyLocal(impMovRecibo.capital_cancelado_total)} de capital sobre ${docsStr || 'comprobantes vencidos'} + ${formatCurrencyLocal(impMovRecibo.financiacion_con_iva_cancelada)} de financiación devengada hasta la fecha del pago (${formatCurrencyLocal(impMovRecibo.financiacion_neta_cancelada)} neto + ${formatCurrencyLocal(impMovRecibo.financiacion_iva_cancelada)} IVA 21%)${tagComp}. Esa porción de capital e interés queda 100% saldada y deja de generar cargos.`,
                leftColumn + 10,
                yDet,
                { width: contentWidth - 20 }
            );
            yDet += 23;
        } else if (tieneBonifEnRecibo) {
            const detsBonif = (impMovRecibo.detalles_comprobantes || []).filter(d => d.con_financiacion_bonificada);
            const docsBonifStr = detsBonif.map(d => {
                const nom = (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
                return `${nom} (${d.dias_al_pago} días)`;
            }).join(' + ');

            doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#047857').text(
                `1) Imputación 100% a Capital con Bonificación del Servicio de Financiación (${formatCurrencyLocal(mov.monto)}):`,
                leftColumn + 10,
                yDet
            );
            yDet += 10.5;
            doc.fontSize(6.9).font('Helvetica').fillColor('#1e293b').text(
                `Este pago canceló el 100% del capital de ${docsBonifStr || 'su comprobante pendiente'}. El cargo de Servicio de Financiación devengado de ${formatCurrencyLocal(impMovRecibo.financiacion_bonificada_con_iva)} (${formatCurrencyLocal(impMovRecibo.financiacion_bonificada_neta)} neto + ${formatCurrencyLocal(impMovRecibo.financiacion_bonificada_iva)} IVA 21%) ha sido 100% bonificado por LAMDA en esta oportunidad ($ 0,00 cobrado).`,
                leftColumn + 10,
                yDet,
                { width: contentWidth - 20 }
            );
            yDet += 23;
        } else {
            doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#0f766e').text(
                `1) Imputación directa a capital: Este pago de ${formatCurrencyLocal(mov.monto)} canceló 100% capital sin recargos de financiación.`,
                leftColumn + 10,
                yDet
            );
            yDet += 14;
        }

        doc.moveTo(leftColumn + 10, yDet - 2).lineTo(leftColumn + contentWidth - 10, yDet - 2).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        if (cantCapas > 0) {
            doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#881337').text(
                `2) ¿Cómo continúa el saldo pendiente hoy? (Capital: ${formatCurrencyLocal(saldoCapital)} + Financiación Activa c/IVA: ${formatCurrencyLocal(salvInfo.financiacion_total_con_iva)} = Total: ${formatCurrencyLocal(saldoTotalConIva)})`,
                leftColumn + 10,
                yDet + 2
            );
            yDet += 14;
            for (const cs of capasAbiertasRec) {
                const nomDoc = (cs.descripcion || 'Comprobante').split('(')[0].trim();
                const capPend = cs.capital_pendiente ?? cs.monto_pendiente ?? 0;
                const capOrig = cs.monto_original ?? capPend;
                const finCiva = cs.interes_financiacion_con_iva ?? 0;
                const totCapa = parseFloat((capPend + finCiva).toFixed(2));
                const txtOrig = capPend < capOrig - 0.01 ? ` (de ${formatCurrencyLocal(capOrig)} orig.)` : ' (100% impago)';
                const txtFin = finCiva > 0
                    ? ` + Financiación ${cs.antiguedad_dias}d c/IVA: + ${formatCurrencyLocal(finCiva)} (${formatCurrencyLocal(cs.interes_financiacion)} + IVA ${formatCurrencyLocal(cs.iva_financiacion)}) = Subtotal hoy: ${formatCurrencyLocal(totCapa)}`
                    : ` · 0% Financiación (Día ${cs.antiguedad_dias}) = Subtotal hoy: ${formatCurrencyLocal(capPend)}`;

                doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#0f172a')
                   .text(`• ${nomDoc}: `, leftColumn + 14, yDet, { continued: true })
                   .fillColor('#8e4785').text(`Capital ${formatCurrencyLocal(capPend)}${txtOrig}`, { continued: true })
                   .font('Helvetica').fillColor('#334155').text(txtFin);
                yDet += 13;
            }
        } else {
            doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#047857').text(
                '2) Estado posterior al pago: Cuenta corriente saldada en $ 0,00 (sin comprobantes pendientes).',
                leftColumn + 10,
                yDet + 2
            );
        }

        nextBlockY += boxDetH + 14;
    }

    // Leyenda de firmas/validez
    let footerY = nextBlockY + 10;
    const docConstanciaText = esPagoEmitido
        ? 'Este documento sirve como constancia oficial de emisión de fondos y pago por transferencia bancaria en el sistema administrativo de LAMDA. Generado desde el Portal de Clientes B2B.'
        : 'Este documento sirve como constancia oficial de recepción de fondos en el sistema administrativo de la distribuidora. Generado desde el Portal de Clientes B2B.';
    doc.fontSize(7).font('Helvetica-Oblique').fillColor('#64748b').text(
        docConstanciaText,
        leftColumn,
        footerY,
        { align: 'center', width: contentWidth }
    );
}

/**
 * Formatea fecha/hora en huso horario de Argentina (dd/mm/yyyy - HH:mm hs)
 */
function formatFechaHoraTrazabilidadAR(dateVal) {
    if (!dateVal) return 'No registrado';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'No registrado';
    const fStr = d.toLocaleDateString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const hStr = d.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return `${fStr} — ${hStr} hs`;
}

/**
 * Genera el buffer PDF del Informe de Trazabilidad y Arqueo Físico del Sobre
 */
async function obtenerInformeTrazabilidadSobrePdfBuffer(movimientoId, codigoSobreFallback = null, syncArqueoPayload = null) {
    let mov = null;
    const movIdNum = parseInt(movimientoId, 10);
    if (!isNaN(movIdNum) && movIdNum > 0) {
        const movRes = await pool.query(`
            SELECT 
                m.*,
                cc.codigo_bunker_cliente,
                cc.saldo as saldo_actual,
                COALESCE(bc.razon_social, bc.cliente_nombre) as razon_social,
                bc.cuit_cuil as cuit,
                bc.domicilio_fiscal
            FROM public.factura_cuenta_corriente_movimientos m
            JOIN public.factura_cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
            LEFT JOIN public.bunker_clientes bc ON cc.codigo_bunker_cliente = bc.codigo_bunker_cliente
            WHERE m.id = $1
        `, [movIdNum]);
        if (movRes.rows.length > 0) {
            mov = movRes.rows[0];
        }
    }

    if (mov && syncArqueoPayload && typeof syncArqueoPayload === 'object') {
        try {
            const currentMeta = mov.metadatos
                ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
                : {};
            const mergedMeta = {
                ...currentMeta,
                ...(syncArqueoPayload.desglose_auditado ? { desglose_auditado: syncArqueoPayload.desglose_auditado } : {}),
                ...(Array.isArray(syncArqueoPayload.diferencias_arqueo) ? { diferencias_arqueo: syncArqueoPayload.diferencias_arqueo } : {})
            };
            await pool.query(
                `UPDATE public.factura_cuenta_corriente_movimientos SET metadatos = $1 WHERE id = $2`,
                [JSON.stringify(mergedMeta), mov.id]
            );
            mov.metadatos = mergedMeta;
        } catch (errMeta) {
            console.warn('⚠️ [CC-CONTROLLER] No se pudo actualizar metadatos en obtenerInformeTrazabilidadSobrePdfBuffer:', errMeta.message);
        }
    }

    const meta = (mov && mov.metadatos)
        ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
        : {};
    const codSobreTarget = codigoSobreFallback || meta.codigo_sobre || null;

    const sobreRes = await pool.query(`
        SELECT 
            pe.*,
            r.nombre_ruta,
            r.fecha_salida AS ruta_fecha_salida,
            r.fecha_finalizacion AS ruta_fecha_finalizacion,
            COALESCE(u.nombre_completo, 'Reparto LAMDA') AS chofer_nombre,
            bc.codigo_bunker_cliente AS cliente_codigo_bunker,
            COALESCE(bc.razon_social, bc.cliente_nombre) AS cliente_razon_social,
            bc.cuit_cuil AS cliente_cuit,
            cc.id AS cliente_cuenta_id,
            cc.saldo AS cliente_saldo_cc
        FROM public.factura_pagos_efectivo pe
        LEFT JOIN public.rutas r ON r.id = pe.id_ruta
        LEFT JOIN public.usuarios u ON u.id = r.id_chofer
        LEFT JOIN public.bunker_clientes bc ON (
            pe.cliente_id = bc.codigo_bunker_cliente 
            OR pe.cliente_id = CAST(bc.id AS VARCHAR) 
            OR pe.cliente_id = CAST(bc.lomas_soft_id AS VARCHAR)
        )
        LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = bc.codigo_bunker_cliente
        WHERE ($1::int IS NOT NULL AND pe.local_movimiento_id = $1)
           OR ($2::text IS NOT NULL AND pe.codigo_sobre = $2)
        ORDER BY pe.id DESC
        LIMIT 1
    `, [!isNaN(movIdNum) && movIdNum > 0 ? movIdNum : null, codSobreTarget]);

    const sobre = sobreRes.rows[0] || {};
    const codigoSobre = sobre.codigo_sobre || codSobreTarget || `MOV-${movIdNum}`;

    let salvavidasInfo = null;
    const cuentaIdTarget = mov?.cuenta_corriente_id || sobre.cliente_cuenta_id || null;
    if (cuentaIdTarget) {
        try {
            salvavidasInfo = await salvavidasService.calcularSimulacionCuenta(parseInt(cuentaIdTarget, 10), { persistir_sombra: false }, pool);
        } catch (errSalv) {
            console.warn('⚠️ [CC-CONTROLLER] No se pudo calcular salvavidas para informe de trazabilidad:', errSalv.message);
        }
    }

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 36, bottom: 25, left: 40, right: 40 },
            info: {
                Title: `Informe de Trazabilidad y Arqueo - ${codigoSobre}`,
                Author: 'LAMDA'
            }
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), mov, sobre, codigoSobre }));
        doc.on('error', err => reject(err));

        dibujarInformeTrazabilidadArqueoPDF(doc, { mov, sobre, meta, codigoSobre, salvavidasInfo });
        doc.end();
    });
}

/**
 * Dibuja el Informe de Trazabilidad y Arqueo Físico del Sobre en 1 página A4
 */
function dibujarInformeTrazabilidadArqueoPDF(doc, { mov, sobre, meta, codigoSobre, salvavidasInfo = null }) {
    const pageWidth = doc.page.width;
    const leftColumn = 40;
    const contentWidth = pageWidth - 80;
    const themeColor = '#8e4785';

    const formatCurrencyLocal = (val) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(parseFloat(val) || 0);
    };

    // 1. Cabecera Institucional
    const logoPath = path.join(__dirname, '../../facturacion/img/logo_LAMDA_grande.png');
    let hasLogo = false;
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, leftColumn, 36, { width: 88 });
        hasLogo = true;
    }

    let companyY = 36 + (hasLogo ? 36 : 0);
    doc.fontSize(7.5).font('Helvetica').fillColor('#1e293b');
    doc.text('Dirección: Av. 19 Nº 406  |  Tel / WA: 221-6615746', leftColumn, companyY);
    doc.text('Condición IVA: Responsable Inscripto  |  CUIT: 23-24892174-9', leftColumn, companyY + 10);

    // Recuadro central 'T'
    const boxWidth = 30;
    const boxHeight = 30;
    const boxX = (pageWidth / 2) - (boxWidth / 2);
    const boxY = 36;
    doc.save();
    doc.roundedRect(boxX, boxY, boxWidth, boxHeight, 4).fillColor(themeColor).fill();
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#ffffff').text('T', boxX, boxY + 6, { width: boxWidth, align: 'center' });
    doc.restore();
    doc.fontSize(6).font('Helvetica-Bold').fillColor(themeColor).text('TRAZABILIDAD', (pageWidth / 2) - 38, boxY + boxHeight + 3, { width: 76, align: 'center' });

    // Datos a la derecha
    const montoDeclarado = parseFloat(sobre.monto_declarado ?? meta.monto_declarado ?? mov?.monto ?? 0);
    const montoAuditado = parseFloat(sobre.monto_auditado ?? meta.monto_auditado ?? mov?.monto ?? montoDeclarado);
    const difTotal = montoAuditado - montoDeclarado;
    const hayDiferencia = Math.abs(difTotal) >= 0.01;

    const rightX = (pageWidth / 2) + 28;
    doc.fontSize(10.5).font('Helvetica-Bold').fillColor(themeColor).text('INFORME DE TRAZABILIDAD Y ARQUEO', rightX, 36);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text(`Sobre Nº: #${codigoSobre}`, rightX, 50);
    const nroRecibo = mov?.numero_comprobante || (mov?.id ? `REC-PAGO-${String(mov.id).padStart(8, '0')}` : 'S/D');
    doc.fontSize(8).font('Helvetica').fillColor('#475569').text(`Recibo Vinculado: ${nroRecibo}`, rightX, 62);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(hayDiferencia ? '#b45309' : '#15803d').text(
        hayDiferencia ? 'Dictamen: ARQUEO CON DIFERENCIA' : 'Dictamen: ARQUEO CONFORME SIN DIFERENCIAS',
        rightX,
        73
    );

    // 2. Datos del Cliente
    let yPos = 98;
    doc.save();
    doc.roundedRect(leftColumn, yPos, contentWidth, 34, 4).fillColor('#f8fafc').fill();
    doc.roundedRect(leftColumn, yPos, contentWidth, 34, 4).strokeColor('#cbd5e1').lineWidth(0.6).stroke();
    doc.restore();

    const razonSocial = mov?.razon_social || sobre.cliente_razon_social || 'Cliente';
    const codigoCliente = mov?.codigo_bunker_cliente || sobre.cliente_codigo_bunker || 'S/D';
    const cuitCliente = mov?.cuit || sobre.cliente_cuit || 'S/D';

    doc.fontSize(7).font('Helvetica-Bold').fillColor(themeColor).text('TITULAR DE CUENTA CORRIENTE / REMITENTE DEL SOBRE', leftColumn + 10, yPos + 6);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text(razonSocial, leftColumn + 10, yPos + 17);
    doc.fontSize(8).font('Helvetica').fillColor('#475569').text(
        `Código Cliente: ${codigoCliente}   |   CUIT: ${cuitCliente}`,
        leftColumn + 270,
        yPos + 18,
        { width: contentWidth - 280, align: 'right' }
    );

    // 3. Sección 1: Línea de Tiempo de Trazabilidad del Sobre
    yPos += 46;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(themeColor).text('1. CRONOLOGÍA Y TRAZABILIDAD OPERATIVA DEL SOBRE', leftColumn, yPos);
    yPos += 14;

    const modalidadStr = (sobre.modalidad_entrega || 'CHOFER') === 'SUCURSAL'
        ? 'Entrega en Sucursal / Administración'
        : 'Retiro a Domicilio con Reparto LAMDA';
    const rutaLabel = sobre.id_ruta
        ? `Hoja de Ruta #${sobre.id_ruta} (${sobre.nombre_ruta || 'Reparto LAMDA'})`
        : 'Gestión Directa en Administración';
    const choferLabel = sobre.chofer_nombre || 'Reparto LAMDA';

    const hitos = [
        {
            paso: '1',
            titulo: 'Armado y Aviso de Ensobrado (Portal Clientes B2B)',
            fechaHora: formatFechaHoraTrazabilidadAR(sobre.fecha_creacion || mov?.fecha_movimiento),
            detalle: `Sobre #${codigoSobre} cerrado por el cliente (${modalidadStr}). Monto declarado: ${formatCurrencyLocal(montoDeclarado)}.`
        },
        {
            paso: '2',
            titulo: 'Asignación y Salida en Hoja de Ruta',
            fechaHora: sobre.id_ruta ? formatFechaHoraTrazabilidadAR(sobre.ruta_fecha_salida || sobre.fecha_creacion) : 'Entrega Directa',
            detalle: `${rutaLabel} • Chofer responsable: ${choferLabel}.`
        },
        {
            paso: '3',
            titulo: 'Retiro Físico del Sobre en Domicilio del Cliente',
            fechaHora: formatFechaHoraTrazabilidadAR(sobre.fecha_retiro_chofer || sobre.ruta_fecha_finalizacion),
            detalle: `Recepción del sobre cerrado en el local del cliente y resguardo en unidad de reparto.`
        },
        {
            paso: '4',
            titulo: 'Recepción y Cierre de Hoja de Ruta en Administración',
            fechaHora: formatFechaHoraTrazabilidadAR(sobre.ruta_fecha_finalizacion || sobre.fecha_auditoria),
            detalle: `Arribo de hoja de ruta a administración LAMDA y entrega física del sobre cerrado en tesorería.`
        },
        {
            paso: '5',
            titulo: 'Apertura del Sobre, Arqueo Físico y Acreditación Contable',
            fechaHora: formatFechaHoraTrazabilidadAR(sobre.fecha_auditoria || mov?.fecha_movimiento),
            detalle: `Apertura y conteo físico por ${sobre.auditado_por || meta.auditado_por || 'Administración'}. Acreditado en Recibo ${nroRecibo} por ${formatCurrencyLocal(montoAuditado)}.`
        }
    ];

    // Encabezado de tabla de hitos
    doc.save();
    doc.rect(leftColumn, yPos, contentWidth, 18).fillColor('#f1f5f9').fill();
    doc.rect(leftColumn, yPos, contentWidth, 18).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.restore();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#334155');
    doc.text('ETAPA / HITO DE TRAZABILIDAD', leftColumn + 8, yPos + 5);
    doc.text('FECHA Y HORA EXACTA', leftColumn + 230, yPos + 5);
    doc.text('REGISTRO OPERATIVO', leftColumn + 345, yPos + 5);
    yPos += 18;

    for (const h of hitos) {
        const rowH = 26;
        doc.save();
        doc.rect(leftColumn, yPos, contentWidth, rowH).fillColor('#ffffff').fill();
        doc.rect(leftColumn, yPos, contentWidth, rowH).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc.restore();

        // Badge número de paso
        doc.save();
        doc.circle(leftColumn + 13, yPos + 13, 7).fillColor(themeColor).fill();
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff').text(h.paso, leftColumn + 6, yPos + 9.5, { width: 14, align: 'center' });
        doc.restore();

        doc.fontSize(7.8).font('Helvetica-Bold').fillColor('#0f172a').text(h.titulo, leftColumn + 25, yPos + 5, { width: 198 });
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569').text(h.fechaHora, leftColumn + 230, yPos + 9, { width: 110 });
        doc.fontSize(7).font('Helvetica').fillColor('#334155').text(h.detalle, leftColumn + 345, yPos + 4, { width: contentWidth - 350 });

        yPos += rowH;
    }

    // 4. Sección 2: Tabla Comparativa de Arqueo por Denominación
    yPos += 16;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(themeColor).text('2. DETALLE DE ARQUEO FÍSICO POR DENOMINACIÓN (DECLARADO VS. CONTADO REAL)', leftColumn, yPos);
    yPos += 14;

    const desgloseDeclarado = (sobre.desglose_billetes && typeof sobre.desglose_billetes === 'object')
        ? sobre.desglose_billetes
        : ((meta.desglose_billetes && typeof meta.desglose_billetes === 'object') ? meta.desglose_billetes : {});

    const desgloseContado = (meta.desglose_auditado && typeof meta.desglose_auditado === 'object' && Object.keys(meta.desglose_auditado).length > 0)
        ? meta.desglose_auditado
        : (!hayDiferencia ? desgloseDeclarado : {});

    const todasDenoms = Array.from(new Set([
        ...Object.keys(desgloseDeclarado),
        ...Object.keys(desgloseContado)
    ])).map(d => parseInt(d, 10)).filter(d => !isNaN(d) && d > 0).sort((a, b) => b - a);

    // Encabezado de tabla de denominaciones
    doc.save();
    doc.rect(leftColumn, yPos, contentWidth, 20).fillColor(themeColor).fill();
    doc.restore();

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('DENOMINACIÓN', leftColumn + 8, yPos + 6);
    doc.text('CANT. DECL.', leftColumn + 110, yPos + 6, { width: 65, align: 'right' });
    doc.text('SUBTOTAL DECL.', leftColumn + 180, yPos + 6, { width: 85, align: 'right' });
    doc.text('CANT. CONTADA', leftColumn + 270, yPos + 6, { width: 75, align: 'right' });
    doc.text('SUBTOTAL REAL', leftColumn + 350, yPos + 6, { width: 85, align: 'right' });
    doc.text('DIFERENCIA', leftColumn + 440, yPos + 6, { width: contentWidth - 446, align: 'right' });
    yPos += 20;

    let totalUnidDecl = 0;
    let totalUnidCont = 0;

    if (todasDenoms.length === 0) {
        doc.save();
        doc.rect(leftColumn, yPos, contentWidth, 22).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
        doc.restore();
        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#64748b').text('Sin desglose nominal de billetes registrado.', leftColumn + 10, yPos + 7);
        yPos += 22;
    } else {
        for (const denom of todasDenoms) {
            const cantDecl = parseInt(desgloseDeclarado[denom] || 0, 10);
            const cantCont = (Object.keys(desgloseContado).length > 0)
                ? parseInt(desgloseContado[denom] || 0, 10)
                : cantDecl;
            if (cantDecl === 0 && cantCont === 0) continue;

            totalUnidDecl += cantDecl;
            totalUnidCont += cantCont;

            const subDecl = cantDecl * denom;
            const subCont = cantCont * denom;
            const difUnid = cantCont - cantDecl;
            const difPesos = subCont - subDecl;
            const rowHasDiff = difUnid !== 0;

            const rowH = 20;
            doc.save();
            doc.rect(leftColumn, yPos, contentWidth, rowH).fillColor(rowHasDiff ? '#fffbeb' : '#ffffff').fill();
            doc.rect(leftColumn, yPos, contentWidth, rowH).strokeColor(rowHasDiff ? '#fde68a' : '#e2e8f0').lineWidth(0.5).stroke();
            doc.restore();

            doc.fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text(`Billetes de $ ${denom.toLocaleString('es-AR')}`, leftColumn + 8, yPos + 6);
            doc.fontSize(8).font('Helvetica').fillColor('#475569').text(`${cantDecl} u.`, leftColumn + 110, yPos + 6, { width: 65, align: 'right' });
            doc.text(formatCurrencyLocal(subDecl), leftColumn + 180, yPos + 6, { width: 85, align: 'right' });

            doc.fontSize(8).font('Helvetica-Bold').fillColor(rowHasDiff ? '#b45309' : '#15803d').text(`${cantCont} u.`, leftColumn + 270, yPos + 6, { width: 75, align: 'right' });
            doc.text(formatCurrencyLocal(subCont), leftColumn + 350, yPos + 6, { width: 85, align: 'right' });

            if (rowHasDiff) {
                const sU = difUnid > 0 ? `+${difUnid}` : `${difUnid}`;
                doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#b91c1c').text(
                    `${sU} u. (${difPesos > 0 ? '+' : '-'}${formatCurrencyLocal(Math.abs(difPesos))})`,
                    leftColumn + 435,
                    yPos + 6,
                    { width: contentWidth - 441, align: 'right' }
                );
            } else {
                doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#15803d').text('OK (Sin dif.)', leftColumn + 440, yPos + 6, { width: contentWidth - 446, align: 'right' });
            }

            yPos += rowH;
        }
    }

    // Fila de Totales de Tabla
    doc.save();
    doc.rect(leftColumn, yPos, contentWidth, 22).fillColor('#f1f5f9').fill();
    doc.rect(leftColumn, yPos, contentWidth, 22).strokeColor('#94a3b8').lineWidth(0.7).stroke();
    doc.restore();

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text('TOTALES DEL SOBRE', leftColumn + 8, yPos + 7);
    doc.text(`${totalUnidDecl} billetes`, leftColumn + 110, yPos + 7, { width: 65, align: 'right' });
    doc.text(formatCurrencyLocal(montoDeclarado), leftColumn + 180, yPos + 7, { width: 85, align: 'right' });
    doc.fillColor(hayDiferencia ? '#b45309' : '#15803d').text(`${totalUnidCont} billetes`, leftColumn + 270, yPos + 7, { width: 75, align: 'right' });
    doc.text(formatCurrencyLocal(montoAuditado), leftColumn + 350, yPos + 7, { width: 85, align: 'right' });
    doc.fillColor(hayDiferencia ? '#b91c1c' : '#15803d').text(
        hayDiferencia ? `${difTotal > 0 ? '+' : '-'}${formatCurrencyLocal(Math.abs(difTotal))}` : '$ 0,00',
        leftColumn + 435,
        yPos + 7,
        { width: contentWidth - 441, align: 'right' }
    );
    yPos += 32;

    // 5. Sección 3: Dictamen de Arqueo y Resumen Consolidado de Cuenta Corriente (con Salvavidas + IVA)
    const leftBoxW = 282;
    const rightBoxW = contentWidth - leftBoxW - 10;
    const rightBoxX = leftColumn + leftBoxW + 10;
    const summaryH = 104;

    // Box Izquierdo: Dictamen y Observaciones
    doc.save();
    doc.roundedRect(leftColumn, yPos, leftBoxW, summaryH, 4).fillColor(hayDiferencia ? '#fffbeb' : '#f0fdf4').fill();
    doc.roundedRect(leftColumn, yPos, leftBoxW, summaryH, 4).strokeColor(hayDiferencia ? '#f59e0b' : '#22c55e').lineWidth(0.8).stroke();
    doc.restore();

    doc.fontSize(7.8).font('Helvetica-Bold').fillColor(hayDiferencia ? '#b45309' : '#15803d').text(
        hayDiferencia ? 'DICTAMEN DE AUDITORÍA: DIFERENCIA EN CONTEO' : 'DICTAMEN DE AUDITORÍA: CONTEO FÍSICO CONFORME',
        leftColumn + 10,
        yPos + 8
    );

    let dictamenTexto = '';
    if (hayDiferencia) {
        const signo = difTotal > 0 ? '+' : '-';
        dictamenTexto = `Al realizar la apertura y arqueo físico del sobre #${codigoSobre}, se contabilizó un total real de ${formatCurrencyLocal(montoAuditado)} frente a los ${formatCurrencyLocal(montoDeclarado)} declarados (${signo}${formatCurrencyLocal(Math.abs(difTotal))}).`;
        if (Array.isArray(meta.diferencias_arqueo) && meta.diferencias_arqueo.length > 0) {
            const det = meta.diferencias_arqueo.map(d =>
                `En billetes de $${Number(d.denom).toLocaleString('es-AR')} se contaron ${d.contado} u. sobre ${d.declarado} u. declaradas.`
            ).join(' ');
            dictamenTexto += `\n• ${det}`;
        }
        const obsLimpia = (sobre.observaciones || meta.observaciones || '').split('| Nota:')[1]?.trim();
        if (obsLimpia) {
            dictamenTexto += `\n• Nota de caja: ${obsLimpia}`;
        }
    } else {
        dictamenTexto = `El conteo físico de los billetes en tesorería coincidió exactamente con la declaración efectuada en el Portal B2B (${formatCurrencyLocal(montoAuditado)}).`;
    }

    doc.fontSize(7.5).font('Helvetica').fillColor('#1e293b').text(dictamenTexto, leftColumn + 10, yPos + 22, {
        width: leftBoxW - 20,
        lineGap: 2
    });

    // Box Derecho: Imputación y Estado Consolidado de Cuenta Corriente
    const saldoCapital = parseFloat((mov?.saldo_actual !== undefined && mov?.saldo_actual !== null)
        ? mov.saldo_actual
        : (mov?.saldo_resultante ?? sobre.cliente_saldo_cc ?? 0)) || 0;

    const tieneSalvavidasHabilitado = Boolean(salvavidasInfo && salvavidasInfo.reglas_aplicadas && salvavidasInfo.reglas_aplicadas.habilitado);
    const tieneInteresActivo = Boolean(tieneSalvavidasHabilitado && salvavidasInfo.financiacion_total_con_iva > 0);
    const saldoTotalConIva = tieneInteresActivo ? parseFloat(salvavidasInfo.saldo_total_proyectado_con_iva) : saldoCapital;

    doc.save();
    doc.roundedRect(rightBoxX, yPos, rightBoxW, summaryH, 4).fillColor(tieneInteresActivo ? '#fff1f2' : '#f8fafc').fill();
    doc.roundedRect(rightBoxX, yPos, rightBoxW, summaryH, 4).strokeColor(tieneInteresActivo ? '#e11d48' : '#cbd5e1').lineWidth(0.8).stroke();
    doc.restore();

    doc.fontSize(7.2).font('Helvetica-Bold').fillColor(themeColor).text('IMPUTACIÓN Y SALDO CONSOLIDADO EN CC', rightBoxX + 8, yPos + 7);
    if (tieneSalvavidasHabilitado) {
        const disp = salvavidasInfo.reglas_aplicadas?.cortesias_disponibles_anio ?? 3;
        const cupo = salvavidasInfo.reglas_aplicadas?.cupo_cortesias_anual ?? 3;
        doc.fontSize(6.2).font('Helvetica-Bold').fillColor('#6b21a8').text(
            `Comodines: ${disp}/${cupo}`,
            rightBoxX + 150,
            yPos + 7.5,
            { width: rightBoxW - 158, align: 'right' }
        );
    }

    doc.fontSize(7).font('Helvetica').fillColor('#475569').text('Monto Declarado en Sobre:', rightBoxX + 8, yPos + 20);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#334155').text(formatCurrencyLocal(montoDeclarado), rightBoxX + 120, yPos + 20, { width: rightBoxW - 128, align: 'right' });

    doc.fontSize(7).font('Helvetica').fillColor('#475569').text('Monto Acreditado Real:', rightBoxX + 8, yPos + 31);
    doc.fontSize(7.8).font('Helvetica-Bold').fillColor('#15803d').text(formatCurrencyLocal(montoAuditado), rightBoxX + 120, yPos + 30.5, { width: rightBoxW - 128, align: 'right' });

    doc.moveTo(rightBoxX + 8, yPos + 43).lineTo(rightBoxX + rightBoxW - 8, yPos + 43).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

    if (tieneInteresActivo) {
        const tasaPct = salvavidasInfo.reglas_aplicadas?.tasa_servicio_financiero || 3;
        const finNeta = salvavidasInfo.financiacion_total ?? salvavidasInfo.financiacion_neta_total ?? 0;
        const finIva = salvavidasInfo.financiacion_iva ?? salvavidasInfo.financiacion_iva_total ?? 0;

        doc.fontSize(6.8).font('Helvetica').fillColor('#334155').text('Capital de comprobantes:', rightBoxX + 8, yPos + 48);
        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#0f172a').text(formatCurrencyLocal(saldoCapital), rightBoxX + 120, yPos + 48, { width: rightBoxW - 128, align: 'right' });

        doc.fontSize(6.4).font('Helvetica').fillColor('#9a3412').text(`+ Salvavidas ${tasaPct}% (${formatCurrencyLocal(finNeta)}) + IVA (${formatCurrencyLocal(finIva)}):`, rightBoxX + 8, yPos + 59);
        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#b45309').text(`+ ${formatCurrencyLocal(salvavidasInfo.financiacion_total_con_iva)}`, rightBoxX + 150, yPos + 59, { width: rightBoxW - 158, align: 'right' });

        doc.save();
        doc.roundedRect(rightBoxX + 6, yPos + 71, rightBoxW - 12, 26, 3).fillColor('#ffffff').fill();
        doc.roundedRect(rightBoxX + 6, yPos + 71, rightBoxW - 12, 26, 3).strokeColor('#fecdd3').lineWidth(0.6).stroke();
        doc.restore();

        doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#881337').text('TOTAL REAL A PAGAR HOY (C/IVA):', rightBoxX + 10, yPos + 74);
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#b91c1c').text(formatCurrencyLocal(saldoTotalConIva), rightBoxX + 10, yPos + 84, { width: rightBoxW - 20, align: 'right' });
    } else {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569').text('SALDO DE CUENTA RESULTANTE:', rightBoxX + 8, yPos + 52);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text(formatCurrencyLocal(saldoCapital), rightBoxX + 8, yPos + 65, { width: rightBoxW - 16, align: 'right' });
        if (tieneSalvavidasHabilitado && saldoCapital > 0.005) {
            doc.fontSize(6.2).font('Helvetica-Bold').fillColor('#047857').text('0% Financiación Bonificada dentro de plazo.', rightBoxX + 8, yPos + 84);
        }
    }

    let nextTrazY = yPos + summaryH + 10;
    const impMovTraz = (tieneSalvavidasHabilitado && salvavidasInfo.imputaciones_por_movimiento && mov?.id)
        ? salvavidasInfo.imputaciones_por_movimiento[String(mov.id)]
        : null;
    const capasAbiertasTraz = (tieneSalvavidasHabilitado && Array.isArray(salvavidasInfo.comprobantes))
        ? salvavidasInfo.comprobantes
        : [];

    if (tieneSalvavidasHabilitado && ((impMovTraz && impMovTraz.tiene_financiacion_imputada) || capasAbiertasTraz.length > 0)) {
        const tieneImp = Boolean(impMovTraz && impMovTraz.tiene_financiacion_imputada);
        const cantCapas = capasAbiertasTraz.length;
        const boxH = 20 + (tieneImp ? 24 : 14) + (cantCapas > 0 ? 15 + (cantCapas * 12) : 12);

        doc.save();
        doc.roundedRect(leftColumn, nextTrazY, contentWidth, boxH, 4).fillColor('#f8fafc').fill();
        doc.roundedRect(leftColumn, nextTrazY, contentWidth, boxH, 4).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
        doc.roundedRect(leftColumn, nextTrazY, contentWidth, 15, 4).fillColor('#f1f5f9').fill();
        doc.restore();

        doc.fontSize(7.2).font('Helvetica-Bold').fillColor('#475569').text(
            '3. DETALLE DE IMPUTACIÓN DEL PAGO Y CONTINUIDAD DE COMPROBANTES PENDIENTES',
            leftColumn + 8,
            nextTrazY + 4
        );

        let yD = nextTrazY + 19;
        if (tieneImp) {
            const dets = (impMovTraz.detalles_comprobantes || []).filter(d => d.con_financiacion);
            const docsStr = dets.map(d => (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim()).join(' + ');
            const tagComp = impMovTraz.financiacion_facturada && impMovTraz.factura_financiacion_descripcion
                ? ` [${impMovTraz.factura_financiacion_descripcion.split('—')[0].trim()}]`
                : '';

            doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#0f766e')
               .text(`• Qué canceló este pago de ${formatCurrencyLocal(montoAuditado)}: `, leftColumn + 8, yD, { continued: true })
               .font('Helvetica').fillColor('#1e293b')
               .text(`Canceló ${formatCurrencyLocal(impMovTraz.capital_cancelado_total)} de capital s/ ${docsStr || 'comprobante'} + ${formatCurrencyLocal(impMovTraz.financiacion_con_iva_cancelada)} de financiación devengada (${formatCurrencyLocal(impMovTraz.financiacion_neta_cancelada)} neto + ${formatCurrencyLocal(impMovTraz.financiacion_iva_cancelada)} IVA 21%)${tagComp}. Esa porción queda 100% saldada.`, { width: contentWidth - 16 });
            yD += 21;
        } else {
            doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#0f766e').text(
                `• Qué canceló este pago de ${formatCurrencyLocal(montoAuditado)}: Aplicado 100% a capital sin cargos de financiación.`,
                leftColumn + 8,
                yD
            );
            yD += 12;
        }

        doc.moveTo(leftColumn + 8, yD - 1).lineTo(leftColumn + contentWidth - 8, yD - 1).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

        if (cantCapas > 0) {
            doc.fontSize(6.8).font('Helvetica-Bold').fillColor('#881337').text(
                `• Cómo continúa el saldo pendiente hoy (Capital: ${formatCurrencyLocal(saldoCapital)} + Financiación Activa c/IVA: ${formatCurrencyLocal(salvavidasInfo.financiacion_total_con_iva)} = Total: ${formatCurrencyLocal(saldoTotalConIva)}):`,
                leftColumn + 8,
                yD + 2
            );
            yD += 12.5;
            for (const cs of capasAbiertasTraz) {
                const nomDoc = (cs.descripcion || 'Comprobante').split('(')[0].trim();
                const capPend = cs.capital_pendiente ?? cs.monto_pendiente ?? 0;
                const capOrig = cs.monto_original ?? capPend;
                const finCiva = cs.interes_financiacion_con_iva ?? 0;
                const totCapa = parseFloat((capPend + finCiva).toFixed(2));
                const txtOrig = capPend < capOrig - 0.01 ? ` (de ${formatCurrencyLocal(capOrig)} orig.)` : ' (100% impago)';
                const txtFin = finCiva > 0
                    ? ` + Financiación ${cs.antiguedad_dias}d c/IVA: + ${formatCurrencyLocal(finCiva)} (${formatCurrencyLocal(cs.interes_financiacion)} + IVA ${formatCurrencyLocal(cs.iva_financiacion)}) = Subtotal hoy: ${formatCurrencyLocal(totCapa)}`
                    : ` · 0% Financiación (Día ${cs.antiguedad_dias}) = Subtotal hoy: ${formatCurrencyLocal(capPend)}`;

                doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#0f172a')
                   .text(`   - ${nomDoc}: `, leftColumn + 10, yD, { continued: true })
                   .fillColor('#8e4785').text(`Capital ${formatCurrencyLocal(capPend)}${txtOrig}`, { continued: true })
                   .font('Helvetica').fillColor('#334155').text(txtFin);
                yD += 11.5;
            }
        }
        nextTrazY += boxH + 10;
    }

    // Pie de página
    const footerY = nextTrazY + 4;
    doc.fontSize(7).font('Helvetica-Oblique').fillColor('#64748b').text(
        'Documento emitido por el Sistema de Trazabilidad Logística y Tesorería de LAMDA — Portal de Clientes B2B.',
        leftColumn,
        footerY,
        { align: 'center', width: contentWidth }
    );
}

/**
 * Genera el buffer PDF de las Recomendaciones de LAMDA para la Seguridad del Ensobrado
 */
async function obtenerRecomendacionesEnsobradoPdfBuffer() {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 36, bottom: 25, left: 40, right: 40 },
            info: {
                Title: 'Recomendaciones de LAMDA para la Seguridad del Ensobrado',
                Author: 'LAMDA'
            }
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        doc.on('error', err => reject(err));

        dibujarRecomendacionesEnsobradoPDF(doc);
        doc.end();
    });
}

/**
 * Dibuja las Recomendaciones de LAMDA para la Seguridad del Ensobrado en 1 página A4
 * con títulos destacados en negrita para cada punto y cero superposición
 */
function dibujarRecomendacionesEnsobradoPDF(doc) {
    const pageWidth = doc.page.width;
    const leftColumn = 40;
    const contentWidth = pageWidth - 80;
    const themeColor = '#8e4785';

    // 1. Cabecera Institucional (con cálculo dinámico de altura para evitar cualquier superposición)
    const logoPath = path.join(__dirname, '../../facturacion/img/logo_LAMDA_grande.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, leftColumn, 34, { width: 90 });
    }

    const titleX = leftColumn + 105;
    const titleW = contentWidth - 105;
    const mainTitle = 'RECOMENDACIONES DE LAMDA PARA LA SEGURIDAD DEL ENSOBRADO';
    const subTitle = 'Pautas clave para que la transacción en efectivo resulte exacta, ágil y segura — Portal de Clientes B2B';

    doc.fontSize(11.5).font('Helvetica-Bold').fillColor(themeColor);
    const mainTitleH = doc.heightOfString(mainTitle, { width: titleW, align: 'right' });
    doc.text(mainTitle, titleX, 36, { width: titleW, align: 'right' });

    const subY = 36 + mainTitleH + 5;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text(subTitle, titleX, subY, {
        width: titleW,
        align: 'right'
    });

    let yPos = Math.max(82, subY + 18);
    doc.moveTo(leftColumn, yPos).lineTo(pageWidth - leftColumn, yPos).strokeColor(themeColor).lineWidth(1.5).stroke();
    yPos += 10;

    // Introducción breve
    doc.save();
    doc.roundedRect(leftColumn, yPos, contentWidth, 38, 5).fillColor('#fdf6fd').fill();
    doc.roundedRect(leftColumn, yPos, contentWidth, 38, 5).strokeColor('#e9d5ff').lineWidth(0.8).stroke();
    doc.restore();

    doc.fontSize(8.2).font('Helvetica').fillColor('#1e293b').text(
        'Con el propósito de garantizar una acreditación inmediata, transparente y sin diferencias en su cuenta corriente, así como preservar la seguridad de cada operación en efectivo, destacamos los siguientes puntos clave al momento de preparar un sobre:',
        leftColumn + 12,
        yPos + 8,
        { width: contentWidth - 24, lineGap: 1.5 }
    );

    yPos += 48;

    const pilares = [
        {
            numero: '1',
            titulo: 'Dedicación y foco exclusivo al momento de armar el pago',
            color: '#8e4785',
            bg: '#f8fafc',
            items: [
                {
                    subtitulo: 'Determinismo contable',
                    texto: 'En el ecosistema administrativo de LAMDA los valores monetarios y su imputación en cuenta corriente son estrictamente deterministas y exactos.'
                },
                {
                    subtitulo: 'Dedicación exclusiva',
                    texto: 'Cuando asigne o realice la tarea de preparar un pago en efectivo, hágalo dedicándose de forma exclusiva a esa operación de principio a fin.'
                },
                {
                    subtitulo: 'Sin tareas en simultáneo',
                    texto: 'Evite superponer el conteo y armado del sobre con la atención de mostrador, recepción de mercadería u otras actividades que generen interrupciones o errores en las cantidades.'
                }
            ]
        },
        {
            numero: '2',
            titulo: 'Conteo físico en paralelo con el asistente interactivo de la aplicación',
            color: '#0284c7',
            bg: '#f0f9ff',
            items: [
                {
                    subtitulo: 'No contar por separado',
                    texto: 'Evite contar todo el dinero primero por un lado para recién después intentar recordar o volcar los datos en el sistema.'
                },
                {
                    subtitulo: 'Clasificación previa por billete',
                    texto: 'Separe primero los billetes por denominación sobre una superficie despejada antes de iniciar la carga.'
                },
                {
                    subtitulo: 'Carga en paralelo por denominación',
                    texto: 'Cuente los billetes de una denominación (ej. $ 20.000) y cargue esa cantidad en el acto en la aplicación; luego pase a la siguiente ($ 10.000), cuéntela y cárguela inmediatamente, y así sucesivamente ($ 2.000, $ 1.000, etc.).'
                },
                {
                    subtitulo: 'Guía y alerta en tiempo real',
                    texto: 'El asistente del sistema calcula cada subtotal automáticamente y le indica al instante cuánto resta o si se excede respecto al monto que desea abonar.'
                }
            ]
        },
        {
            numero: '3',
            titulo: 'Reserva visual, confidencialidad y caracterización como producto del comercio',
            color: '#0f766e',
            bg: '#f0fdfa',
            items: [
                {
                    subtitulo: 'Cero exposición visual de billetes',
                    texto: 'Para preservar la integridad y confidencialidad de la transacción en el local y durante su traslado, nunca deje billetes a la vista ni utilice envoltorios con partes transparentes.'
                },
                {
                    subtitulo: 'Caracterización como producto del negocio',
                    texto: 'Acondicione y cierre el paquete simulando ser un producto o mercadería habitual de los que vende su propio comercio (en bolsa de papel madera cerrada, caja o empaque propio sellado con el código de sobre).'
                },
                {
                    subtitulo: 'Prevención y discreción ante terceros',
                    texto: 'De este modo se resguarda la seguridad operativa y se evita levantar cualquier tipo de sospecha sobre la presencia de dinero en efectivo.'
                }
            ]
        },
        {
            numero: '4',
            titulo: 'Aviso interno inmediato al personal a cargo o en mostrador',
            color: '#b45309',
            bg: '#fffbeb',
            items: [
                {
                    subtitulo: 'Coordinación interna del local',
                    texto: 'Si bien el sistema LAMDA envía todos los avisos automáticos al iniciar la hoja de ruta y al retirar el sobre, es fundamental la comunicación interna dentro del comercio.'
                },
                {
                    subtitulo: 'Entrega ágil y segura al reparto',
                    texto: 'Ni bien termine de cerrar el sobre y confirmar el aviso en la aplicación, informe a la persona encargada o al personal de mostrador que el paquete ya está preparado para cuando pase el representante de LAMDA a retirarlo.'
                }
            ]
        }
    ];

    const textWidth = contentWidth - 52;

    for (const p of pilares) {
        // Calcular altura exacta de los ítems de este bloque
        let itemsTotalH = 0;
        for (const it of p.items) {
            const fullLine = `•  ${it.subtitulo}: ${it.texto}`;
            doc.fontSize(8).font('Helvetica-Bold');
            itemsTotalH += doc.heightOfString(fullLine, { width: textWidth, lineGap: 1.5 }) + 4;
        }
        const cardH = Math.max(70, itemsTotalH + 30);

        doc.save();
        doc.roundedRect(leftColumn, yPos, contentWidth, cardH, 6).fillColor(p.bg).fill();
        doc.roundedRect(leftColumn, yPos, contentWidth, cardH, 6).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
        doc.rect(leftColumn, yPos, 6, cardH).fillColor(p.color).fill();
        doc.restore();

        // Círculo numerado
        doc.save();
        doc.circle(leftColumn + 23, yPos + 16, 9.5).fillColor(p.color).fill();
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#ffffff').text(p.numero, leftColumn + 13.5, yPos + 12, { width: 19, align: 'center' });
        doc.restore();

        // Título del pilar
        doc.fontSize(9.2).font('Helvetica-Bold').fillColor('#0f172a').text(p.titulo.toUpperCase(), leftColumn + 40, yPos + 11, { width: textWidth });

        // Renderizar cada punto con su título en negrita destacada + explicación
        let itemY = yPos + 26;
        for (const it of p.items) {
            const fullLine = `•  ${it.subtitulo}: ${it.texto}`;
            doc.fontSize(8).font('Helvetica-Bold');
            const hItem = doc.heightOfString(fullLine, { width: textWidth, lineGap: 1.5 });

            doc.fontSize(8).font('Helvetica-Bold').fillColor(p.color).text(`•  ${it.subtitulo}: `, leftColumn + 40, itemY, {
                width: textWidth,
                lineGap: 1.5,
                continued: true
            }).font('Helvetica').fillColor('#1e293b').text(it.texto, {
                width: textWidth,
                lineGap: 1.5
            });

            itemY += hItem + 4;
        }

        yPos += cardH + 9;
    }

    // Pie institucional
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#64748b').text(
        'Muchas gracias por su colaboración y compromiso con la seguridad operativa — Administración y Logística LAMDA.',
        leftColumn,
        yPos + 2,
        { align: 'center', width: contentWidth }
    );
}

/**
 * Obtiene el contexto real de la cuenta corriente y genera el Buffer PDF de
 * "Políticas y Beneficio de Financiación LAMDA (con Caso Práctico de la Cuenta)"
 */
async function obtenerPoliticasFinanciacionPdfBuffer({ cuentaId = null, movimientoId = null } = {}) {
    let targetCuentaId = cuentaId ? parseInt(cuentaId, 10) : null;
    let movActual = null;

    if (movimientoId) {
        const resM = await pool.query(
            `SELECT m.*, cc.codigo_bunker_cliente
             FROM public.factura_cuenta_corriente_movimientos m
             JOIN public.factura_cuentas_corrientes cc ON m.cuenta_corriente_id = cc.id
             WHERE m.id = $1`,
            [parseInt(movimientoId, 10)]
        );
        if (resM.rows.length > 0) {
            movActual = resM.rows[0];
            if (!targetCuentaId) targetCuentaId = movActual.cuenta_corriente_id;
        }
    }

    if (!targetCuentaId) {
        throw new Error('Cuenta corriente no identificada para generar el PDF de Políticas de Financiación.');
    }

    const resCc = await pool.query(
        `SELECT cc.*, bc.razon_social, bc.cliente_nombre, bc.cuit_cuil AS cuit
         FROM public.factura_cuentas_corrientes cc
         LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente
         WHERE cc.id = $1`,
        [targetCuentaId]
    );
    if (resCc.rows.length === 0) {
        throw new Error('Cuenta corriente no encontrada.');
    }
    const cc = resCc.rows[0];

    const comp = await composicionSaldoService.calcularComposicionSaldo(targetCuentaId, pool);
    const salv = await salvavidasService.calcularSimulacionCuenta(targetCuentaId, { persistir_sombra: false }, pool);

    const ctx = {
        cc,
        movActual,
        comp,
        salv
    };

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 32, bottom: 22, left: 38, right: 38 },
            info: {
                Title: `Políticas y Beneficio de Financiación LAMDA - ${cc.codigo_bunker_cliente || cc.id}`,
                Author: 'LAMDA'
            }
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), codigoCliente: cc.codigo_bunker_cliente || String(cc.id) }));
        doc.on('error', err => reject(err));

        dibujarPoliticasFinanciacionPDF(doc, ctx);
        doc.end();
    });
}

/**
 * Dibuja en 1 página A4 las Políticas y Beneficio de Financiación LAMDA (4 etapas + eCheq + Caso Práctico Real de la cuenta)
 */
function dibujarPoliticasFinanciacionPDF(doc, ctx) {
    const { cc, movActual, comp, salv } = ctx;
    const pageWidth = doc.page.width;
    const leftColumn = 38;
    const contentWidth = pageWidth - 76;
    const themeColor = '#8e4785';
    const fmtArs = (v) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(parseFloat(v) || 0);

    // 1. Cabecera Oficial LAMDA
    const logoPath = path.join(__dirname, '../../facturacion/img/logo_LAMDA_grande.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, leftColumn, 30, { width: 88 });
    }

    const titleX = leftColumn + 100;
    const titleW = contentWidth - 100;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(themeColor).text(
        'POLÍTICAS Y BENEFICIO DE FINANCIACIÓN DE CUENTA CORRIENTE',
        titleX,
        32,
        { width: titleW, align: 'right' }
    );
    doc.fontSize(7.8).font('Helvetica-Bold').fillColor('#475569').text(
        'Plazos bonificados a costo $ 0,00 · Gracia natural · Comodines trimestrales · Operatoria con eCheq y Financiación Activa',
        titleX,
        47,
        { width: titleW, align: 'right' }
    );

    let yPos = 72;
    doc.moveTo(leftColumn, yPos).lineTo(pageWidth - leftColumn, yPos).strokeColor(themeColor).lineWidth(1.4).stroke();
    yPos += 7;

    // 2. Banda de Datos del Cliente
    const reglas = salv?.reglas_aplicadas || {};
    const dispComodines = reglas.cortesias_disponibles_anio ?? 3;
    const cupoComodines = reglas.cupo_cortesias_anual ?? 3;
    const nombreMostrar = cc.razon_social || cc.cliente_nombre || 'Cliente LAMDA';
    const subNombre = (cc.cliente_nombre && cc.razon_social && cc.cliente_nombre !== cc.razon_social) ? ` (${cc.cliente_nombre})` : '';

    doc.save();
    doc.roundedRect(leftColumn, yPos, contentWidth, 28, 4).fillColor('#f8fafc').fill();
    doc.roundedRect(leftColumn, yPos, contentWidth, 28, 4).strokeColor('#cbd5e1').lineWidth(0.7).stroke();
    doc.restore();

    doc.fontSize(7.8).font('Helvetica-Bold').fillColor('#0f172a').text(
        `CLIENTE: ${nombreMostrar}${subNombre}`,
        leftColumn + 10,
        yPos + 6,
        { width: contentWidth - 190 }
    );
    doc.fontSize(7.3).font('Helvetica').fillColor('#475569').text(
        `Código: ${cc.codigo_bunker_cliente || '-'}   |   CUIT: ${cc.cuit || '-'}   |   Comodines de Cortesía disponibles: ${dispComodines} de ${cupoComodines} en el año`,
        leftColumn + 10,
        yPos + 16
    );
    doc.fontSize(7.3).font('Helvetica-Bold').fillColor(themeColor).text(
        `Fecha: ${new Date().toLocaleDateString('es-AR')}`,
        pageWidth - leftColumn - 120,
        yPos + 6,
        { width: 110, align: 'right' }
    );

    yPos += 34;

    // 3. Introducción de Respaldo Comercial
    doc.save();
    doc.roundedRect(leftColumn, yPos, contentWidth, 32, 4).fillColor('#fdf6fd').fill();
    doc.roundedRect(leftColumn, yPos, contentWidth, 32, 4).strokeColor('#e9d5ff').lineWidth(0.7).stroke();
    doc.restore();

    doc.fontSize(7.8).font('Helvetica').fillColor('#1e293b').text(
        'En LAMDA acompañamos el giro comercial de su negocio financiando su cuenta corriente bajo un esquema transparente de 4 etapas: diseñado para otorgar 100% de financiación a costo $ 0,00 dentro de los plazos habituales y garantizar que su cuenta permanezca siempre activa cuando necesite extender sus tiempos de pago o realizar entregas parciales.',
        leftColumn + 10,
        yPos + 6,
        { width: contentWidth - 20, lineGap: 1.2 }
    );

    yPos += 38;

    // 4. Las 4 Etapas del Esquema de Financiación LAMDA
    const etapas = [
        {
            num: '1',
            color: '#047857',
            bg: '#f0fdf4',
            titulo: 'ETAPA 1 — PLAZO HABITUAL (DÍA 1 AL 7 DESDE LA ENTREGA): 100% FINANCIADO A COSTO $ 0,00',
            items: [
                {
                    sub: '0% Costo de Financiación',
                    txt: 'Dentro de los primeros 7 días corridos de entregada la mercadería, LAMDA financia el 100% del pedido sin ningún costo financiero ($ 0,00 de interés).'
                },
                {
                    sub: 'Medios comprendidos',
                    txt: 'Aplica abonando mediante transferencia bancaria, efectivo ensobrado o emitiendo un eCheq dentro de los 7 días.'
                }
            ]
        },
        {
            num: '2',
            color: '#0284c7',
            bg: '#f0f9ff',
            titulo: 'ETAPA 2 — DÍAS DE GRACIA NATURAL (+3 DÍAS: DÍA 8 AL 10): 100% BONIFICADO ($ 0,00)',
            items: [
                {
                    sub: 'Margen operativo sin cargo',
                    txt: 'Su cuenta dispone automáticamente de 3 días adicionales de gracia sin costo (hasta el día 10 corrido) para contemplar fines de semana, feriados o cierres administrativos y bancarios, sin consumir comodines.'
                }
            ]
        },
        {
            num: '3',
            color: '#7c3aed',
            bg: '#f5f3ff',
            titulo: 'ETAPA 3 — COMODÍN TRIMESTRAL DE CORTESÍA (DÍA 11 AL 14 — 1 CADA 3 MESES): COSTO $ 0,00',
            items: [
                {
                    sub: 'Extensión hasta 14 días a $ 0,00',
                    txt: `Para situaciones puntuales en las que necesite estirar unos días más el pago, dispone de ${cupoComodines} comodines al año (1 por trimestre) que extienden la ventana hasta los 14 días corridos con 100% de bonificación ($ 0,00 de financiación).`
                }
            ]
        },
        {
            num: '4',
            color: '#b45309',
            bg: '#fffbeb',
            titulo: 'ETAPA 4 — BENEFICIO DEL SERVICIO DE FINANCIACIÓN ACTIVA Y PAGOS PARCIALES (DÍA 15 EN ADELANTE)',
            items: [
                {
                    sub: 'Cuenta siempre habilitada',
                    txt: 'Superados los 14 días (o utilizados los comodines disponibles), su cuenta continúa 100% operativa activándose el Servicio de Financiación LAMDA (0,1% diario / 3% mensual + IVA, computado desde el Día 1 de entrega sobre el saldo pendiente).'
                },
                {
                    sub: 'Pagos parciales y Beneficios de Lista',
                    txt: 'Puede realizar pagos parciales en cualquier momento para achicar capital en el acto. Al dejar la cuenta al día en $ 0,00, se reactivan automáticamente el 5% de descuento por volumen (> $ 300.000) y las ofertas de su Lista de Precios.'
                }
            ]
        }
    ];

    const textWidth = contentWidth - 44;
    for (const et of etapas) {
        let itemsH = 0;
        for (const it of et.items) {
            const lineStr = `• ${it.sub}: ${it.txt}`;
            doc.fontSize(7.5).font('Helvetica-Bold');
            itemsH += doc.heightOfString(lineStr, { width: textWidth, lineGap: 1.1 }) + 3;
        }
        const cardH = Math.max(40, itemsH + 21);

        doc.save();
        doc.roundedRect(leftColumn, yPos, contentWidth, cardH, 5).fillColor(et.bg).fill();
        doc.roundedRect(leftColumn, yPos, contentWidth, cardH, 5).strokeColor('#cbd5e1').lineWidth(0.6).stroke();
        doc.rect(leftColumn, yPos, 5, cardH).fillColor(et.color).fill();
        doc.circle(leftColumn + 19, yPos + 13, 8).fillColor(et.color).fill();
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ffffff').text(et.num, leftColumn + 11, yPos + 9.5, { width: 16, align: 'center' });
        doc.restore();

        doc.fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text(et.titulo, leftColumn + 33, yPos + 7, { width: textWidth });

        let curY = yPos + 19;
        for (const it of et.items) {
            const lineStr = `• ${it.sub}: ${it.txt}`;
            doc.fontSize(7.5).font('Helvetica-Bold');
            const hIt = doc.heightOfString(lineStr, { width: textWidth, lineGap: 1.1 });

            doc.fontSize(7.5).font('Helvetica-Bold').fillColor(et.color).text(`• ${it.sub}: `, leftColumn + 33, curY, {
                width: textWidth,
                lineGap: 1.1,
                continued: true
            }).font('Helvetica').fillColor('#1e293b').text(it.txt, {
                width: textWidth,
                lineGap: 1.1
            });
            curY += hIt + 3;
        }
        yPos += cardH + 6;
    }

    // 5. Recuadro destacado: Alternativa de Pago con eCheq a Costo $ 0,00
    doc.save();
    doc.roundedRect(leftColumn, yPos, contentWidth, 38, 5).fillColor('#eff6ff').fill();
    doc.roundedRect(leftColumn, yPos, contentWidth, 38, 5).strokeColor('#93c5fd').lineWidth(0.8).stroke();
    doc.rect(leftColumn, yPos, 5, 38).fillColor('#1d4ed8').fill();
    doc.restore();

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e3a8a').text(
        'HERRAMIENTA RECOMENDADA: EMISIÓN DE eCHEQ A COSTO $ 0,00 DE FINANCIACIÓN',
        leftColumn + 12,
        yPos + 6
    );
    doc.fontSize(7.4).font('Helvetica').fillColor('#1e293b').text(
        'Si en algún pedido necesita programar su liquidez sin que corra el servicio de financiación, puede emitir un eCheq dentro de los primeros 7 días (+3 días de gracia natural) o utilizando su comodín trimestral dentro de los 14 días corridos. De esta forma fija su fecha de pago manteniendo la operación 100% bonificada ($ 0,00 de costo de financiación).',
        leftColumn + 12,
        yPos + 17,
        { width: contentWidth - 22, lineGap: 1.1 }
    );

    yPos += 44;

    // 6. Caso Práctico Real de la Cuenta Corriente del Cliente y Bonificación 100% en este Pago
    const pagosBonif = Array.isArray(comp?.pagos_con_financiacion_bonificada) ? comp.pagos_con_financiacion_bonificada : [];
    const capasAbiertas = Array.isArray(salv?.comprobantes) ? salv.comprobantes : [];
    const impMovActual = (movActual && comp?.imputaciones_por_movimiento)
        ? comp.imputaciones_por_movimiento[String(movActual.id)]
        : null;

    // Determinar la operación actual ejemplificativa (el pago recién asentado o la factura abierta actual)
    let opActualTitulo = '';
    let opActualMonto = 0;
    let opActualFinConIva = 0;
    let opActualFinNeta = 0;
    let opActualFinIva = 0;
    let opActualDias = 0;

    if (impMovActual && impMovActual.tiene_financiacion_bonificada) {
        const det0 = (impMovActual.detalles_comprobantes || []).find(d => d.con_financiacion_bonificada) || (impMovActual.detalles_comprobantes || [])[0];
        opActualTitulo = det0 ? (det0.comprobante_descripcion || 'Comprobante').split('(')[0].trim() : (movActual.descripcion || 'Pago actual');
        opActualMonto = impMovActual.capital_cancelado_total || movActual.monto;
        opActualFinConIva = impMovActual.financiacion_bonificada_con_iva || 0;
        opActualFinNeta = impMovActual.financiacion_bonificada_neta || 0;
        opActualFinIva = impMovActual.financiacion_bonificada_iva || 0;
        opActualDias = det0?.dias_al_pago || 17;
    } else if (capasAbiertas.length > 0) {
        const c0 = capasAbiertas[0];
        opActualTitulo = (c0.descripcion || 'Comprobante').split('(')[0].trim();
        opActualMonto = c0.capital_pendiente ?? c0.monto_pendiente ?? 0;
        opActualFinConIva = c0.interes_financiacion_con_iva ?? salv?.financiacion_total_con_iva ?? 0;
        opActualFinNeta = c0.interes_financiacion ?? salv?.financiacion_total ?? 0;
        opActualFinIva = c0.iva_financiacion ?? salv?.financiacion_iva ?? 0;
        opActualDias = c0.antiguedad_dias || 17;
    } else if (pagosBonif.length > 0) {
        const ultBonif = pagosBonif[pagosBonif.length - 1];
        const detU = (ultBonif.detalles_comprobantes || []).find(d => d.con_financiacion_bonificada) || (ultBonif.detalles_comprobantes || [])[0];
        opActualTitulo = detU ? (detU.comprobante_descripcion || 'Comprobante').split('(')[0].trim() : 'Última factura cancelada';
        opActualMonto = ultBonif.capital_cancelado_total || ultBonif.monto_pago_total;
        opActualFinConIva = ultBonif.financiacion_bonificada_con_iva || 0;
        opActualFinNeta = ultBonif.financiacion_bonificada_neta || 0;
        opActualFinIva = ultBonif.financiacion_bonificada_iva || 0;
        opActualDias = detU?.dias_al_pago || 17;
    }

    // Calcular financiación histórica bonificada (sumando pagos previos > 14 días + capa abierta si aún no se vinculó)
    const finHistPrevios = parseFloat(comp?.financiacion_historica_bonificada_total || 0);
    const finActivaPendiente = (capasAbiertas.length > 0 && !(impMovActual && impMovActual.tiene_financiacion_bonificada))
        ? parseFloat(salv?.financiacion_total_con_iva || 0)
        : 0;
    const totalFinBonificada = Math.round((finHistPrevios + finActivaPendiente) * 100) / 100;
    const cantOpsBonif = pagosBonif.length + (finActivaPendiente > 0 ? 1 : 0);

    const caseBoxH = 112;
    doc.save();
    doc.roundedRect(leftColumn, yPos, contentWidth, caseBoxH, 5).fillColor('#f8fafc').fill();
    doc.roundedRect(leftColumn, yPos, contentWidth, caseBoxH, 5).strokeColor('#94a3b8').lineWidth(0.8).stroke();
    doc.roundedRect(leftColumn, yPos, contentWidth, 17, 5).fillColor('#1e293b').fill();
    doc.restore();

    doc.fontSize(7.8).font('Helvetica-Bold').fillColor('#ffffff').text(
        'CASO PRÁCTICO REAL DE SU CUENTA CORRIENTE Y BONIFICACIÓN 100% EN ESTA OPERACIÓN',
        leftColumn + 10,
        yPos + 5
    );

    let yCase = yPos + 22;
    if (opActualMonto > 0) {
        doc.fontSize(7.4).font('Helvetica-Bold').fillColor('#0f172a').text(
            `• Ejemplo en su pago actual (${opActualTitulo} — ${opActualDias} días corridos desde la entrega):`,
            leftColumn + 10,
            yCase
        );
        yCase += 10.5;
        doc.fontSize(7.2).font('Helvetica').fillColor('#334155').text(
            `Sobre el capital de ${fmtArs(opActualMonto)}, al haberse abonado a los ${opActualDias} días (superando los 7 días habituales + 3 días de gracia y el tope de 14 días de comodín), se generó un cargo de Servicio de Financiación de ${fmtArs(opActualFinConIva)} (${fmtArs(opActualFinNeta)} neto + ${fmtArs(opActualFinIva)} IVA 21%).`,
            leftColumn + 16,
            yCase,
            { width: contentWidth - 26 }
        );
        yCase += 20;
    }

    if (cantOpsBonif > 1 && totalFinBonificada > opActualFinConIva + 1) {
        const finAnteriores = Math.max(0, totalFinBonificada - opActualFinConIva);
        doc.fontSize(7.4).font('Helvetica-Bold').fillColor('#0f172a').text(
            `• Historial acumulado de plazos extendidos (> 14 días) absorbidos por LAMDA: ${fmtArs(totalFinBonificada)}`,
            leftColumn + 10,
            yCase
        );
        yCase += 10.5;
        doc.fontSize(7.2).font('Helvetica').fillColor('#334155').text(
            `Contando las operaciones anteriores abonadas superando los 14 días (${fmtArs(finAnteriores)}) más la operación actual (${fmtArs(opActualFinConIva)}), el financiamiento total brindado por LAMDA en su cuenta asciende a ${fmtArs(totalFinBonificada)}.`,
            leftColumn + 16,
            yCase,
            { width: contentWidth - 26 }
        );
        yCase += 20;
    }

    // Recuadro Verde de Bonificación 100% Hoy y Vigencia para Próximas Órdenes
    const greenY = yPos + caseBoxH - 36;
    doc.save();
    doc.roundedRect(leftColumn + 8, greenY, contentWidth - 16, 31, 4).fillColor('#dcfce7').fill();
    doc.roundedRect(leftColumn + 8, greenY, contentWidth - 16, 31, 4).strokeColor('#16a34a').lineWidth(0.9).stroke();
    doc.restore();

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#166534').text(
        `BONIFICACIÓN 100% APLICADA HOY (${fmtArs(totalFinBonificada > 0 ? totalFinBonificada : opActualFinConIva)} BONIFICADOS → CUENTA EN $ 0,00) Y VIGENCIA FUTURA:`,
        leftColumn + 15,
        greenY + 4.5
    );
    doc.fontSize(7.1).font('Helvetica').fillColor('#14532d').text(
        'En esta oportunidad LAMDA bonifica el 100% de la financiación detallada, imputando su pago íntegramente al capital y dejando su Cuenta Corriente en $ 0,00. Compartimos este detalle para que a partir de las próximas órdenes pueda aprovechar los plazos de 7 días (+3 de gracia), comodines y eCheq a costo $ 0,00.',
        leftColumn + 15,
        greenY + 14.5,
        { width: contentWidth - 30 }
    );

    yPos += caseBoxH + 8;

    // Pie institucional
    doc.fontSize(7.2).font('Helvetica-Oblique').fillColor('#64748b').text(
        'Administración y Finanzas LAMDA — Portal de Clientes B2B (https://portal-lamda-b2b.idadesarrollo.workers.dev/) · Tel/WA: 221-6615746',
        leftColumn,
        yPos,
        { align: 'center', width: contentWidth }
    );
}

/**
 * Endpoint directo para previsualizar o descargar el PDF de Políticas y Beneficio de Financiación de una Cuenta Corriente
 * GET /api/logistica/bunker/cuentas-corrientes/:id/politicas-financiacion-pdf
 */
exports.generarPoliticasFinanciacionCuentaPdf = async (req, res) => {
    try {
        const cuentaId = parseInt(req.params.id, 10);
        const movimientoId = req.query.movimiento_id ? parseInt(req.query.movimiento_id, 10) : null;
        const isInline = req.query && (req.query.inline === '1' || req.query.inline === 'true');
        const dispType = isInline ? 'inline' : 'attachment';

        const { buffer, codigoCliente } = await obtenerPoliticasFinanciacionPdfBuffer({ cuentaId, movimientoId });
        const safeCod = String(codigoCliente || cuentaId).replace(/[^a-zA-Z0-9_-]/g, '');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${dispType}; filename="Politicas_y_Beneficio_Financiacion_LAMDA_${safeCod}.pdf"`);
        return res.send(buffer);
    } catch (error) {
        console.error('❌ [CC-CONTROLLER] Error al generar PDF de Políticas de Financiación:', error);
        res.status(500).send('Error interno al generar el PDF de Políticas de Financiación.');
    }
};

/**
 * Generar comprobante PDF individual de un movimiento (Factura/Nota de Credito/Recibo)
 * o documentos anexos de arqueo (?tipo_doc=recibo|trazabilidad|recomendaciones)
 * GET /api/logistica/bunker/cuentas-corrientes/movimientos/:movimientoId/pdf
 */
exports.generarComprobantePdf = async (req, res) => {
    try {
        const { movimientoId } = req.params;
        const tipoDoc = (req.query && req.query.tipo_doc) ? String(req.query.tipo_doc).toLowerCase() : 'recibo';
        const isInline = req.query && (req.query.inline === '1' || req.query.inline === 'true');
        const dispType = isInline ? 'inline' : 'attachment';

        let syncArqueo = null;
        if (req.query && req.query.sync_arqueo) {
            try {
                syncArqueo = JSON.parse(req.query.sync_arqueo);
            } catch (e) {}
        }

        if (tipoDoc === 'recomendaciones') {
            console.log(`📄 [CC-CONTROLLER] Generando PDF de Recomendaciones de Ensobrado LAMDA`);
            const { buffer } = await obtenerRecomendacionesEnsobradoPdfBuffer();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `${dispType}; filename="Recomendaciones_Ensobrado_LAMDA.pdf"`);
            return res.send(buffer);
        }

        if (tipoDoc === 'politicas_financiacion' || tipoDoc === 'politicas') {
            console.log(`📄 [CC-CONTROLLER] Generando PDF de Políticas y Beneficio de Financiación LAMDA para movimiento ID: ${movimientoId}`);
            const { buffer, codigoCliente } = await obtenerPoliticasFinanciacionPdfBuffer({
                movimientoId,
                cuentaId: req.query ? req.query.cuenta_id : null
            });
            const safeCod = String(codigoCliente || movimientoId).replace(/[^a-zA-Z0-9_-]/g, '');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `${dispType}; filename="Politicas_y_Beneficio_Financiacion_LAMDA_${safeCod}.pdf"`);
            return res.send(buffer);
        }

        if (tipoDoc === 'trazabilidad') {
            console.log(`📄 [CC-CONTROLLER] Generando PDF de Trazabilidad y Arqueo para movimiento ID: ${movimientoId}`);
            const { buffer, codigoSobre } = await obtenerInformeTrazabilidadSobrePdfBuffer(
                movimientoId,
                req.query ? req.query.codigo_sobre : null,
                syncArqueo
            );
            const safeCod = String(codigoSobre || movimientoId).replace(/[^a-zA-Z0-9_-]/g, '');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `${dispType}; filename="Informe_Arqueo_y_Trazabilidad_${safeCod}.pdf"`);
            return res.send(buffer);
        }

        console.log(`\ud83d\udcc4 [CC-CONTROLLER] Peticion de generacion de PDF para movimiento ID: ${movimientoId}`);

        const { buffer, mov } = await obtenerComprobantePdfBuffer(movimientoId, syncArqueo);

        if (req.query && req.query.json === '1') {
            return res.json({ success: true, mov_id: mov.id, metadatos: mov.metadatos });
        }

        const isFactura = ['FACTURA', 'FACTURA_A', 'NOTA_CREDITO', 'NOTA_DEBITO'].includes(mov.tipo_comprobante);
        const esPago = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
        const fechaArchivo = new Date(mov.fecha_movimiento).toISOString().split('T')[0].replace(/-/g, '');
        let filename = `recibo-${mov.id}-${fechaArchivo}.pdf`;
        if (isFactura) {
            filename = `comprobante_${mov.numero_comprobante || mov.id}.pdf`;
        } else if (esPago) {
            filename = `comprobante-pago-${mov.id}-${fechaArchivo}.pdf`;
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${dispType}; filename="${filename}"`);
        return res.send(buffer);
    } catch (error) {
        console.error(`\u274c [CC-CONTROLLER] Error al generar PDF para movimiento ID ${req.params.movimientoId}:`, error);
        res.status(500).send('Error interno al generar el PDF del comprobante.');
    }
};

/**
 * Enviar comprobante individual (y anexos opcionales de arqueo/recomendaciones) por WhatsApp
 * POST /api/logistica/bunker/cuentas-corrientes/movimientos/:movimientoId/whatsapp
 */
exports.enviarComprobanteWhatsapp = async (req, res) => {
    let timeoutId;
    const controller = new AbortController();
    
    try {
        const { movimientoId } = req.params;
        const { destinatarios } = req.body;
        let mensajeTexto = req.body.mensajeTexto || '';
        
        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({ success: false, error: 'Destinatarios no especificados.' });
        }

        console.log(`\ud83d\udcf1 [CC-CONTROLLER] Peticion de WhatsApp para comprobante movimiento ID: ${movimientoId} a: ${destinatarios}`);

        const syncArqueo = req.body.sync_arqueo || (req.body.desglose_auditado ? {
            desglose_auditado: req.body.desglose_auditado,
            diferencias_arqueo: req.body.diferencias_arqueo
        } : null);

        // Determinar lista de documentos PDF a adjuntar (por defecto ['recibo'])
        const docsSolicitados = Array.isArray(req.body.documentos_adjuntos) && req.body.documentos_adjuntos.length > 0
            ? req.body.documentos_adjuntos.map(d => String(d).toLowerCase())
            : ['recibo'];
        if (req.body.adjuntarPoliticasPdf && !docsSolicitados.includes('politicas_financiacion')) {
            docsSolicitados.push('politicas_financiacion');
        }

        // 1. Obtener siempre datos base del movimiento
        const { buffer: reciboBuffer, mov } = await obtenerComprobantePdfBuffer(movimientoId, syncArqueo);
        const meta = (mov && mov.metadatos)
            ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
            : {};
        const codigoSobre = req.body.codigo_sobre || meta.codigo_sobre || null;

        const isFactura = ['FACTURA', 'FACTURA_A', 'NOTA_CREDITO', 'NOTA_DEBITO'].includes(mov.tipo_comprobante);
        const isCustomMessage = typeof req.body.mensajeTexto === 'string' && req.body.mensajeTexto.trim().length > 0;

        if (!isCustomMessage) {
            const esPagoEmitido = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
            if (esPagoEmitido) {
                const nroPago = mov.numero_comprobante || `PAGO-TRANSF-${String(mov.id).padStart(8, '0')}`;
                mensajeTexto = `Te adjunto en PDF el comprobante de transferencia (${nroPago}).\nCualquier duda avisame!`;
            } else if (!isFactura) {
                const nroRecibo = mov.numero_comprobante || `REC-PAGO-${String(mov.id).padStart(8, '0')}`;
                mensajeTexto = `Te adjunto en PDF el recibo de pago (${nroRecibo}). Muchas gracias!`;
            } else {
                const nroFac = mov.numero_comprobante || `#${mov.id}`;
                mensajeTexto = `Te adjunto en PDF el comprobante (${nroFac}) de tu cuenta corriente.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
            }
        }

        const fechaArchivo = new Date(mov.fecha_movimiento).toISOString().split('T')[0].replace(/-/g, '');
        const esPago = ['PAGO_A_CLIENTE', 'DEBITO_BANCARIO'].includes(mov.tipo_comprobante);
        const reciboFilename = isFactura
            ? `comprobante_${mov.numero_comprobante || mov.id}.pdf`
            : (codigoSobre
                ? `Recibo_Pago_${codigoSobre}.pdf`
                : (esPago ? `comprobante-pago-${mov.id}-${fechaArchivo}.pdf` : `recibo-${mov.id}-${fechaArchivo}.pdf`));

        // Construir cola de envíos PDF según los documentos tildados
        const colaDocumentos = [];
        for (const tipo of docsSolicitados) {
            if (tipo === 'recibo') {
                colaDocumentos.push({
                    tipo: 'recibo',
                    buffer: reciboBuffer,
                    filename: reciboFilename,
                    caption: `📄 *Recibo Oficial de Pago${codigoSobre ? ` — Sobre #${codigoSobre}` : ''}*`
                });
            } else if (tipo === 'trazabilidad') {
                const { buffer: trazBuffer, codigoSobre: codRes } = await obtenerInformeTrazabilidadSobrePdfBuffer(movimientoId, codigoSobre, null);
                const safeCod = String(codRes || codigoSobre || mov.id).replace(/[^a-zA-Z0-9_-]/g, '');
                colaDocumentos.push({
                    tipo: 'trazabilidad',
                    buffer: trazBuffer,
                    filename: `Informe_Arqueo_y_Trazabilidad_${safeCod}.pdf`,
                    caption: `📋 *Informe de Trazabilidad y Arqueo Físico — Sobre #${safeCod}*`
                });
            } else if (tipo === 'recomendaciones') {
                const { buffer: recBuffer } = await obtenerRecomendacionesEnsobradoPdfBuffer();
                colaDocumentos.push({
                    tipo: 'recomendaciones',
                    buffer: recBuffer,
                    filename: `Recomendaciones_Ensobrado_LAMDA.pdf`,
                    caption: `🛡️ *Guía de Recomendaciones para el Ensobrado de Efectivo — LAMDA*`
                });
            } else if (tipo === 'politicas_financiacion' || tipo === 'politicas') {
                const { buffer: polBuffer, codigoCliente: codCli } = await obtenerPoliticasFinanciacionPdfBuffer({
                    movimientoId,
                    cuentaId: mov.cuenta_corriente_id
                });
                const safeCodCli = String(codCli || mov.codigo_bunker_cliente || mov.id).replace(/[^a-zA-Z0-9_-]/g, '');
                colaDocumentos.push({
                    tipo: 'politicas_financiacion',
                    buffer: polBuffer,
                    filename: `Politicas_y_Beneficio_Financiacion_LAMDA_${safeCodCli}.pdf`,
                    caption: `📘 *Políticas y Beneficio de Financiación de Cuenta Corriente — LAMDA (${safeCodCli})*`
                });
            }
        }

        if (colaDocumentos.length === 0) {
            colaDocumentos.push({
                tipo: 'recibo',
                buffer: reciboBuffer,
                filename: reciboFilename,
                caption: mensajeTexto
            });
        }

        console.log(`🛡️ [VIGÍA DEPURADOR - CC BACKEND WHATSAPP] Movimiento ID: ${mov.id} | Cliente: ${mov.codigo_bunker_cliente} | Docs: ${colaDocumentos.map(d => d.tipo).join(', ')} | Destinatarios: ${destinatarios}`);

        timeoutId = setTimeout(() => {
            console.error('⚠️ [CC-CONTROLLER] Tiempo de espera agotado al llamar al microservicio de WhatsApp.');
            controller.abort();
        }, 65000);

        let lastData = null;
        for (let i = 0; i < colaDocumentos.length; i++) {
            const docItem = colaDocumentos[i];
            const textoEnvio = (i === 0) ? mensajeTexto : docItem.caption;

            const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    destinatarios: destinatarios,
                    pdfBase64: docItem.buffer.toString('base64'),
                    filename: docItem.filename,
                    mensajeTexto: textoEnvio
                }),
                signal: controller.signal
            });

            const data = await response.json();
            lastData = data;
            console.log(`🛡️ [VIGÍA DEPURADOR - CC BACKEND WHATSAPP] Doc (${i + 1}/${colaDocumentos.length}) ${docItem.filename} -> Status: ${response.status}`);

            if (!response.ok || !data.success) {
                clearTimeout(timeoutId);
                return res.status(response.status || 502).json({
                    success: false,
                    error: data.error || 'Falla del microservicio',
                    message: data.message || `No se pudo enviar el documento ${docItem.filename} por WhatsApp.`
                });
            }
        }

        clearTimeout(timeoutId);

        res.json({
            success: true,
            message: `${colaDocumentos.length} documento(s) PDF enviado(s) por WhatsApp con éxito.`,
            data: lastData ? lastData.data : null
        });

    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[CC-CONTROLLER] Error al enviar comprobante por WhatsApp:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error interno',
            message: 'No se pudo procesar el envio del comprobante por WhatsApp.'
        });
    }
};

/**
 * Enviar comprobante individual (y anexos opcionales) por Correo Electronico usando el microservicio
 * POST /api/logistica/bunker/cuentas-corrientes/movimientos/:movimientoId/email
 */
exports.enviarComprobanteEmail = async (req, res) => {
    let timeoutId;
    const controller = new AbortController();
    
    try {
        const { movimientoId } = req.params;
        const { destinatarios, mensajeTexto } = req.body;
        
        if (!destinatarios || !destinatarios.trim()) {
            return res.status(400).json({ success: false, error: 'Destinatarios no especificados.' });
        }

        console.log(`\ud83d\udce7 [CC-CONTROLLER] Peticion de Email para comprobante movimiento ID: ${movimientoId} a: ${destinatarios}`);

        // 1. Obtener buffer y metadatos del comprobante
        const syncArqueo = req.body.sync_arqueo || (req.body.desglose_auditado ? {
            desglose_auditado: req.body.desglose_auditado,
            diferencias_arqueo: req.body.diferencias_arqueo
        } : null);
        const { buffer: reciboBuffer, mov } = await obtenerComprobantePdfBuffer(movimientoId, syncArqueo);
        const meta = (mov && mov.metadatos)
            ? (typeof mov.metadatos === 'string' ? JSON.parse(mov.metadatos) : mov.metadatos)
            : {};
        const codigoSobre = req.body.codigo_sobre || meta.codigo_sobre || null;

        const docsSolicitados = Array.isArray(req.body.documentos_adjuntos) && req.body.documentos_adjuntos.length > 0
            ? req.body.documentos_adjuntos.map(d => String(d).toLowerCase())
            : ['recibo'];
        if (req.body.adjuntarPoliticasPdf && !docsSolicitados.includes('politicas_financiacion')) {
            docsSolicitados.push('politicas_financiacion');
        }

        const itemsParaUnificar = [];
        for (const tipo of docsSolicitados) {
            if (tipo === 'recibo') {
                itemsParaUnificar.push({ buffer: reciboBuffer, mov });
            } else if (tipo === 'trazabilidad') {
                const { buffer: trazBuffer } = await obtenerInformeTrazabilidadSobrePdfBuffer(movimientoId, codigoSobre, null);
                itemsParaUnificar.push({ buffer: trazBuffer, mov });
            } else if (tipo === 'recomendaciones') {
                const { buffer: recBuffer } = await obtenerRecomendacionesEnsobradoPdfBuffer();
                itemsParaUnificar.push({ buffer: recBuffer, mov });
            } else if (tipo === 'politicas_financiacion' || tipo === 'politicas') {
                const { buffer: polBuffer } = await obtenerPoliticasFinanciacionPdfBuffer({
                    movimientoId,
                    cuentaId: mov.cuenta_corriente_id
                });
                itemsParaUnificar.push({ buffer: polBuffer, mov });
            }
        }
        if (itemsParaUnificar.length === 0) {
            itemsParaUnificar.push({ buffer: reciboBuffer, mov });
        }

        const finalPdfBuffer = await generarMultiplesComprobantesPDF(itemsParaUnificar);

        // 2. Convertir a Base64
        const pdfBase64 = finalPdfBuffer.toString('base64');

        // 3. Configurar metadatos del envio
        let nroComprobante = mov.numero_comprobante || `REC-PAGO-${String(mov.id).padStart(8, '0')}`;
        if (codigoSobre) {
            nroComprobante = `${nroComprobante} (Sobre #${codigoSobre})`;
        }
        
        // 4. Obtener cliente
        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(mov.codigo_bunker_cliente);
        if (!clienteObj) {
            return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
        }

        // 5. Invocar microservicio de Correo en el puerto 3004 con timeout
        timeoutId = setTimeout(() => {
            console.error('\u26a0\ufe0f [CC-CONTROLLER] Tiempo de espera agotado al llamar al microservicio de correo.');
            controller.abort();
        }, 20000);

        let finalMensaje = mensajeTexto || '';
        const isCustomMessage = typeof mensajeTexto === 'string' && mensajeTexto.trim().length > 0;

        if (!isCustomMessage) {
            const saldoNum = parseFloat(mov.saldo_resultante) || 0;
            if (saldoNum < -0.01) {
                const absSaldo = Math.abs(saldoNum);
                const formattedSaldo = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(absSaldo).replace(/\s+/g, ' ');
                finalMensaje = `Ha quedado un saldo a favor de ${formattedSaldo}`;
            }
        }

        const response = await fetch('http://localhost:3004/facturacion/email/comprobantes/enviar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente: {
                    cliente_nombre: clienteObj.cliente_nombre,
                    razon_social: clienteObj.razon_social,
                    codigo_bunker_cliente: clienteObj.codigo_bunker_cliente
                },
                destinatarios: destinatarios,
                pdfBase64: pdfBase64,
                nroComprobante,
                mensajeTexto: finalMensaje
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();
        
        if (!response.ok || !data.success) {
            return res.status(response.status || 502).json({
                success: false,
                error: data.error || 'Falla del microservicio',
                message: data.message || 'No se pudo enviar el comprobante por Correo Electronico.'
            });
        }

        res.json({
            success: true,
            message: 'El comprobante y sus anexos han sido enviados por Correo Electronico con exito.',
            data: data.data
        });

    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[CC-CONTROLLER] Error al enviar comprobante por Correo Electronico:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error interno',
            message: 'No se pudo procesar el envio del comprobante por Correo Electronico.'
        });
    }
};

/**
 * Genera un único documento PDF (multipágina) agrupando varios comprobantes (Facturas, Notas de Crédito, Recibos)
 */
async function generarMultiplesComprobantesPDF(items) {
    if (!items || items.length === 0) {
        throw new Error('No hay comprobantes para unificar.');
    }
    if (items.length === 1) {
        return items[0].buffer;
    }

    const mergedPdf = await PDFLibDoc.create();
    for (const item of items) {
        if (item && item.buffer && item.buffer.length > 0) {
            try {
                const srcDoc = await PDFLibDoc.load(item.buffer);
                const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                pages.forEach(p => mergedPdf.addPage(p));
            } catch (err) {
                console.error(`⚠️ [CC-CONTROLLER] Error al agregar páginas del comprobante ID ${item.mov?.id} al PDF unificado:`, err);
            }
        }
    }
    const mergedPdfBytes = await mergedPdf.save();
    return Buffer.from(mergedPdfBytes);
}

/**
 * Enviar múltiples comprobantes agrupados en UN SOLO PDF por WhatsApp
 * POST /api/logistica/bunker/cuentas-corrientes/movimientos/whatsapp-multi
 */
exports.enviarComprobantesWhatsappMulti = async (req, res) => {
    let timeoutId;
    const controller = new AbortController();
    try {
        const { movimientoIds, destinatarios, mensajeTexto } = req.body;

        const strDestinatarios = Array.isArray(destinatarios) ? destinatarios.join(', ') : String(destinatarios || '');

        if (!Array.isArray(movimientoIds) || movimientoIds.length === 0) {
            return res.status(400).json({ success: false, error: 'Debe especificar al menos un movimiento.' });
        }
        if (!strDestinatarios || !strDestinatarios.trim()) {
            return res.status(400).json({ success: false, error: 'Destinatarios no especificados.' });
        }

        console.log(`📱 [CC-CONTROLLER] Unificando ${movimientoIds.length} comprobantes en UN SOLO PDF para enviar por WhatsApp a: ${strDestinatarios}`);

        // 1. Obtener items con buffer PDF y datos de movimiento
        const items = [];
        for (const movId of movimientoIds) {
            try {
                const item = await obtenerComprobantePdfBuffer(movId);
                if (item && item.mov) items.push(item);
            } catch (e) {
                console.error(`⚠️ Error al obtener comprobante PDF para movimiento ID ${movId}:`, e.message);
            }
        }

        if (items.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontraron los movimientos solicitados.' });
        }

        const movimientos = items.map(it => it.mov);

        // 2. Generar UN SOLO PDF unificado con todos los comprobantes reales
        const pdfBuffer = await generarMultiplesComprobantesPDF(items);

        const tieneFacturas = movimientos.some(m => ['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'NOTA_CREDITO', 'NOTA_DEBITO', 'PENDIENTE_FACTURACION', 'PRESUPUESTO'].includes(m.tipo_comprobante));
        const tieneRecibos = movimientos.some(m => !['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'NOTA_CREDITO', 'NOTA_DEBITO', 'PENDIENTE_FACTURACION', 'PRESUPUESTO'].includes(m.tipo_comprobante));

        let filename;
        const codCliente = (movimientos[0].codigo_bunker_cliente || 'cliente').toLowerCase();
        if (movimientos.length === 1) {
            const mov = movimientos[0];
            if (['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'NOTA_CREDITO', 'NOTA_DEBITO'].includes(mov.tipo_comprobante)) {
                filename = `comprobante_${mov.numero_comprobante || mov.id}.pdf`;
            } else {
                const fechaArchivo = new Date(mov.fecha_movimiento).toISOString().split('T')[0].replace(/-/g, '');
                filename = `recibo-${mov.id}-${fechaArchivo}.pdf`;
            }
        } else {
            if (tieneFacturas && !tieneRecibos) {
                filename = `facturacion-${codCliente}-${movimientos.length}-docs.pdf`;
            } else if (!tieneFacturas && tieneRecibos) {
                filename = `recibos-pago-${codCliente}-${movimientos.length}-pagos.pdf`;
            } else {
                filename = `comprobantes-${codCliente}-${movimientos.length}-docs.pdf`;
            }
        }

        let fallbackMsg = 'Hola! Te adjuntamos los comprobantes de tu cuenta corriente. Saludos!';
        if (tieneFacturas && !tieneRecibos) {
            fallbackMsg = 'Hola! Te adjuntamos la documentación de facturación de tu cuenta corriente. Saludos!';
        } else if (!tieneFacturas && tieneRecibos) {
            fallbackMsg = 'Hola! Te adjuntamos los comprobantes de pago de tu cuenta corriente. Saludos!';
        }

        const pdfBase64 = pdfBuffer.toString('base64');

        // 3. Invocar microservicio de WhatsApp UNA SOLA VEZ
        timeoutId = setTimeout(() => {
            console.error('⚠️ [CC-CONTROLLER] Tiempo de espera agotado al enviar comprobantes agrupados por WhatsApp.');
            controller.abort();
        }, 35000);

        const response = await fetch('http://localhost:3004/facturacion/whatsapp/enviar-documento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destinatarios: strDestinatarios,
                pdfBase64: pdfBase64,
                filename: filename,
                mensajeTexto: mensajeTexto || fallbackMsg
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();
        if (!response.ok || !data.success) {
            return res.status(response.status || 502).json({
                success: false,
                error: data.error || 'Falla del microservicio',
                message: data.message || 'No se pudo enviar el documento unificado por WhatsApp.'
            });
        }

        res.json({
            success: true,
            message: `Documento unificado con ${movimientos.length} comprobante(s) enviado con éxito por WhatsApp.`,
            data: data.data
        });
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('❌ [CC-CONTROLLER] Error al enviar comprobantes agrupados por WhatsApp:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error interno al enviar comprobantes por WhatsApp.'
        });
    }
};

/**
 * Enviar múltiples comprobantes agrupados en UN SOLO PDF por Email
 * POST /api/logistica/bunker/cuentas-corrientes/movimientos/email-multi
 */
exports.enviarComprobantesEmailMulti = async (req, res) => {
    let timeoutId;
    const controller = new AbortController();
    try {
        const { movimientoIds, destinatarios, mensajeTexto } = req.body;

        const strDestinatarios = Array.isArray(destinatarios) ? destinatarios.join(', ') : String(destinatarios || '');

        if (!Array.isArray(movimientoIds) || movimientoIds.length === 0) {
            return res.status(400).json({ success: false, error: 'Debe especificar al menos un movimiento.' });
        }
        if (!strDestinatarios || !strDestinatarios.trim()) {
            return res.status(400).json({ success: false, error: 'Destinatarios no especificados.' });
        }

        console.log(`📧 [CC-CONTROLLER] Unificando y enviando ${movimientoIds.length} comprobantes por Email a: ${strDestinatarios}`);

        const items = [];
        for (const movId of movimientoIds) {
            try {
                const item = await obtenerComprobantePdfBuffer(movId);
                if (item && item.mov) items.push(item);
            } catch (e) {
                console.error(`⚠️ Error al obtener comprobante PDF para movimiento ID ${movId}:`, e.message);
            }
        }

        if (items.length === 0) {
            return res.status(404).json({ success: false, error: 'No se encontraron los movimientos solicitados.' });
        }

        const movimientos = items.map(it => it.mov);

        const pdfBuffer = await generarMultiplesComprobantesPDF(items);

        const tieneFacturas = movimientos.some(m => ['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'NOTA_CREDITO', 'NOTA_DEBITO', 'PENDIENTE_FACTURACION', 'PRESUPUESTO'].includes(m.tipo_comprobante));
        const tieneRecibos = movimientos.some(m => !['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'NOTA_CREDITO', 'NOTA_DEBITO', 'PENDIENTE_FACTURACION', 'PRESUPUESTO'].includes(m.tipo_comprobante));

        const clienteObj = await ClientesBunkerModel.obtenerPorCodigoBunker(movimientos[0].codigo_bunker_cliente);
        
        timeoutId = setTimeout(() => {
            console.error('⚠️ [CC-CONTROLLER] Tiempo de espera agotado al enviar comprobantes agrupados por Email.');
            controller.abort();
        }, 25000);

        const pdfBase64 = pdfBuffer.toString('base64');
        
        let nroComprobante;
        if (movimientos.length === 1) {
            nroComprobante = movimientos[0].numero_comprobante || `COMP-${String(movimientos[0].id).padStart(8, '0')}`;
        } else if (tieneFacturas && !tieneRecibos) {
            nroComprobante = `DOCUMENTACIÓN FACTURACIÓN (${movimientos.length} COMPROBANTES)`;
        } else if (!tieneFacturas && tieneRecibos) {
            nroComprobante = `RECIBOS DE PAGO (${movimientos.length} COMPROBANTES)`;
        } else {
            nroComprobante = `COMPROBANTES AGRUPADOS (${movimientos.length} DOCUMENTOS)`;
        }

        let fallbackEmailMsg = 'Hola! Adjuntamos el resumen de comprobantes de su cuenta corriente. Saludos!';
        if (tieneFacturas && !tieneRecibos) {
            fallbackEmailMsg = 'Hola! Adjuntamos la documentación de facturación de su cuenta corriente. Saludos!';
        } else if (!tieneFacturas && tieneRecibos) {
            fallbackEmailMsg = 'Hola! Adjuntamos los comprobantes de pago de su cuenta corriente. Saludos!';
        }

        const response = await fetch('http://localhost:3004/facturacion/email/comprobantes/enviar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente: {
                    cliente_nombre: clienteObj ? clienteObj.cliente_nombre : '',
                    razon_social: clienteObj ? clienteObj.razon_social : '',
                    codigo_bunker_cliente: movimientos[0].codigo_bunker_cliente
                },
                destinatarios,
                pdfBase64: pdfBase64,
                nroComprobante,
                mensajeTexto: mensajeTexto || fallbackEmailMsg
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();
        res.json({
            success: true,
            message: `Documento unificado con ${movimientos.length} comprobantes enviado con éxito por Email.`
        });
    } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('❌ [CC-CONTROLLER] Error al enviar comprobantes agrupados por Email:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error interno al enviar comprobantes por Email.'
        });
    }
};
