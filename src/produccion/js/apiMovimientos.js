// apiMovimientos.js

export async function registrarMovimientoIngrediente({ ingredienteId, kilos, carroId }) {
    const payload = {
        ingrediente_id: ingredienteId,
        kilos,
        carro_id: carroId,
        tipo: 'manual',
        fecha: new Date().toISOString()
    };

    const response = await fetch('/api/ingredientes_movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al registrar movimiento de ingrediente');
    }
}

export async function registrarMovimientoStockVentas({ articulo, kilos, carroId, usuarioId }) {
    const payload = {
        articulo_numero: articulo.numero,
        codigo_barras: articulo.codigo_barras,
        kilos,
        carro_id: carroId,
        usuario_id: usuarioId,
        fecha: new Date().toISOString()
    };

    const response = await fetch('/api/stock_ventas_movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al registrar movimiento en stock ventas');
    }
}
