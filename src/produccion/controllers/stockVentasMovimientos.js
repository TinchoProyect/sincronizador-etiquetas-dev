// src/controllers/stockVentasMovimientos.js

async function registrarMovimientoStockVentas(req, res) {
  console.log('📥 Solicitud POST /stock-ventas-movimientos recibida');
  console.log('🔍 Datos recibidos:', req.body);
  
  // Verificar que la conexión a la base de datos esté disponible
  const db = req.db;
  if (!db) {
    console.error('❌ Conexión a base de datos no disponible (req.db es undefined)');
    return res.status(500).json({ error: 'Conexión a base de datos no disponible' });
  }

  console.log('✅ Conexión a base de datos disponible');

  try {
    // Iniciar transacción
    await db.query('BEGIN');

    const {
      articulo_numero,
      codigo_barras,
      kilos,
      carro_id,
      usuario_id, // puede venir null si no hay usuario activo
      cantidad = 1, // valor por defecto si no viene especificado
      tipo, // campo para identificar el origen del movimiento
      origen_ingreso = 'simple', // fallback a 'simple' si no se especifica
      observaciones = ''
    } = req.body;

    console.log('🔍 Validando datos obligatorios...');
    if (!articulo_numero || !codigo_barras || !kilos || !carro_id) {
      console.warn('⚠️ Validación fallida: faltan datos obligatorios');
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    if (cantidad < 1) {
      console.warn('⚠️ Validación fallida: cantidad debe ser al menos 1');
      return res.status(400).json({ error: 'La cantidad debe ser al menos 1' });
    }

    console.log('✅ Datos validados correctamente');
    console.log('📦 Preparando inserción con valores:', {
      articulo_numero,
      codigo_barras,
      kilos,
      carro_id,
      usuario_id,
      cantidad,
      tipo,
      origen_ingreso,
      observaciones
    });

    console.log('🏷️ ORIGEN_INGRESO recibido en backend:', origen_ingreso);

    const query = `
      INSERT INTO stock_ventas_movimientos 
        (articulo_numero, codigo_barras, kilos, carro_id, usuario_id, fecha, cantidad, tipo, origen_ingreso, observaciones)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
    `;

    console.log('🔄 Ejecutando query SQL...');
    const result = await db.query(query, [
      articulo_numero, 
      codigo_barras, 
      kilos, 
      carro_id, 
      usuario_id,
      cantidad,
      tipo || null, // Si viene tipo lo usa, sino null
      origen_ingreso, // Incluir origen_ingreso en la inserción
      observaciones
    ]);
    
    console.log('✅ Query ejecutada exitosamente:', result.rowCount, 'filas afectadas');
    console.log('✅ ORIGEN_INGRESO guardado en BD:', origen_ingreso);

    const { recalcularStockConsolidado } = require('../utils/recalcularStock');

    // Actualizar stock_movimientos según el tipo de movimiento
    if (tipo === 'ingreso a producción') {
      console.log('🔄 Actualizando stock_movimientos para ingreso a producción...');
      
      const updateQuery = `
        UPDATE stock_real_consolidado 
        SET 
          stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
          ultima_actualizacion = NOW()
        WHERE articulo_numero = $2
      `;

      await db.query(updateQuery, [
        cantidad,
        articulo_numero
      ]);
      
      // Recalcular stock_consolidado
      await recalcularStockConsolidado(db, articulo_numero);
      
      console.log('✅ stock_movimientos actualizado y stock_consolidado recalculado para ingreso a producción');
    } else if (tipo === 'salida a ventas') {
      console.log('🔄 Actualizando stock_movimientos para salida a ventas...');
      
      // Para salida a ventas, SUMAR la cantidad a stock_movimientos
      const updateQuery = `
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
      `;

      await db.query(updateQuery, [
        articulo_numero,
        cantidad
      ]);
      
      // Recalcular stock_consolidado
      await recalcularStockConsolidado(db, articulo_numero);
      
      console.log('✅ stock_movimientos actualizado y stock_consolidado recalculado para salida a ventas');
    } else if (tipo === 'egreso por receta externa') {
      console.log('🔄 Actualizando stock_movimientos para egreso por receta externa...');
      
      // Para egreso por receta externa, RESTAR la cantidad de stock_movimientos
      const updateQuery = `
        UPDATE stock_real_consolidado 
        SET 
          stock_movimientos = COALESCE(stock_movimientos, 0) - $1,
          ultima_actualizacion = NOW()
        WHERE articulo_numero = $2
      `;

      await db.query(updateQuery, [
        Math.abs(cantidad), // Usar valor absoluto porque cantidad puede venir negativa
        articulo_numero
      ]);
      
      // Recalcular stock_consolidado
      await recalcularStockConsolidado(db, articulo_numero);
      
      console.log('✅ stock_movimientos actualizado y stock_consolidado recalculado para egreso por receta externa');
    }

    // Confirmar transacción
    await db.query('COMMIT');
    
    return res.status(200).json({ mensaje: 'Movimiento de stock de ventas registrado' });
    
  } catch (error) {
    // Rollback en caso de error
    await db.query('ROLLBACK');
    console.error('❌ Error detallado al registrar movimiento en stock_ventas_movimientos:');
    console.error('   - Mensaje:', error.message);
    console.error('   - Código:', error.code);
    console.error('   - Detalle:', error.detail);
    console.error('   - Stack:', error.stack);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

module.exports = {
  registrarMovimientoStockVentas
};
