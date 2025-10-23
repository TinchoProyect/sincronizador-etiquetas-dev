/**
 * Servicio de numeración de comprobantes
 * Gestiona numeración AFIP e interna con locks para evitar duplicados
 */

const { pool, ejecutarTransaccion } = require('../config/database');
const { paraBD } = require('../config/timezone');
const { ultimoAutorizado } = require('./wsfeService');

console.log('🔍 [FACTURACION-NUMERO] Cargando servicio de numeración...');

/**
 * Obtener siguiente número AFIP
 * Consulta AFIP y actualiza tabla de numeración
 * 
 * @param {number} ptoVta - Punto de venta
 * @param {number} tipoCbte - Tipo de comprobante
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<number>} Siguiente número
 */
const nextAfip = async (ptoVta, tipoCbte, entorno = 'HOMO') => {
    console.log(`🔢 [FACTURACION-NUMERO] Obteniendo siguiente número AFIP PV:${ptoVta} Tipo:${tipoCbte}`);
    
    try {
        return await ejecutarTransaccion(async (client) => {
            // 1. Bloquear registro para evitar race conditions
            console.log(`🔒 [FACTURACION-NUMERO] Bloqueando registro de numeración...`);
            
            const lockQuery = `
                SELECT ultimo_cbte_afip
                FROM factura_numeracion_afip
                WHERE pto_vta = $1 AND tipo_cbte = $2
                FOR UPDATE
            `;
            
            let resultado = await client.query(lockQuery, [ptoVta, tipoCbte]);
            
            let ultimoLocal = 0;
            
            if (resultado.rows.length === 0) {
                // No existe registro, crear uno
                console.log(`📝 [FACTURACION-NUMERO] Creando registro de numeración...`);
                
                // Consultar último autorizado en AFIP
                const ultimoAfip = await ultimoAutorizado(ptoVta, tipoCbte, entorno);
                console.log(`📊 [FACTURACION-NUMERO] Último AFIP: ${ultimoAfip}`);
                
                const insertQuery = `
                    INSERT INTO factura_numeracion_afip (pto_vta, tipo_cbte, ultimo_cbte_afip, actualizado_en)
                    VALUES ($1, $2, $3, $4)
                    RETURNING ultimo_cbte_afip
                `;
                
                resultado = await client.query(insertQuery, [ptoVta, tipoCbte, ultimoAfip, paraBD()]);
                ultimoLocal = resultado.rows[0].ultimo_cbte_afip;
            } else {
                ultimoLocal = resultado.rows[0].ultimo_cbte_afip;
                console.log(`📊 [FACTURACION-NUMERO] Último local: ${ultimoLocal}`);
            }
            
            // 2. Calcular siguiente número
            const siguiente = ultimoLocal + 1;
            console.log(`➕ [FACTURACION-NUMERO] Siguiente número: ${siguiente}`);
            
            // 3. Actualizar registro
            const updateQuery = `
                UPDATE factura_numeracion_afip
                SET ultimo_cbte_afip = $1, actualizado_en = $2
                WHERE pto_vta = $3 AND tipo_cbte = $4
            `;
            
            await client.query(updateQuery, [siguiente, paraBD(), ptoVta, tipoCbte]);
            console.log(`✅ [FACTURACION-NUMERO] Numeración actualizada`);
            
            return siguiente;
        });
        
    } catch (error) {
        console.error('❌ [FACTURACION-NUMERO] Error obteniendo siguiente número AFIP:', error.message);
        throw error;
    }
};

/**
 * Obtener siguiente número interno
 * Para facturas que no requieren AFIP
 * 
 * @param {string} serieInterna - Serie interna (ej: 'A', 'B', 'X')
 * @returns {Promise<number>} Siguiente número
 */
