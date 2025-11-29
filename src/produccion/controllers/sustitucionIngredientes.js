const pool = require('../config/database');
const { registrarMovimientoIngrediente } = require('./ingredientesMovimientos');

/**
 * Controlador para gestionar la sustitución de ingredientes
 * Permite usar stock de un ingrediente para cubrir la necesidad de otro
 */

/**
 * Obtiene la lista de ingredientes con stock disponible
 * Filtra por misma unidad de medida que el ingrediente destino
 * @param {number} carroId - ID del carro activo
 * @returns {Promise<Array>} Lista de ingredientes con stock > 0
 */
async function obtenerIngredientesConStock(carroId) {
    try {
        const query = `
            SELECT 
                i.id,
                i.nombre,
                i.unidad_medida,
                COALESCE(i.stock_actual, 0) as stock_actual
            FROM ingredientes i
            WHERE COALESCE(i.stock_actual, 0) > 0
            ORDER BY i.nombre ASC
        `;

        const result = await pool.query(query);
        
        console.log(`✅ Ingredientes con stock obtenidos: ${result.rows.length}`);
        return result.rows;

    } catch (error) {
        console.error('Error al obtener ingredientes con stock:', error);
        throw new Error('No se pudieron obtener los ingredientes con stock disponible');
    }
}

/**
 * Valida que la sustitución sea posible
 * @param {number} ingredienteOrigenId - ID del ingrediente origen
 * @param {number} ingredienteDestinoId - ID del ingrediente destino
 * @param {number} cantidad - Cantidad a sustituir
 * @returns {Promise<Object>} Resultado de la validación
 */
async function validarSustitucion(ingredienteOrigenId, ingredienteDestinoId, cantidad) {
    try {
        // Obtener información de ambos ingredientes
        const query = `
            SELECT 
                id,
                nombre,
                unidad_medida,
                COALESCE(stock_actual, 0) as stock_actual
            FROM ingredientes
            WHERE id IN ($1, $2)
        `;

        const result = await pool.query(query, [ingredienteOrigenId, ingredienteDestinoId]);

        if (result.rows.length !== 2) {
            throw new Error('Uno o ambos ingredientes no existen');
        }

        const ingredienteOrigen = result.rows.find(i => i.id === ingredienteOrigenId);
        const ingredienteDestino = result.rows.find(i => i.id === ingredienteDestinoId);

        // Validación 1: Misma unidad de medida
        if (ingredienteOrigen.unidad_medida !== ingredienteDestino.unidad_medida) {
            throw new Error(
                `Los ingredientes deben tener la misma unidad de medida. ` +
                `Origen: ${ingredienteOrigen.unidad_medida}, Destino: ${ingredienteDestino.unidad_medida}`
            );
        }

        // Validación 2: Stock suficiente en origen
        if (ingredienteOrigen.stock_actual < cantidad) {
            throw new Error(
                `Stock insuficiente en "${ingredienteOrigen.nombre}". ` +
                `Disponible: ${ingredienteOrigen.stock_actual.toFixed(2)} ${ingredienteOrigen.unidad_medida}, ` +
                `Solicitado: ${cantidad.toFixed(2)} ${ingredienteOrigen.unidad_medida}`
            );
        }

        // Validación 3: Cantidad válida
        if (cantidad <= 0) {
            throw new Error('La cantidad debe ser mayor a 0');
        }

        return {
            valido: true,
            ingredienteOrigen,
            ingredienteDestino
        };

    } catch (error) {
        console.error('Error en validación de sustitución:', error);
        throw error;
    }
}

/**
 * Realiza la sustitución de ingredientes
 * Registra dos movimientos: egreso del origen e ingreso al destino
 * @param {Object} datos - Datos de la sustitución
 * @returns {Promise<Object>} Resultado de la operación
 */
