async function registrarMovimientoIngrediente(movimiento, db) {
  try {
    const {
      ingrediente_id,
      kilos,
      tipo,
      carro_id,
      observaciones,
      articuloNumero // ← Se admite como campo adicional
    } = movimiento;

    console.log('📥 Datos recibidos en registrarMovimientoIngrediente:');
    console.log({
      ingrediente_id,
      kilos,
      tipo,
      carro_id,
      observaciones,
      articuloNumero
    });

    // ✅ Validación de campos
    if (
      ingrediente_id == null ||
      tipo == null ||
      kilos === undefined || kilos === null || isNaN(Number(kilos))
    ) {
      console.warn('⚠️ Validación fallida: faltan campos obligatorios');
      throw new Error('Faltan datos obligatorios.');
    }

    // Verificar existencia del carro solo si se proporciona
    if (carro_id != null) {
      const carroExiste = await db.query(
        'SELECT id FROM carros_produccion WHERE id = $1',
        [carro_id]
      );

      if (carroExiste.rowCount === 0) {
        console.warn(`❌ Carro con ID ${carro_id} no existe en la tabla carros_produccion`);
        throw new Error(`El carro_id ${carro_id} no existe en la tabla carros_produccion.`);
      }
    }

    // 📝 Construcción final de observaciones
    const textoObservacion = articuloNumero
      ? articuloNumero
      : (observaciones || null);

    const query = `
      INSERT INTO ingredientes_movimientos 
        (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha)
      VALUES 
        ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;

    const values = [
      ingrediente_id,
      Number(kilos),
      tipo,
      carro_id,
      textoObservacion
    ];

    console.log('📤 Insertando movimiento con:', values);

    const result = await db.query(query, values);

    console.log('✅ Movimiento registrado correctamente:', result.rows[0]);

    return result.rows[0];

  } catch (error) {
    console.error('❌ Error al registrar movimiento en ingredientes:', error);
    throw error;
  }
}

module.exports = {
  registrarMovimientoIngrediente
};

