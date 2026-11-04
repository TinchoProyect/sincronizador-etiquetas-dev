async function registrarMovimientoIngrediente(movimiento, db) {
  try {
    const {
      ingrediente_id,
      kilos,
      tipo,
      carro_id,
      observaciones,
      articuloNumero,
      stock_anterior // ← Nuevo campo para snapshot
    } = movimiento;

    console.log('📥 Datos recibidos en registrarMovimientoIngrediente:', movimiento);

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
    const textoObservacion = observaciones ? observaciones : (articuloNumero || null);

    const query = `
      INSERT INTO ingredientes_movimientos 
        (ingrediente_id, kilos, tipo, carro_id, observaciones, fecha, stock_anterior)
      VALUES 
        ($1, $2, $3, $4, $5, NOW(), $6)
      RETURNING *;
    `;

    const values = [
      ingrediente_id,
      Number(kilos),
      tipo,
      carro_id,
      textoObservacion,
      stock_anterior !== undefined ? Number(stock_anterior) : 0 // Guardar 0 si no viene definido
    ];

    console.log('📤 Insertando movimiento con:', values);

    const result = await db.query(query, values);

    console.log('✅ Movimiento registrado correctamente:', result.rows[0]);

    // 🔗 AUTO-APRENDIZAJE ESTRUCTURAL: Si el ingrediente no tiene artículo vinculado, aprenderlo del movimiento
    try {
      let skuCandidato = articuloNumero || movimiento.articulo_numero || null;
      if (!skuCandidato && observaciones) {
        const uuidMatch = observaciones.match(/UUID:\s*([a-f0-9\-]+)/i);
        if (uuidMatch && uuidMatch[1]) {
          const svmRes = await db.query(
            `SELECT articulo_numero FROM public.stock_ventas_movimientos 
             WHERE observaciones ILIKE '%' || $1 || '%' AND articulo_numero IS NOT NULL 
             LIMIT 1`,
            [uuidMatch[1]]
          );
          if (svmRes.rows.length > 0) {
            skuCandidato = svmRes.rows[0].articulo_numero;
          }
        }
      }

      if (skuCandidato && ingrediente_id) {
        const checkIng = await db.query(
          'SELECT articulo_vinculado_numero FROM public.ingredientes WHERE id = $1',
          [ingrediente_id]
        );
        if (checkIng.rows.length > 0 && !checkIng.rows[0].articulo_vinculado_numero) {
          const skuNorm = skuCandidato.trim().toUpperCase();
          const baCheck = await db.query(
            'SELECT articulo_id FROM public.bunker_articulos WHERE UPPER(articulo_id) = $1',
            [skuNorm]
          );
          if (baCheck.rows.length > 0) {
            const finalSku = baCheck.rows[0].articulo_id;
            await db.query(
              'UPDATE public.ingredientes SET articulo_vinculado_numero = $1 WHERE id = $2 AND articulo_vinculado_numero IS NULL',
              [finalSku, ingrediente_id]
            );
            console.log(`🔗 [AUTO-APRENDIZAJE TALLER] Ingrediente ${ingrediente_id} vinculado automáticamente a ${finalSku}`);
          }
        }
      }
    } catch (errAutoLink) {
      console.warn('⚠️ [AUTO-APRENDIZAJE] Error no bloqueante al intentar auto-vincular ingrediente:', errAutoLink.message);
    }

    return result.rows[0];

  } catch (error) {
    console.error('❌ Error al registrar movimiento en ingredientes:', error);
    throw error;
  }
}

module.exports = {
  registrarMovimientoIngrediente
};

