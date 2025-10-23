/**
 * Controlador de AFIP
 * Maneja las requests HTTP relacionadas con servicios AFIP
 */

const { ultimoAutorizado } = require('../services/wsfeService');
const { sincronizarAfip, obtenerEstadoAfip } = require('../services/numeroService');
const { hayTAValido, renovarTA } = require('../services/wsaaService');
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
        const valido = await hayTAValido(ENTORNO);
        
        console.log(`📊 [FACTURACION-AFIP-CTRL] Token válido: ${valido}`);
        
        res.status(200).json({
            success: true,
            data: {
                autenticado: valido,
                entorno: ENTORNO
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
    
    const MARGEN_MS = 10 * 60 * 1000; // 10 minutos en milisegundos
    
    try {
        const { pool } = require('../config/database');
        
        // 1. Verificar si existe TA vigente en BD
        console.log('🔍 [FACTURACION-AFIP-CTRL] Verificando TA existente en BD...');
        
        const queryTA = `
            SELECT entorno, servicio, token, sign, expira_en, creado_en
            FROM factura_afip_ta
            WHERE entorno = 'HOMO' AND servicio = 'wsfe'
        `;
        
        const resultadoTA = await pool.query(queryTA);
        const taExistente = resultadoTA.rows[0];
        
        if (taExistente) {
            console.log('📋 [FACTURACION-AFIP-CTRL] TA encontrado en BD');
            console.log(`   Expira: ${taExistente.expira_en}`);
            
            // Verificar si está vigente (con margen)
            const ahora = Date.now();
            const expiraEn = new Date(taExistente.expira_en).getTime();
            const tiempoRestante = expiraEn - ahora;
            const vigente = tiempoRestante > MARGEN_MS;
            
            const minutosRestantes = Math.floor(tiempoRestante / 1000 / 60);
            
            console.log(`⏱️ [FACTURACION-AFIP-CTRL] Tiempo restante: ${minutosRestantes} minutos`);
            console.log(`📊 [FACTURACION-AFIP-CTRL] Margen requerido: 10 minutos`);
            console.log(`✅ [FACTURACION-AFIP-CTRL] TA vigente: ${vigente}`);
            
            if (vigente) {
                // TA vigente, NO renovar
                const expiraFormatted = formatearTimestamp(taExistente.expira_en);
                
                console.log('✅ [FACTURACION-AFIP-CTRL] TA vigente (sin renovar)');
                console.log(`   Expira: ${expiraFormatted}`);
                console.log(`   Tiempo restante: ${minutosRestantes} minutos`);
                
                return res.json({
                    success: true,
                    entorno: 'HOMO',
                    servicio: 'wsfe',
                    expira_en: taExistente.expira_en,
                    expira_en_formatted: expiraFormatted,
                    vigente: true,
                    renovado: false,
                    minutos_restantes: minutosRestantes,
                    mensaje: `TA vigente (sin renovar) - Expira en ${minutosRestantes} minutos`
                });
            } else {
                console.log('⚠️ [FACTURACION-AFIP-CTRL] TA próximo a vencer o vencido, renovando...');
            }
        } else {
            console.log('ℹ️ [FACTURACION-AFIP-CTRL] No se encontró TA en BD, renovando...');
        }
        
        // 2. TA no vigente o no existe → Renovar
        console.log('🔄 [FACTURACION-AFIP-CTRL] Iniciando renovación de TA...');
        
        const resultado = await renovarTA('HOMO');
        
        // Formatear fecha para zona horaria Argentina
        const expiraFormatted = formatearTimestamp(resultado.expira_en);
        
        // Calcular minutos restantes
        const ahora = Date.now();
        const expiraEn = new Date(resultado.expira_en).getTime();
        const minutosRestantes = Math.floor((expiraEn - ahora) / 1000 / 60);
        
        console.log(`✅ [FACTURACION-AFIP-CTRL] TA renovado exitosamente`);
        console.log(`   Expira: ${expiraFormatted}`);
        console.log(`   Tiempo de vida: ${minutosRestantes} minutos`);
        
        res.json({
            success: true,
            entorno: 'HOMO',
            servicio: 'wsfe',
            expira_en: resultado.expira_en,
            expira_en_formatted: expiraFormatted,
            vigente: true,
            renovado: true,
            minutos_restantes: minutosRestantes,
            mensaje: `TA renovado exitosamente - Válido por ${minutosRestantes} minutos`
        });
        
    } catch (error) {
        console.error(`❌ [FACTURACION-AFIP-CTRL] Error en renovación inteligente:`, error.message);
        console.error(`❌ [FACTURACION-AFIP-CTRL] Stack:`, error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Error verificando/renovando TA',
            message: error.message,
            vigente: false
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
