const express = require('express');
const router = express.Router();
const ProspectosController = require('../controllers/prospectosController');

console.log('🎯 [PROSPECTOS-ROUTES] Configurando rutas del CRM de Contacto Calle...');

// Listado de prospectos con filtros
router.get('/', ProspectosController.obtenerTodos);

// Métricas para badges y dashboards
router.get('/metricas', ProspectosController.obtenerMetricas);

// Lista de zonas existentes
router.get('/zonas', ProspectosController.obtenerZonas);

// Listas de precios Bunker disponibles para cotizar o enviar catálogo
router.get('/listas-precios', ProspectosController.obtenerListasPrecios);

// Métricas de embudo de conversión y rendimiento por zona
router.get('/embudo', ProspectosController.obtenerMetricasEmbudo);
router.get('/funnel', ProspectosController.obtenerMetricasEmbudo);

// Rutas activas y choferes disponibles para enviar visitas a Hoja de Ruta
router.get('/rutas-disponibles', ProspectosController.obtenerRutasDisponibles);

// Enviar prospectos seleccionados a una Hoja de Ruta (existente o nueva)
router.post('/enviar-a-ruta', ProspectosController.enviarAHojaDeRuta);

// Enviar o retirar un Cliente Activo al Pool de Logística / Hoja de Ruta como Visita sin pedido
router.post('/visita-cliente-activo', ProspectosController.gestionarVisitaClienteActivo);

// Búsqueda focalizada en vivo en Internet por Rubro + Zona
router.post('/buscar-web', ProspectosController.buscarEnWebPorRubro);

// Importar comercios seleccionados desde la búsqueda web
router.post('/importar-web', ProspectosController.importarDesdeWeb);

// Configuración de Nodos (Casa/Depósito), Rutas/Zonas Lineales y Cronograma 7 Días (Mañana/Tarde)
router.get('/config-rutas-dias', ProspectosController.obtenerConfiguracionRutasDias);
router.post('/nodos', ProspectosController.guardarNodo);
router.delete('/nodos/:id', ProspectosController.eliminarNodo);
router.post('/rutas-zona', ProspectosController.guardarRutaZona);
router.delete('/rutas-zona/:id', ProspectosController.eliminarRutaZona);
router.post('/cronograma', ProspectosController.actualizarCronogramaBloque);

// Detalle de un prospecto
router.get('/:id', ProspectosController.obtenerPorId);

// Alta rápida de prospecto (calle o mostrador)
router.post('/', ProspectosController.crear);

// Edición completa de datos
router.put('/:id', ProspectosController.actualizar);

// Cambio rápido de estado y agenda
router.patch('/:id/estado', ProspectosController.cambiarEstado);

// Vincular un contacto a Rutas/Zonas lineales y/o Días-Turnos puntuales
router.patch('/:id/rutas-zona', ProspectosController.vincularRutasZonaProspecto);

// Enviar o retirar manualmente un contacto del Pool de Logística
router.patch('/:id/pool-logistica', ProspectosController.cambiarPoolLogistica);

// Registrar visita comercial realizada desde la Hoja de Ruta activa
router.post('/:id/visita-ruta', ProspectosController.registrarVisitaEnRuta);

// Conversión a cliente formal
router.post('/:id/convertir', ProspectosController.convertir);

// Despacho automatizado de catálogo PDF oficial vía WhatsApp centralizado
router.post('/:id/enviar-catalogo-whatsapp', ProspectosController.enviarCatalogoWhatsApp);

// Baja lógica
router.delete('/:id', ProspectosController.eliminar);

console.log('✅ [PROSPECTOS-ROUTES] Rutas de Contacto Calle expuestas.');
module.exports = router;
