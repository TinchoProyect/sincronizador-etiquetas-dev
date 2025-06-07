/**
 * Registra un movimiento manual de ingredientes en producción.
 * Espera los campos en snake_case porque así los requiere el backend.
 */
export async function registrarMovimientoIngrediente({ ingredienteId, articuloNumero, kilos, carroId }) {
  const payload = {
    ingrediente_id: ingredienteId,
    kilos,
    tipo: 'ingreso',
    carro_id: carroId,
    observaciones: articuloNumero
  };

  console.log('📤 Enviando payload a /api/produccion/ingredientes_movimientos:', payload);

  const response = await fetch('/api/produccion/ingredientes_movimientos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Error al registrar movimiento de ingrediente');
  }

  return response.json();
}

/**
 * Registra un movimiento de stock vinculado a ventas.
 */
export async function registrarMovimientoStockVentas({ articuloNumero, codigoBarras, kilos, carroId, usuarioId, cantidad }) {
  const payload = {
    articulo_numero: articuloNumero,
    codigo_barras: codigoBarras,
    kilos,
    carro_id: carroId,
    usuario_id: usuarioId,
    cantidad: cantidad || 1, // Si no viene cantidad, usar 1 como valor por defecto
    fecha: new Date().toISOString()
  };

  console.log('📤 Enviando payload a /api/produccion/stock_ventas_movimientos:', payload);

 const response = await fetch('/api/produccion/stock-ventas-movimientos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Error al registrar movimiento en stock ventas');
  }

  return response.json();
}
