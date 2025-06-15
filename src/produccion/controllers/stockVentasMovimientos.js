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
      tipo // campo para identificar el origen del movimiento
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
      tipo
    });

    const query = `
      INSERT INTO stock_ventas_movimientos 
        (articulo_numero, codigo_barras, kilos, carro_id, usuario_id, fecha, cantidad, tipo)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
    `;

    console.log('🔄 Ejecutando query SQL...');
    const result = await db.query(query, [
      articulo_numero, 
      codigo_barras, 
      kilos, 
      carro_id, 
      usuario_id,
      cantidad,
      tipo || null // Si viene tipo lo usa, sino null
    ]);
    
    console.log('✅ Query ejecutada exitosamente:', result.rowCount, 'filas afectadas');

    // Si el tipo es "ingreso a producción", actualizar stock_real_consolidado
    if (tipo === 'ingreso a producción') {
      console.log('🔄 Actualizando stock_real_consolidado para ingreso a producción...');
      
      const updateQuery = `
        UPDATE stock_real_consolidado 
        SET 
          stock_consolidado = COALESCE(stock_consolidado, 0) - $1,
          ultima_actualizacion = NOW()
        WHERE articulo_numero = $2
      `;

      await db.query(updateQuery, [
        cantidad, // Usamos cantidad en lugar de kilos para actualizar el stock
        articulo_numero
      ]);
      
      console.log('✅ stock_real_consolidado actualizado correctamente');
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
