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
    const {
      articulo_numero,
      codigo_barras,
      kilos,
      carro_id,
      usuario_id // puede venir null si no hay usuario activo
    } = req.body;

    console.log('🔍 Validando datos obligatorios...');
    if (!articulo_numero || !codigo_barras || !kilos || !carro_id) {
      console.warn('⚠️ Validación fallida: faltan datos obligatorios');
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    console.log('✅ Datos validados correctamente');
    console.log('📦 Preparando inserción con valores:', {
      articulo_numero,
      codigo_barras,
      kilos,
      carro_id,
      usuario_id
    });

    const query = `
      INSERT INTO stock_ventas_movimientos 
        (articulo_numero, codigo_barras, kilos, carro_id, usuario_id, fecha)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `;

    console.log('🔄 Ejecutando query SQL...');
    const result = await db.query(query, [articulo_numero, codigo_barras, kilos, carro_id, usuario_id]);
    
    console.log('✅ Query ejecutada exitosamente:', result.rowCount, 'filas afectadas');
    return res.status(200).json({ mensaje: 'Movimiento de stock de ventas registrado' });
    
  } catch (error) {
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
