const { pool } = require('../config/database');
const crypto = require('crypto');

class TratamientosModel {
    /**
     * @param {number} id_cliente
     * @returns {Promise<Object>}
     */
    static async crearQRPreCheckIn(id_cliente) {
        // Hash de 64 caracteres único
        const hash = crypto.randomBytes(32).toString('hex');
        const query = `
            INSERT INTO ordenes_tratamiento (
                id_cliente,
                codigo_qr_hash,
                estado_logistico,
                fecha_creacion
            ) VALUES ($1, $2, 'PENDIENTE_CLIENTE', NOW())
            RETURNING id, codigo_qr_hash
        `;
        const result = await pool.query(query, [id_cliente, hash]);
        return result.rows[0];
    }

    /**
     * @param {string} hash
     * @returns {Promise<Object>}
     */
    static async obtenerInfoSesion(hash) {
        // Enlaza la orden efimera con el nombre de pila o razon social del cliente maestro.
        const query = `
            SELECT o.id, o.estado_logistico, c.nombre, c.apellido 
            FROM ordenes_tratamiento o
            LEFT JOIN clientes c ON o.id_cliente = c.cliente_id
            WHERE o.codigo_qr_hash = $1
        `;
        const result = await pool.query(query, [hash]);
        return result.rows[0];
    }

    /**
     * @param {string} hash
     * @param {Object} formData
     * @returns {Promise<Object>}
     */
    static async recibirDatosCliente(hash, formData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const getOrden = await client.query('SELECT id, estado_logistico FROM ordenes_tratamiento WHERE codigo_qr_hash = $1 FOR UPDATE', [hash]);
            if (getOrden.rowCount === 0) throw new Error('QR Inválido o inexistente');
            
            const orden = getOrden.rows[0];
            if (orden.estado_logistico !== 'PENDIENTE_CLIENTE') {
                throw new Error('Esta orden ya fue completada o está en proceso validatorio');
            }

            const { articulo_numero, descripcion_externa, kilos, bultos, motivo } = formData;
            
            // Inserción parametrizada anti-inyección (Determinismo)
            const queryDetalle = `
                INSERT INTO ordenes_tratamiento_detalles (
                    id_orden_tratamiento, articulo_numero, descripcion_externa, kilos, bultos, motivo
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `;
            await client.query(queryDetalle, [
                orden.id, 
                articulo_numero || null, 
                descripcion_externa || null, 
                kilos, 
                bultos, 
                motivo
            ]);

            // Actualiza estado de la transacción para el chofer
            await client.query(`UPDATE ordenes_tratamiento SET estado_logistico = 'PENDIENTE_VALIDACION' WHERE id = $1`, [orden.id]);

            await client.query('COMMIT');
            return { success: true, id_orden: orden.id };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
module.exports = TratamientosModel;