const nextInterno = async (serieInterna) => {
    console.log(`🔢 [FACTURACION-NUMERO] Obteniendo siguiente número interno serie: ${serieInterna}`);
    
    try {
        return await ejecutarTransaccion(async (client) => {
            // 1. Bloquear registro
            console.log(`🔒 [FACTURACION-NUMERO] Bloqueando registro de numeración interna...`);
            
            const lockQuery = `
                SELECT ultimo_nro
                FROM factura_numeracion_interna
                WHERE serie_interna = $1
                FOR UPDATE
            `;
            
            let resultado = await client.query(lockQuery, [serieInterna]);
            
            let ultimoNro = 0;
            
            if (resultado.rows.length === 0) {
                // No existe registro, crear uno
                console.log(`📝 [FACTURACION-NUMERO] Creando registro de numeración interna...`);
                
                const insertQuery = `
                    INSERT INTO factura_numeracion_interna (serie_interna, ultimo_nro, actualizado_en)
                    VALUES ($1, $2, $3)
                    RETURNING ultimo_nro
                `;
                
                resultado = await client.query(insertQuery, [serieInterna, 0, paraBD()]);
                ultimoNro = resultado.rows[0].ultimo_nro;
            } else {
                ultimoNro = resultado.rows[0].ultimo_nro;
                console.log(`📊 [FACTURACION-NUMERO] Último número: ${ultimoNro}`);
            }
            
            // 2. Calcular siguiente número
            const siguiente = ultimoNro + 1;
            console.log(`➕ [FACTURACION-NUMERO] Siguiente número: ${siguiente}`);
            
            // 3. Actualizar registro
            const updateQuery = `
                UPDATE factura_numeracion_interna
                SET ultimo_nro = $1, actualizado_en = $2
                WHERE serie_interna = $3
            `;
            
            await client.query(updateQuery, [siguiente, paraBD(), serieInterna]);
            console.log(`✅ [FACTURACION-NUMERO] Numeración interna actualizada`);
            
            return siguiente;
        });
        
    } catch (error) {
        console.error('❌ [FACTURACION-NUMERO] Error obteniendo siguiente número interno:', error.message);
        throw error;
    }
};

/**
 * Sincronizar numeración AFIP con último autorizado
 * Útil para recuperar sincronización después de errores
 * 
 * @param {number} ptoVta - Punto de venta
 * @param {number} tipoCbte - Tipo de comprobante
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} Resultado de sincronización
 */
const sincronizarAfip = async (ptoVta, tipoCbte, entorno = 'HOMO') => {
    console.log(`🔄 [FACTURACION-NUMERO] Sincronizando numeración AFIP PV:${ptoVta} Tipo:${tipoCbte}`);
    
    try {
        // 1. Consultar último autorizado en AFIP
        const ultimoAfip = await ultimoAutorizado(ptoVta, tipoCbte, entorno);
        console.log(`📊 [FACTURACION-NUMERO] Último AFIP: ${ultimoAfip}`);
        
        // 2. Obtener último local
        const queryLocal = `
            SELECT ultimo_cbte_afip
            FROM factura_numeracion_afip
            WHERE pto_vta = $1 AND tipo_cbte = $2
        `;
        
        const resultadoLocal = await pool.query(queryLocal, [ptoVta, tipoCbte]);
        const ultimoLocal = resultadoLocal.rows.length > 0 
            ? resultadoLocal.rows[0].ultimo_cbte_afip 
            : 0;
        
        console.log(`📊 [FACTURACION-NUMERO] Último local: ${ultimoLocal}`);
        
        // 3. Actualizar si hay diferencia
        if (ultimoAfip !== ultimoLocal) {
            console.log(`⚠️ [FACTURACION-NUMERO] Diferencia detectada, actualizando...`);
            
            const updateQuery = `
                INSERT INTO factura_numeracion_afip (pto_vta, tipo_cbte, ultimo_cbte_afip, actualizado_en)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (pto_vta, tipo_cbte)
                DO UPDATE SET
                    ultimo_cbte_afip = EXCLUDED.ultimo_cbte_afip,
                    actualizado_en = EXCLUDED.actualizado_en
            `;
            
            await pool.query(updateQuery, [ptoVta, tipoCbte, ultimoAfip, paraBD()]);
            
            console.log(`✅ [FACTURACION-NUMERO] Numeración sincronizada`);
            
            return {
                sincronizado: true,
                ultimoAfip,
                ultimoLocal,
                diferencia: ultimoAfip - ultimoLocal
            };
        }
        
        console.log(`✅ [FACTURACION-NUMERO] Numeración ya sincronizada`);
        
        return {
            sincronizado: true,
            ultimoAfip,
            ultimoLocal,
            diferencia: 0
        };
        
    } catch (error) {
        console.error('❌ [FACTURACION-NUMERO] Error sincronizando numeración:', error.message);
        throw error;
    }
};

