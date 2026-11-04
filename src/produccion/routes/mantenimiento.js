const express = require('express');
const router = express.Router();
const mantenimientoCtrl = require('../controllers/mantenimiento');

// Middleware para logging
router.use((req, res, next) => {
    console.log(`🛠️ [MANTENIMIENTO API] ${req.method} ${req.url}`);
    next();
});

// Rutas GET (Visualización)
router.get('/stock', mantenimientoCtrl.getStockMantenimiento);
router.post('/conciliar/confirmar', mantenimientoCtrl.confirmarConciliacion);
router.post('/liberar', mantenimientoCtrl.liberarStock);
router.get('/historial', mantenimientoCtrl.getHistorialMantenimiento);
router.get('/vigia-auditor', mantenimientoCtrl.diagnosticoVigiaAuditor);
router.post('/transferir-ingrediente', mantenimientoCtrl.transferirAIngredientes);
router.post('/revertir', mantenimientoCtrl.revertirMovimiento);
router.post('/conciliar/deshacer', mantenimientoCtrl.deshacerConciliacion);
router.get('/trazar-factura', mantenimientoCtrl.trazarFacturaOriginal);
router.post('/limpiar-registro', mantenimientoCtrl.limpiarRegistroAdministrativo);
router.get('/buscar-orden-retiro/:idFactura/:articulo', mantenimientoCtrl.buscarOrdenRetiro);

// Rutas Logística Inversa
router.get('/retiros/local', mantenimientoCtrl.getRetirosLocal);
router.get('/retiros/ruta', mantenimientoCtrl.getRetirosRuta);
router.get('/buscar-clientes-modal', mantenimientoCtrl.buscarClientesModal);
router.get('/rutas-recientes-cliente', mantenimientoCtrl.obtenerRutasRecientesCliente);
router.get('/reporte-trazabilidad-datos', mantenimientoCtrl.generarReporteTrazabilidadDatos);
router.post('/registrar-retiro-retroactivo', mantenimientoCtrl.registrarRetiroRetroactivo);
router.post('/retiros/recibir-local/:id', mantenimientoCtrl.recibirRetiroLocal);
// Revertir Recepción Local (Devuelve de Stock Mantenimiento a Orden de Retiro PENDIENTE)
router.delete('/ingreso', mantenimientoCtrl.revertirIngresoLocal);
router.post('/emitir-nc-borrador', mantenimientoCtrl.emitirNotaCreditoBorrador);


// Nuevos endpoints de traslados a mantenimiento
router.post('/traslado-ventas', mantenimientoCtrl.trasladoVentas);
router.post('/traslado-ingredientes', mantenimientoCtrl.trasladoIngredientes);
router.post('/anular-traslado', mantenimientoCtrl.anularTraslado);
router.post('/anular-traslado-agrupado', mantenimientoCtrl.anularTrasladoAgrupado);
router.post('/retornar-ingrediente', mantenimientoCtrl.retornarIngrediente);

// ---- TRANSFORMACIÓN CON INGREDIENTES ----
router.post('/transformar-con-ingrediente', mantenimientoCtrl.transformarConIngrediente);

// ---- NUEVO MÓDULO DE TRATAMIENTOS ----
router.post('/tratamientos/iniciar', mantenimientoCtrl.iniciarTratamiento);
router.get('/tratamientos', mantenimientoCtrl.getTratamientosActivos);
router.post('/tratamientos/:id/sellar', mantenimientoCtrl.sellarTratamiento);
router.post('/tratamientos/:id/anular', mantenimientoCtrl.anularTratamiento);
router.post('/tratamientos/:id/abrir', mantenimientoCtrl.abrirTratamiento);
router.post('/tratamientos/:id/finalizar', mantenimientoCtrl.finalizarTratamiento);
router.post('/retorno-a-logistica', mantenimientoCtrl.retornoALogistica);
router.get('/reporte-arribo/:id', mantenimientoCtrl.imprimirComprobanteArribo);
router.post('/asignar-articulo', mantenimientoCtrl.asignarArticuloOficial);
router.post('/desasignar-articulo', mantenimientoCtrl.desasignarArticuloOficial);
router.get('/presupuestos-entregados', mantenimientoCtrl.getPresupuestosEntregados);
router.post('/vincular-presupuesto', mantenimientoCtrl.vincularPresupuesto);
router.post('/desvincular-presupuesto', mantenimientoCtrl.desvincularPresupuesto);
router.post('/corregir-recepcion-rt', mantenimientoCtrl.corregirRecepcionRT);

module.exports = router;
