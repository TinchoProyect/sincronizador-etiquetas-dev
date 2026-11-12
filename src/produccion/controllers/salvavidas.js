const pool = require('../config/database');
const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');

async function registrarAjusteFantasma(req, res) {
    const { carroId, ingredienteId, kilosFaltantes, observaciones } = req.body;

    if (!carroId || !ingredienteId || !kilosFaltantes) {
        return res.status(400).json({ error: 'Faltan parámetros requeridos (carroId, ingredienteId, kilosFaltantes)' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const stockRes = await client.query('SELECT stock_actual FROM public.ingredientes WHERE id = $1', [ingredienteId]);
        const stockAnteriorActual = stockRes.rows.length > 0 ? parseFloat(stockRes.rows[0].stock_actual || 0) : 0;

        // Insertar un movimiento de "egreso" (negativo) para sincerar el stock fantasma
        // El trigger "actualizar_stock_ingrediente" se encargará de achicar la variable global stock_actual en base de datos.
        const movimientoData = {
            ingrediente_id: ingredienteId,
            kilos: -Math.abs(parseFloat(kilosFaltantes)), // Asegurarnos de que sea negativo
            tipo: 'egreso',
            carro_id: carroId,
            stock_anterior: stockAnteriorActual,
            observaciones: observaciones || `Salvavidas - Ajuste de faltante fantasma en estantería para carro #${carroId}`
        };

        // Reutilizar la función robusta existente
        await registrarMovimientoIngrediente(movimientoData, client);

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Stock fantasma extra deducido correctamente' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al registrar ajuste fantasma (Salvavidas):', error);
        return res.status(500).json({ error: 'Error del servidor al registrar el ajuste fantasma', detalle: error.message });
    } finally {
        client.release();
    }
}

module.exports = {
    registrarAjusteFantasma
};