/**
 * Obtener estado de numeración
 * @param {number} ptoVta - Punto de venta
 * @param {number} tipoCbte - Tipo de comprobante
 * @returns {Promise<Object>} Estado de numeración
 */
const obtenerEstadoAfip = async (ptoVta, tipoCbte) => {
    console.log(`🔍 [FACTURACION-NUMERO] Obteniendo estado de numeración PV:${ptoVta} Tipo:${tipoCbte}`);
    
    try {
        const query = `
            SELECT ultimo_cbte_afip, actualizado_en
            FROM factura_numeracion_afip
            WHERE pto_vta = $1 AND tipo_cbte = $2
        `;
        
        const resultado = await pool.query(query, [ptoVta, tipoCbte]);
        
        if (resultado.rows.length === 0) {
            console.log(`📝 [FACTURACION-NUMERO] No hay registro de numeración`);
            return {
                existe: false,
                ultimo: 0,
                siguiente: 1
            };
        }
        
        const ultimo = resultado.rows[0].ultimo_cbte_afip;
        const actualizado = resultado.rows[0].actualizado_en;
        
        console.log(`✅ [FACTURACION-NUMERO] Estado obtenido - Último: ${ultimo}`);
        
        return {
            existe: true,
            ultimo,
            siguiente: ultimo + 1,
            actualizado
        };
        
    } catch (error) {
        console.error('❌ [FACTURACION-NUMERO] Error obteniendo estado:', error.message);
        throw error;
    }
};

/**
 * Obtener estado de numeración interna
 * @param {string} serieInterna - Serie interna
 * @returns {Promise<Object>} Estado de numeración
 */
const obtenerEstadoInterno = async (serieInterna) => {
    console.log(`🔍 [FACTURACION-NUMERO] Obteniendo estado de numeración interna serie: ${serieInterna}`);
    
    try {
        const query = `
            SELECT ultimo_nro, actualizado_en
            FROM factura_numeracion_interna
            WHERE serie_interna = $1
        `;
        
        const resultado = await pool.query(query, [serieInterna]);
        
        if (resultado.rows.length === 0) {
            console.log(`📝 [FACTURACION-NUMERO] No hay registro de numeración interna`);
            return {
                existe: false,
                ultimo: 0,
                siguiente: 1
            };
        }
        
        const ultimo = resultado.rows[0].ultimo_nro;
        const actualizado = resultado.rows[0].actualizado_en;
        
        console.log(`✅ [FACTURACION-NUMERO] Estado obtenido - Último: ${ultimo}`);
        
        return {
            existe: true,
            ultimo,
            siguiente: ultimo + 1,
            actualizado
        };
        
    } catch (error) {
        console.error('❌ [FACTURACION-NUMERO] Error obteniendo estado interno:', error.message);
        throw error;
    }
};

console.log('✅ [FACTURACION-NUMERO] Servicio de numeración cargado');

module.exports = {
    nextAfip,
    nextInterno,
    sincronizarAfip,
    obtenerEstadoAfip,
    obtenerEstadoInterno
};
