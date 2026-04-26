/**
 * Controlador de Auditorías de Rutas
 * Lógica transaccional REST para la conciliación de rutas
 */

const AuditoriasModel = require('../models/auditoriasModel');
const PuntosBaseModel = require('../models/puntosBaseModel');
const RutasModel = require('../models/rutasModel');
const GoogleTimelineParser = require('../services/googleTimelineParser');

class AuditoriasController {
    
    /**
     * Procesar un archivo JSON de Google (En memoria, no guarda)
     * Retorna la vista previa de la auditoría.
     */
    static async procesarAuditoriaPreview(req, res) {
        try {
            console.log('[AUDITORIAS] Iniciando procesamiento de preview JSON');
            
            // Validaciones
            const id_ruta = parseInt(req.body.id_ruta);
            const timelineJsonStr = req.body.timelineJson;
            
            if (!id_ruta) return res.status(400).json({ success: false, error: 'Se requiere ID de Ruta' });
            if (!timelineJsonStr) return res.status(400).json({ success: false, error: 'Se requiere JSON de Timeline' });

            let timelineJson;
            try {
                timelineJson = JSON.parse(timelineJsonStr);
            } catch(e) {
                return res.status(400).json({ success: false, error: 'El archivo provisto no es un JSON válido.' });
            }

            // 1. Obtener la Ruta original y sus entregas
            const ruta = await RutasModel.obtenerPorId(id_ruta);
            if (!ruta) return res.status(404).json({ success: false, error: 'Ruta no encontrada' });
            
            // Extraer las entregas/paradas mapeadas con sus latitudes
            const paradas = ruta.presupuestos || [];

            // 2. Obtener Puntos Base
            const puntosBase = await PuntosBaseModel.obtenerTodos();

            // 3. Procesar mediante el Motor Analítico
            const resultado = GoogleTimelineParser.procesar(timelineJson, puntosBase, paradas);

            // 4. Calcular desviación teórica
            const duracionDeclarada = ruta.duracion_neta_minutos || 0;
            const duracionReal = resultado.tiempo_real_minutos;
            let desviacion = 0;
            if (duracionDeclarada > 0) {
                desviacion = parseFloat((((duracionReal - duracionDeclarada) / duracionDeclarada) * 100).toFixed(2));
            }

            resultado.desviacion_global_porcentaje = desviacion;
            resultado.id_ruta = id_ruta;
            resultado.estado = 'PREVIEW'; // Solo en memoria
            resultado.ruta_teorica = ruta;

            return res.json({ success: true, data: resultado });

        } catch (error) {
            console.error('[AUDITORIAS] ❌ Error en pre-procesamiento:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Guardar de manera atómica una auditoría ya revisada por el humano.
     */
    static async guardarAuditoria(req, res) {
        try {
            console.log('[AUDITORIAS] Guardando auditoría consolidada');
            
            const auditoriaData = req.body;
            
            if (!auditoriaData || !auditoriaData.id_ruta || !auditoriaData.tramos) {
                return res.status(400).json({ success: false, error: 'Estructura de auditoría inválida o incompleta.' });
            }

            // En un futuro se extrae el auditor del JWT. Por ahora quemado o enviado desde frontend.
            auditoriaData.usuario_auditor = req.user?.usuario || 'Auditor Central';

            const result = await AuditoriasModel.guardar(auditoriaData);

            return res.json({ success: true, message: 'Auditoría guardada exitosamente.', id_auditoria: result.id_auditoria });
        } catch (error) {
            console.error('[AUDITORIAS] ❌ Error al guardar:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Listar auditorías (Historial)
     */
    static async listarAuditorias(req, res) {
        try {
            const lista = await AuditoriasModel.obtenerTodas();
            return res.json({ success: true, data: lista });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Ver Detalle Completo Auditoria
     */
    static async detalleAuditoria(req, res) {
        try {
            const { id } = req.params;
            const auditoria = await AuditoriasModel.obtenerPorId(id);
            if(!auditoria) return res.status(404).json({ success: false, error: 'No encontrada' });
            return res.json({ success: true, data: auditoria });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    // =====================================
    // CRUD PUNTOS BASE
    // =====================================
    static async listarPuntosBase(req, res) {
        try {
            const data = await PuntosBaseModel.obtenerTodos();
            return res.json({ success: true, data });
        } catch(e) { return res.status(500).json({ success: false, error: e.message }); }
    }

    static async crearPuntoBase(req, res) {
        try {
            const data = await PuntosBaseModel.crear(req.body);
            return res.json({ success: true, data });
        } catch(e) { return res.status(500).json({ success: false, error: e.message }); }
    }
}

module.exports = AuditoriasController;
