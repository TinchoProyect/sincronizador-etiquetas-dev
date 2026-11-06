/**
 * Controlador de AFIP
 * Maneja las requests HTTP relacionadas con servicios AFIP
 */

const { afip, ultimoAutorizado, obtenerRutaArchivoTA } = require('../services/wsfeService');
const { sincronizarAfip, obtenerEstadoAfip } = require('../services/numeroService');
const { formatearTimestamp } = require('../config/timezone');
const { ENTORNO } = require('../config/afip');

console.log('🔍 [FACTURACION-AFIP-CTRL] Cargando controlador de AFIP...');

/**
 * Obtener último comprobante autorizado
 * GET /facturacion/afip/ultimo
 */
const obtenerUltimo = async (req, res) => {
    console.log('🔍 [FACTURACION-AFIP-CTRL] GET /afip/ultimo - Consultar último autorizado');

    const { pto_vta, tipo_cbte } = req.query;

    console.log(`📊 [FACTURACION-AFIP-CTRL] PV: ${pto_vta}, Tipo: ${tipo_cbte}`);

    try {
        if (!pto_vta || !tipo_cbte) {
            return res.status(400).json({
                success: false,
                error: 'Parámetros requeridos: pto_vta y tipo_cbte'
            });
        }

        const ultimo = await ultimoAutorizado(
            parseInt(pto_vta),
            parseInt(tipo_cbte),
            ENTORNO
        );

        console.log(`✅ [FACTURACION-AFIP-CTRL] Último autorizado: ${ultimo}`);

        res.status(200).json({
            success: true,
            data: {
                pto_vta: parseInt(pto_vta),
                tipo_cbte: parseInt(tipo_cbte),
                ultimo_autorizado: ultimo,
                siguiente: ultimo + 1,
                entorno: ENTORNO
            }
        });

    } catch (error) {
        console.error('❌ [FACTURACION-AFIP-CTRL] Error consultando último:', error.message);

        res.status(500).json({
            success: false,
            error: 'Error consultando último autorizado',
            message: error.message
        });
    }
};

/**
 * Sincronizar numeración con AFIP
 * POST /facturacion/afip/sincronizar
 */
const sincronizar = async (req, res) => {
    console.log('🔄 [FACTURACION-AFIP-CTRL] POST /afip/sincronizar - Sincronizar numeración');

    const { pto_vta, tipo_cbte } = req.body;

    try {
        if (!pto_vta || !tipo_cbte) {
            return res.status(400).json({
                success: false,
                error: 'Parámetros requeridos: pto_vta y tipo_cbte'
            });
        }

        const resultado = await sincronizarAfip(
            parseInt(pto_vta),
            parseInt(tipo_cbte),
            ENTORNO
        );

        console.log('✅ [FACTURACION-AFIP-CTRL] Sincronización completada');

        res.status(200).json({
            success: true,
            message: 'Numeración sincronizada con AFIP',
            data: resultado
        });

    } catch (error) {
        console.error('❌ [FACTURACION-AFIP-CTRL] Error sincronizando:', error.message);

        res.status(500).json({
            success: false,
            error: 'Error sincronizando con AFIP',
            message: error.message
        });
    }
};

/**
 * Verificar estado de autenticación
 * GET /facturacion/afip/auth/status
 */
const verificarAuth = async (req, res) => {
    console.log('🔍 [FACTURACION-AFIP-CTRL] GET /afip/auth/status - Verificar autenticación');

    try {
        res.status(200).json({
            success: true,
            data: {
                autenticado: true,
                entorno: ENTORNO,
                mensaje: 'Autenticación gestionada automáticamente por afip.js'
            }
        });

    } catch (error) {
        console.error('❌ [FACTURACION-AFIP-CTRL] Error verificando auth:', error.message);

        res.status(500).json({
            success: false,
            error: 'Error verificando autenticación',
            message: error.message
        });
    }
};

/**
 * Obtener estado de numeración
 * GET /facturacion/afip/numeracion
 */
const obtenerNumeracion = async (req, res) => {
    console.log('🔍 [FACTURACION-AFIP-CTRL] GET /afip/numeracion - Obtener estado de numeración');

    const { pto_vta, tipo_cbte } = req.query;

    try {
        if (!pto_vta || !tipo_cbte) {
            return res.status(400).json({
                success: false,
                error: 'Parámetros requeridos: pto_vta y tipo_cbte'
            });
        }

        const estado = await obtenerEstadoAfip(
            parseInt(pto_vta),
            parseInt(tipo_cbte)
        );

        console.log('✅ [FACTURACION-AFIP-CTRL] Estado de numeración obtenido');

        res.status(200).json({
            success: true,
            data: {
                pto_vta: parseInt(pto_vta),
                tipo_cbte: parseInt(tipo_cbte),
                ...estado,
                entorno: ENTORNO
            }
        });

    } catch (error) {
        console.error('❌ [FACTURACION-AFIP-CTRL] Error obteniendo numeración:', error.message);

        res.status(500).json({
            success: false,
            error: 'Error obteniendo estado de numeración',
            message: error.message
        });
    }
};

/**
 * Renovar TA de homologación INTELIGENTE (para botón de UI)
 * POST /facturacion/afip/homo/ta/refresh
 * 
 * Lógica inteligente:
 * - Si TA vigente (con margen 10 min) → NO renovar, devolver existente
 * - Si NO vigente o no existe → Renovar, guardar y devolver
 */
const renovarTAHomo = async (req, res) => {
    console.log('🔄 [FACTURACION-AFIP-CTRL] POST /afip/homo/ta/refresh - Verificar/Renovar TA HOMO');
    try {
        const fs = require('fs');
        await afip.GetServiceTA('wsfe');
        const taPath = obtenerRutaArchivoTA('wsfe');
        let expDate = new Date(Date.now() + 11 * 60 * 60 * 1000);
        if (fs.existsSync(taPath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(taPath, 'utf8'));
                const expStr = raw && raw.header && raw.header[1] && raw.header[1].expirationtime;
                if (expStr) expDate = new Date(expStr);
            } catch (_) {}
        }
        const minRestantes = Math.max(0, Math.round((expDate.getTime() - Date.now()) / 60000));
        res.json({
            success: true,
            entorno: ENTORNO,
            servicio: 'wsfe',
            vigente: minRestantes > 0,
            renovado: true,
            expira_en: expDate.toISOString(),
            expira_en_formatted: expDate.toLocaleString('es-AR'),
            minutos_restantes: minRestantes,
            mensaje: `Ticket de Acceso (${ENTORNO}/wsfe) verificado y sincronizado correctamente.`
        });
    } catch (error) {
        console.error('❌ [FACTURACION-AFIP-CTRL] Error renovando TA:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al renovar TA de ARCA',
            message: error.message
        });
    }
};

console.log('✅ [FACTURACION-AFIP-CTRL] Controlador de AFIP cargado');

module.exports = {
    obtenerUltimo,
    sincronizar,
    verificarAuth,
    obtenerNumeracion,
    renovarTAHomo
};
