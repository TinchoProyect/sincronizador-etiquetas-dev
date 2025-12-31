/**
 * Controlador para la funcionalidad "Abrir Caja"
 * Permite transformar stock de cajas a unidades mediante movimientos simples
 * 
 * @module controllers/abrirCaja
 */

const pool = require('../config/database');

/**
 * Obtener sugerencias inteligentes de cajas basadas en historial
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function obtenerSugerenciasCajas(req, res) {
    try {
        const { articulo_unidad } = req.query;
        
        if (!articulo_unidad) {
            return res.status(400).json({ 
                error: 'Se requiere el código del artículo unidad' 
            });
        }

        console.log(`🔍 [ABRIR-CAJA] Buscando sugerencias para unidad: ${articulo_unidad}`);

        // Consultar historial de aperturas previas
        const query = `
            SELECT DISTINCT
                svm.origen_ingreso as codigo_caja,
                a.nombre as descripcion_caja,
                a.codigo_barras,
                ROUND(CAST(src.stock_consolidado AS NUMERIC), 2) as stock_actual,
                MAX(svm.fecha) as ultima_apertura,
                COUNT(*) as veces_usado
            FROM stock_ventas_movimientos svm
            LEFT JOIN articulos a ON a.numero = svm.origen_ingreso
            LEFT JOIN stock_real_consolidado src ON src.articulo_numero = svm.origen_ingreso
            WHERE svm.articulo_numero = $1
              AND svm.tipo = 'apertura_caja_entrada'
              AND svm.origen_ingreso IS NOT NULL
              AND svm.origen_ingreso != ''
            GROUP BY svm.origen_ingreso, a.nombre, a.codigo_barras, src.stock_consolidado
            HAVING ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
            ORDER BY MAX(svm.fecha) DESC, COUNT(*) DESC
            LIMIT 5
        `;

        const result = await pool.query(query, [articulo_unidad]);

        console.log(`✅ [ABRIR-CAJA] Encontradas ${result.rows.length} sugerencias con stock`);

        res.json({
            success: true,
            sugerencias: result.rows
        });

    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al obtener sugerencias:', error);
        res.status(500).json({
            error: 'Error al obtener sugerencias de cajas',
            detalle: error.message
        });
    }
}

/**
 * Buscar cajas por código de barras o descripción
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function buscarCajas(req, res) {
    try {
        const { codigo_barras, descripcion } = req.query;

        if (!codigo_barras && !descripcion) {
            return res.status(400).json({
                error: 'Se requiere código de barras o descripción para buscar'
            });
        }

        let query;
        let params;

        if (codigo_barras) {
            // Búsqueda por código de barras (exacta)
            console.log(`🔍 [ABRIR-CAJA] Buscando por código de barras: ${codigo_barras}`);
            
            query = `
                SELECT 
                    a.numero as articulo_numero,
                    a.nombre as descripcion,
                    a.codigo_barras,
                    ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) as stock_actual
                FROM articulos a
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = a.numero
                WHERE a.codigo_barras = $1
                  AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
                LIMIT 1
            `;
            params = [codigo_barras];

        } else {
            // Búsqueda por descripción (múltiples palabras)
            console.log(`🔍 [ABRIR-CAJA] Buscando por descripción: ${descripcion}`);
            
            // Dividir descripción en palabras y crear condiciones ILIKE
            const palabras = descripcion.trim().split(/\s+/).filter(p => p.length > 0);
            const condiciones = palabras.map((_, idx) => `a.nombre ILIKE $${idx + 1}`).join(' AND ');
            const valores = palabras.map(p => `%${p}%`);

            query = `
                SELECT 
                    a.numero as articulo_numero,
                    a.nombre as descripcion,
                    a.codigo_barras,
                    ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) as stock_actual
                FROM articulos a
                LEFT JOIN stock_real_consolidado src ON src.articulo_numero = a.numero
                WHERE ${condiciones}
                  AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
                ORDER BY a.nombre
                LIMIT 20
            `;
            params = valores;
        }

        const result = await pool.query(query, params);

        console.log(`✅ [ABRIR-CAJA] Encontrados ${result.rows.length} resultados`);

        res.json({
            success: true,
            resultados: result.rows
        });

    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al buscar cajas:', error);
        res.status(500).json({
            error: 'Error al buscar cajas',
            detalle: error.message
        });
    }
}

/**
 * Registrar apertura de caja (transacción completa)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function registrarAperturaCaja(req, res) {
    const client = await pool.connect();
    
    try {
        const {
            codigo_caja,
            codigo_unidad,
            cantidad_unidades,
            usuario_id,
            kilos_caja,
            kilos_unidad
        } = req.body;

        // Validaciones
        if (!codigo_caja || !codigo_unidad || !cantidad_unidades || !usuario_id) {
            return res.status(400).json({
                error: 'Faltan datos requeridos',
                requeridos: ['codigo_caja', 'codigo_unidad', 'cantidad_unidades', 'usuario_id']
            });
        }

        if (cantidad_unidades < 1) {
            return res.status(400).json({
                error: 'La cantidad de unidades debe ser al menos 1'
            });
        }

        console.log(`\n🔓 [ABRIR-CAJA] ===== INICIANDO APERTURA =====`);
        console.log(`📦 Caja: ${codigo_caja}`);
        console.log(`📦 Unidad: ${codigo_unidad}`);
        console.log(`🔢 Cantidad: ${cantidad_unidades}`);
        console.log(`👤 Usuario: ${usuario_id}`);

        // Iniciar transacción
        await client.query('BEGIN');

        // 1. Verificar stock de la caja
        const stockCajaQuery = `
            SELECT 
                articulo_numero,
                descripcion,
                stock_consolidado
            FROM stock_real_consolidado
            WHERE articulo_numero = $1
            FOR UPDATE
        `;
        const stockCajaResult = await client.query(stockCajaQuery, [codigo_caja]);

        if (stockCajaResult.rows.length === 0) {
            throw new Error(`Caja ${codigo_caja} no encontrada en stock`);
        }

        const stockCaja = parseFloat(stockCajaResult.rows[0].stock_consolidado) || 0;
        
        if (stockCaja < 1) {
            throw new Error(`Stock insuficiente de caja ${codigo_caja}. Stock actual: ${stockCaja}`);
        }

        console.log(`✅ [ABRIR-CAJA] Stock caja verificado: ${stockCaja}`);

        // 2. Registrar ENTRADA de unidades (tipo='apertura_caja_entrada')
        const insertEntradaQuery = `
            INSERT INTO stock_ventas_movimientos (
                articulo_numero,
                codigo_barras,
                kilos,
                cantidad,
                tipo,
                origen_ingreso,
                usuario_id,
                fecha,
                carro_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
            RETURNING id
        `;

        const entradaResult = await client.query(insertEntradaQuery, [
            codigo_unidad,                    // articulo_numero (unidad)
            null,                             // codigo_barras (puede ser null)
            kilos_unidad || 0,                // kilos
            cantidad_unidades,                // cantidad (+N)
            'apertura_caja_entrada',          // tipo
            codigo_caja,                      // origen_ingreso (código de la caja)
            usuario_id,                       // usuario_id
        ]);

        const movimientoEntradaId = entradaResult.rows[0].id;
        console.log(`✅ [ABRIR-CAJA] Entrada registrada (ID: ${movimientoEntradaId})`);

        // 3. Registrar SALIDA de caja (tipo='apertura_caja_salida')
        const insertSalidaQuery = `
            INSERT INTO stock_ventas_movimientos (
                articulo_numero,
                codigo_barras,
                kilos,
                cantidad,
                tipo,
                origen_ingreso,
                usuario_id,
                fecha,
                carro_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
            RETURNING id
        `;

        const salidaResult = await client.query(insertSalidaQuery, [
            codigo_caja,                      // articulo_numero (caja)
            null,                             // codigo_barras
            kilos_caja || 0,                  // kilos
            -1,                               // cantidad (-1)
            'apertura_caja_salida',           // tipo
            codigo_unidad,                    // origen_ingreso (código de la unidad)
            usuario_id,                       // usuario_id
        ]);

        const movimientoSalidaId = salidaResult.rows[0].id;
        console.log(`✅ [ABRIR-CAJA] Salida registrada (ID: ${movimientoSalidaId})`);

        // 4. Actualizar stock_real_consolidado para UNIDAD (sumar unidades)
        const updateStockUnidadQuery = `
            INSERT INTO stock_real_consolidado (
                articulo_numero,
                stock_movimientos,
                stock_lomasoft,
                stock_ajustes,
                stock_consolidado,
                ultima_actualizacion
            ) VALUES ($1, $2, 0, 0, $2, NOW())
            ON CONFLICT (articulo_numero)
            DO UPDATE SET
                stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                ultima_actualizacion = NOW()
        `;

        await client.query(updateStockUnidadQuery, [codigo_unidad, cantidad_unidades]);
        console.log(`✅ [ABRIR-CAJA] Stock unidad actualizado (+${cantidad_unidades})`);

        // 5. Actualizar stock_real_consolidado para CAJA (restar 1)
        const updateStockCajaQuery = `
            UPDATE stock_real_consolidado
            SET 
                stock_movimientos = COALESCE(stock_movimientos, 0) - 1,
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $1
        `;

        await client.query(updateStockCajaQuery, [codigo_caja]);
        console.log(`✅ [ABRIR-CAJA] Stock caja actualizado (-1)`);

        // 6. Recalcular stock_consolidado para ambos artículos
        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        
        await recalcularStockConsolidado(client, codigo_unidad);
        console.log(`✅ [ABRIR-CAJA] Stock consolidado recalculado para unidad`);
        
        await recalcularStockConsolidado(client, codigo_caja);
        console.log(`✅ [ABRIR-CAJA] Stock consolidado recalculado para caja`);

        // Confirmar transacción
        await client.query('COMMIT');

        console.log(`🎉 [ABRIR-CAJA] ===== APERTURA COMPLETADA =====\n`);

        res.json({
            success: true,
            mensaje: 'Caja abierta exitosamente',
            movimientos: {
                entrada_id: movimientoEntradaId,
                salida_id: movimientoSalidaId
            },
            cantidad_unidades: cantidad_unidades
        });

    } catch (error) {
        // Revertir transacción en caso de error
        await client.query('ROLLBACK');
        
        console.error('❌ [ABRIR-CAJA] Error al registrar apertura:', error);
        console.error('Stack:', error.stack);

        res.status(500).json({
            error: 'Error al abrir caja',
            detalle: error.message
        });

    } finally {
        client.release();
    }
}

module.exports = {
    obtenerSugerenciasCajas,
    buscarCajas,
    registrarAperturaCaja
};
