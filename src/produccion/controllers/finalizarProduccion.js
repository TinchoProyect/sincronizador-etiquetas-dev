const { registrarMovimientoStockVentas } = require('./stockVentasMovimientos');

/**
 * Finaliza la producción de un carro y registra los movimientos de stock de ventas
 */
async function finalizarProduccion(req, res) {
    const db = req.db;
    const { id: carroId } = req.params;
    const { usuarioId, kilos_producidos } = req.body;

    if (!carroId || !usuarioId) {
        return res.status(400).json({ 
            error: 'Faltan datos obligatorios (carroId o usuarioId)' 
        });
    }

    // Validar kilos_producidos solo si se proporciona (será requerido para carros externos)
    if (kilos_producidos !== undefined && kilos_producidos !== null && (isNaN(kilos_producidos) || kilos_producidos <= 0)) {
        return res.status(400).json({
            error: 'Si se proporciona kilos_producidos, debe ser un valor numérico válido mayor a cero'
        });
    }

    try {
        // Iniciar transacción
        await db.query('BEGIN');

        // 1. Verificar que el carro exista, pertenezca al usuario y esté preparado
        const { rows: [carro] } = await db.query(
            'SELECT * FROM carros_produccion WHERE id = $1 AND usuario_id = $2',
            [carroId, usuarioId]
        );

        if (!carro) {
            throw new Error('Carro no encontrado o no pertenece al usuario');
        }

        // 2. Verificar que esté preparado pero no confirmado
        if (!carro.fecha_preparado) {
            throw new Error('El carro debe estar marcado como preparado antes de finalizar la producción');
        }

        if (carro.fecha_confirmacion) {
            return res.json({
                mensaje: 'La producción de este carro ya fue confirmada anteriormente',
                fecha: carro.fecha_confirmacion
            });
        }

        // 3. Obtener artículos del carro para registrar en stock de ventas
        const { rows: articulosCarro } = await db.query(`
            SELECT 
                ca.articulo_numero,
                ca.cantidad,
                a.codigo_barras,
                a.nombre as descripcion
            FROM carros_articulos ca
            LEFT JOIN articulos a ON a.numero = ca.articulo_numero
            WHERE ca.carro_id = $1
        `, [carroId]);

        if (articulosCarro.length === 0) {
            throw new Error('El carro no tiene artículos para finalizar');
        }

        console.log('\n📦 REGISTRANDO MOVIMIENTOS DE STOCK DE VENTAS');
        console.log('==========================================');

        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        const articulosAfectados = [];

        // 4. Registrar movimientos de ingreso en stock de ventas para cada artículo
        for (const articulo of articulosCarro) {
            console.log(`\n🔄 Procesando artículo ${articulo.articulo_numero}:`);
            console.log(`- Descripción: ${articulo.descripcion}`);
            console.log(`- Cantidad: ${articulo.cantidad}`);
            console.log(`- Código de barras: ${articulo.codigo_barras}`);
            
            // Insertar movimiento en stock_ventas_movimientos
            await db.query(`
                INSERT INTO stock_ventas_movimientos (
                    articulo_numero, 
                    codigo_barras, 
                    kilos,
                    cantidad,
                    carro_id, 
                    usuario_id, 
                    fecha,
                    tipo
                ) VALUES ($1, $2, 0, $3, $4, $5, NOW(), 'salida a ventas')
            `, [
                articulo.articulo_numero,
                articulo.codigo_barras || '',
                articulo.cantidad,  // La cantidad va en la columna cantidad
                carroId,
                usuarioId
            ]);
            
            // Actualizar stock_movimientos para salida a ventas
            await db.query(`
                INSERT INTO stock_real_consolidado (
                    articulo_numero, 
                    stock_movimientos,
                    stock_ajustes, 
                    ultima_actualizacion
                )
                VALUES ($1, $2, 0, NOW())
                ON CONFLICT (articulo_numero) 
                DO UPDATE SET 
                    stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                    ultima_actualizacion = NOW()
            `, [
                articulo.articulo_numero,
                articulo.cantidad // Sumar la cantidad a stock_movimientos
            ]);
            
            // Agregar artículo a la lista para recalcular
            if (!articulosAfectados.includes(articulo.articulo_numero)) {
                articulosAfectados.push(articulo.articulo_numero);
            }
            
            console.log('✅ Movimiento de stock registrado y stock_movimientos actualizado correctamente');
        }

        // 5. Registrar en produccion_externa_historial (solo para carros externos)
        if (carro.tipo_carro === 'externa') {
            // Validar que se haya proporcionado kilos_producidos para carros externos
            if (kilos_producidos === undefined || kilos_producidos === null || isNaN(kilos_producidos) || kilos_producidos <= 0) {
                throw new Error('Para carros de producción externa es obligatorio ingresar los kilos producidos');
            }
            
            console.log('\n📝 REGISTRANDO EN HISTORIAL DE PRODUCCIÓN EXTERNA');
            console.log('==========================================');
            
            // Obtener el primer artículo del carro como artículo padre
            const articuloPadre = articulosCarro[0];
            console.log(`🔍 DEBUG - Artículo padre obtenido:`, {
                codigo: articuloPadre.articulo_numero,
                descripcion: articuloPadre.descripcion,
                cantidad: articuloPadre.cantidad
            });
            
            // Buscar relación en articulos_produccion_externa_relacion
            console.log(`🔍 DEBUG - Buscando relación para artículo: ${articuloPadre.articulo_numero}`);
            const { rows: relacionRows } = await db.query(`
                SELECT articulo_kilo_codigo 
                FROM articulos_produccion_externa_relacion
                WHERE articulo_produccion_codigo = $1
                LIMIT 1
            `, [articuloPadre.articulo_numero]);
            
            console.log(`🔍 DEBUG - Resultado búsqueda relación:`, relacionRows);
            
            let articuloFraccionadoCodigo = null;
            if (relacionRows.length > 0) {
                articuloFraccionadoCodigo = relacionRows[0].articulo_kilo_codigo;
                console.log(`✅ DEBUG - Artículo fraccionado encontrado: ${articuloFraccionadoCodigo}`);
            } else {
                console.log(`ℹ️ DEBUG - No hay relación definida para este artículo`);
            }
            
            // Preparar datos para inserción (usando códigos alfanuméricos como TEXT)
            const datosHistorial = [
                carroId,                              // carro_id (integer)
                usuarioId,                            // usuario_id (integer)
                articuloPadre.articulo_numero,        // articulo_padre_id (text) - código alfanumérico
                articuloFraccionadoCodigo,            // articulo_fraccionado_id (text) - código alfanumérico o null
                kilos_producidos                      // kilos_producidos (numeric)
            ];
            
            console.log(`🔍 DEBUG - Datos para insertar en historial:`, {
                carro_id: carroId,
                usuario_id: usuarioId,
                articulo_padre_id: articuloPadre.articulo_numero,
                articulo_fraccionado_id: articuloFraccionadoCodigo,
                kilos_producidos: kilos_producidos
            });
            
            // Insertar en historial usando códigos alfanuméricos
            await db.query(`
                INSERT INTO produccion_externa_historial (
                    carro_id,
                    usuario_id,
                    articulo_padre_id,
                    articulo_fraccionado_id,
                    kilos_producidos,
                    fecha_registro
                ) VALUES ($1, $2, $3, $4, $5, NOW())
            `, datosHistorial);
            
            console.log(`✅ Registro en historial creado para carro ${carroId}`);
            console.log(`- Artículo padre (código): ${articuloPadre.articulo_numero}`);
            console.log(`- Artículo fraccionado (código): ${articuloFraccionadoCodigo || 'No definido'}`);
            console.log(`- Kilos producidos: ${kilos_producidos}`);
        }

        // Recalcular stock_consolidado para todos los artículos afectados
        if (articulosAfectados.length > 0) {
            await recalcularStockConsolidado(db, articulosAfectados);
            console.log(`Stock consolidado recalculado para ${articulosAfectados.length} artículo(s)`);
        }

        // 6. Actualizar fecha_confirmacion del carro
        await db.query(
            'UPDATE carros_produccion SET fecha_confirmacion = NOW() WHERE id = $1',
            [carroId]
        );

        console.log('\n✅ PRODUCCIÓN CONFIRMADA');
        console.log('==========================================');

        // Confirmar transacción
        await db.query('COMMIT');

        return res.json({
            mensaje: 'Producción confirmada correctamente',
            articulos: articulosCarro.length
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Error al confirmar producción:', error);
        return res.status(500).json({ 
            error: 'Error al confirmar la producción',
            detalle: error.message 
        });
    }
}

module.exports = {
    finalizarProduccion
};
