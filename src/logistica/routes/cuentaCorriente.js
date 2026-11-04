const express = require('express');
const fs = require('fs');
const router = express.Router();

const ctrlPath = require.resolve('../controllers/cuentaCorrienteController');
const salvavidasPath = require.resolve('../services/salvavidasService');
const compSaldoPath = require.resolve('../services/composicionSaldoService');
let lastCtrlMtime = fs.statSync(ctrlPath).mtimeMs;
let lastSalvMtime = fs.statSync(salvavidasPath).mtimeMs;
let lastCompMtime = fs.statSync(compSaldoPath).mtimeMs;
let cuentaCorrienteController = require('../controllers/cuentaCorrienteController');

function getCtrl() {
    try {
        const m1 = fs.statSync(ctrlPath).mtimeMs;
        const m2 = fs.statSync(salvavidasPath).mtimeMs;
        const m3 = fs.statSync(compSaldoPath).mtimeMs;
        if (m1 !== lastCtrlMtime || m2 !== lastSalvMtime || m3 !== lastCompMtime) {
            delete require.cache[compSaldoPath];
            delete require.cache[salvavidasPath];
            delete require.cache[ctrlPath];
            cuentaCorrienteController = require('../controllers/cuentaCorrienteController');
            lastCtrlMtime = m1;
            lastSalvMtime = m2;
            lastCompMtime = m3;
            console.log('♻️ [CC-ROUTES] Controlador, Composición de Saldo y Salvavidas recargados en caliente.');
        }
    } catch (e) {}
    return cuentaCorrienteController;
}

console.log('🔍 [CC-ROUTES] Preparando rutas de Cuenta Corriente...');

// Listar todas las cuentas corrientes de un cliente (?cliente=CB-XXXX)
router.get('/', (req, res, next) => getCtrl().listarCuentas(req, res, next));

// Crear/abrir una nueva cuenta corriente para un cliente
router.post('/', (req, res, next) => getCtrl().crearCuenta(req, res, next));

// Listar movimientos de una cuenta corriente específica
router.get('/:id/movimientos', (req, res, next) => getCtrl().listarMovimientos(req, res, next));

// Registrar movimiento manual (pago/ajuste) en una cuenta corriente específica
router.post('/:id/movimientos', (req, res, next) => getCtrl().registrarMovimientoManual(req, res, next));

// Registrar ajuste automático por saldo mínimo/remanente
router.post('/:id/ajuste-automatico', (req, res, next) => getCtrl().registrarAjusteAutomatico(req, res, next));

// Actualizar saldo de apertura/inicial de una cuenta corriente
router.put('/:id/saldo-apertura', (req, res, next) => getCtrl().actualizarSaldoApertura(req, res, next));

// Generar reporte PDF de la cuenta corriente
router.get('/:id/reporte-pdf', (req, res, next) => getCtrl().generarReportePdf(req, res, next));

// Generar PDF de Políticas y Beneficio de Financiación LAMDA (con caso práctico de la cuenta)
router.get('/:id/politicas-financiacion-pdf', (req, res, next) => getCtrl().generarPoliticasFinanciacionCuentaPdf(req, res, next));

// Simular imputación de un pago entrante (Capital vs. Interés de Financiación / Opción de Bonificación)
router.get('/:id/simular-imputacion-pago', (req, res, next) => getCtrl().simularImputacionPagoCuenta(req, res, next));

// Enviar múltiples comprobantes por WhatsApp / Email
router.post('/movimientos/whatsapp-multi', (req, res, next) => getCtrl().enviarComprobantesWhatsappMulti(req, res, next));
router.post('/movimientos/email-multi', (req, res, next) => getCtrl().enviarComprobantesEmailMulti(req, res, next));

// Generar comprobante PDF individual para un movimiento (Factura/Nota de Crédito/Recibo)
router.get('/movimientos/:movimientoId/pdf', (req, res, next) => getCtrl().generarComprobantePdf(req, res, next));
router.post('/movimientos/:movimientoId/whatsapp', (req, res, next) => getCtrl().enviarComprobanteWhatsapp(req, res, next));
router.post('/movimientos/:movimientoId/email', (req, res, next) => getCtrl().enviarComprobanteEmail(req, res, next));

// Obtener el mensaje predeterminado para WhatsApp
router.get('/:id/whatsapp/mensaje-predeterminado', (req, res, next) => getCtrl().obtenerMensajePredeterminadoWhatsapp(req, res, next));

// Endpoints del Servicio Salvavidas (Financiación Automática / Modo Sombra)
router.get('/salvavidas/dashboard-sombra', (req, res, next) => getCtrl().obtenerDashboardSalvavidas(req, res, next));
router.get('/salvavidas/configuracion-global', (req, res, next) => getCtrl().obtenerConfiguracionGlobalSalvavidas(req, res, next));
router.put('/salvavidas/configuracion-global', (req, res, next) => getCtrl().actualizarConfiguracionGlobalSalvavidas(req, res, next));
router.put('/salvavidas/configuracion-cliente/:codigo', (req, res, next) => getCtrl().actualizarConfiguracionClienteSalvavidas(req, res, next));
router.get('/:id/salvavidas-simulacion', (req, res, next) => getCtrl().obtenerSimulacionSalvavidas(req, res, next));
router.post('/:id/facturar-interes-pago', (req, res, next) => getCtrl().facturarInteresPago(req, res, next));

// Obtener la composición de saldo por capas y factor tiempo (Punto Cero Logístico)
router.get('/:id/composicion-saldo', (req, res, next) => getCtrl().obtenerComposicionSaldo(req, res, next));

// Enviar reporte de cuenta corriente por WhatsApp
router.post('/:id/whatsapp', (req, res, next) => getCtrl().enviarReporteWhatsapp(req, res, next));

// Enviar reporte de cuenta corriente por Correo Electrónico
router.post('/:id/email', (req, res, next) => getCtrl().enviarReporteEmail(req, res, next));

// Actualizar configuración/parametrización predeterminada de reporte PDF
router.patch('/:id/configuracion-reporte', (req, res, next) => getCtrl().actualizarConfiguracionReporte(req, res, next));

// Obtener presupuestos de Lomasoft pendientes para incorporar
router.get('/:id/presupuestos-pendientes', (req, res, next) => getCtrl().listarPresupuestosPendientesLomasoft(req, res, next));

// Incorporar manualmente un presupuesto del Puesto 007
router.post('/:id/incorporar-presupuesto', (req, res, next) => getCtrl().incorporarPresupuesto(req, res, next));

// Eliminar un movimiento de cuenta corriente
router.delete('/movimientos/:movimientoId', (req, res, next) => getCtrl().eliminarMovimiento(req, res, next));

console.log('✅ [CC-ROUTES] Rutas de Cuenta Corriente expuestas.');
module.exports = router;
