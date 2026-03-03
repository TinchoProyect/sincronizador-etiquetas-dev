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

        // Insertar un movimiento de "egreso" (negativo) para sincerar el stock fantasma
        // El trigger "actualizar_stock_ingrediente" se encargará de achicar la variable global stock_actual en base de datos.
        const movimientoData = {
            ingrediente_id: ingredienteId,
            kilos: -Math.abs(parseFloat(kilosFaltantes)), // Asegurarnos de que sea negativo
            tipo: 'egreso',
            carro_id: carroId,
            observaciones: observaciones || `Salvavidas - Ajuste de faltante fantasma en estantería para carro #${carroId}`
            // stock_anterior es manejado internamente o el trigger de base de datos actualiza el stock independientemente
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