async function sustituirIngrediente(datos) {
    const client = await pool.connect();
    
    try {
        const {
            ingredienteOrigenId,
            ingredienteDestinoId,
            cantidad,
            carroId,
            usuarioId
        } = datos;

        console.log('\n🔄 INICIANDO SUSTITUCIÓN DE INGREDIENTES');
        console.log('==========================================');
        console.log('Datos recibidos:', {
            ingredienteOrigenId,
            ingredienteDestinoId,
            cantidad,
            carroId,
            usuarioId
        });

        // Validar datos de entrada
        if (!ingredienteOrigenId || !ingredienteDestinoId || !cantidad || !carroId || !usuarioId) {
            throw new Error('Faltan datos obligatorios para la sustitución');
        }

        // Iniciar transacción
        await client.query('BEGIN');

        // Validar que la sustitución sea posible
        const validacion = await validarSustitucion(ingredienteOrigenId, ingredienteDestinoId, cantidad);
        
        if (!validacion.valido) {
            throw new Error('La sustitución no es válida');
        }

        const { ingredienteOrigen, ingredienteDestino } = validacion;

        console.log('\n✅ VALIDACIÓN EXITOSA');
        console.log(`- Origen: ${ingredienteOrigen.nombre} (Stock: ${ingredienteOrigen.stock_actual} ${ingredienteOrigen.unidad_medida})`);
        console.log(`- Destino: ${ingredienteDestino.nombre}`);
        console.log(`- Cantidad a sustituir: ${cantidad} ${ingredienteOrigen.unidad_medida}`);

        // Movimiento 1: EGRESO del ingrediente origen
        const movimientoEgreso = {
            ingrediente_id: ingredienteOrigenId,
            kilos: -cantidad, // Negativo para egreso
            tipo: 'egreso',
            carro_id: carroId,
            observaciones: `SUSTITUCIÓN: Asignación manual para cubrir "${ingredienteDestino.nombre}" (ID: ${ingredienteDestinoId})`
        };

        console.log('\n📤 REGISTRANDO MOVIMIENTO DE EGRESO:');
        console.log(JSON.stringify(movimientoEgreso, null, 2));

        const resultadoEgreso = await registrarMovimientoIngrediente(movimientoEgreso, client);
        console.log('✅ Movimiento de egreso registrado:', resultadoEgreso.id);

        // Movimiento 2: INGRESO al ingrediente destino
        const movimientoIngreso = {
            ingrediente_id: ingredienteDestinoId,
            kilos: cantidad, // Positivo para ingreso
            tipo: 'ingreso',
            carro_id: carroId,
            observaciones: `SUSTITUCIÓN: Asignación manual desde "${ingredienteOrigen.nombre}" (ID: ${ingredienteOrigenId})`
        };

        console.log('\n📥 REGISTRANDO MOVIMIENTO DE INGRESO:');
        console.log(JSON.stringify(movimientoIngreso, null, 2));

        const resultadoIngreso = await registrarMovimientoIngrediente(movimientoIngreso, client);
        console.log('✅ Movimiento de ingreso registrado:', resultadoIngreso.id);

        // Confirmar transacción
        await client.query('COMMIT');

        console.log('\n✅ SUSTITUCIÓN COMPLETADA EXITOSAMENTE');
        console.log('==========================================\n');

        return {
            success: true,
            mensaje: `Se asignaron ${cantidad.toFixed(2)} ${ingredienteOrigen.unidad_medida} de "${ingredienteOrigen.nombre}" para cubrir "${ingredienteDestino.nombre}"`,
            movimientos: {
                egreso: resultadoEgreso.id,
                ingreso: resultadoIngreso.id
            }
        };

    } catch (error) {
        // Revertir transacción en caso de error
        await client.query('ROLLBACK');
        console.error('\n❌ ERROR EN SUSTITUCIÓN - TRANSACCIÓN REVERTIDA');
        console.error('Error:', error.message);
        console.error('==========================================\n');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    obtenerIngredientesConStock,
    sustituirIngrediente,
    validarSustitucion
};
