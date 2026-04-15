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
            SELECT 
                o.id, o.estado_logistico, o.estado_tratamiento, c.nombre, c.apellido, c.cliente_id,
                o.responsable_nombre, o.responsable_apellido, o.responsable_celular,
                o.chofer_nombre, o.fecha_validacion_chofer,
                (SELECT json_build_object(
                    'articulo_numero', d.articulo_numero,
                    'descripcion_externa', d.descripcion_externa,
                    'kilos', d.kilos,
                    'bultos', d.bultos,
                    'motivo', d.motivo
                ) FROM ordenes_tratamiento_detalles d WHERE d.id_orden_tratamiento = o.id LIMIT 1) as detalles,
                
                (SELECT json_build_object(
                    'operario', m.usuario,
                    'kilos_resultantes', m.cantidad,
                    'observaciones', m.observaciones,
                    'fecha', m.fecha_movimiento
                ) FROM mantenimiento_movimientos m WHERE m.id_orden_tratamiento = o.id AND m.tipo_movimiento = 'RETORNO_TRATAMIENTO' ORDER BY m.id DESC LIMIT 1) as planta,
                
                (SELECT json_build_object(
                    'receptor', e.receptor_nombre,
                    'firma_digital', e.firma_digital,
                    'fecha', e.fecha_entrega
                ) FROM entregas_eventos e WHERE e.id_orden_tratamiento = o.id ORDER BY e.id DESC LIMIT 1) as entrega,
                
                (SELECT m.estado FROM mantenimiento_movimientos m WHERE m.id_orden_tratamiento = o.id ORDER BY m.id DESC LIMIT 1) as inventario_estado
                
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

    /**
     * @param {string} hash
     * @param {Object} formData
     * @returns {Promise<Object>}
     */
    static async guardarCheckinChofer(hash, formData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const getOrden = await client.query('SELECT id FROM ordenes_tratamiento WHERE codigo_qr_hash = $1 FOR UPDATE', [hash]);
            if (getOrden.rowCount === 0) throw new Error('QR/Orden Inválido o inexistente');
            
            const orden = getOrden.rows[0];
            const { 
                articulo_numero, descripcion_externa, kilos, bultos, motivo,
                responsable_nombre, responsable_apellido, responsable_celular, chofer_nombre, fecha_evento
            } = formData;
            
            // Delete previously loaded details if any
            await client.query('DELETE FROM ordenes_tratamiento_detalles WHERE id_orden_tratamiento = $1', [orden.id]);

            // Insert new driver-validated load details
            const queryDetalle = `
                INSERT INTO ordenes_tratamiento_detalles (
                    id_orden_tratamiento, articulo_numero, descripcion_externa, kilos, bultos, motivo
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `;
            const detalleReal = await client.query(queryDetalle, [
                orden.id, 
                articulo_numero || null, 
                descripcion_externa || null, 
                kilos, 
                bultos, 
                motivo
            ]);

            // Ensure the state pushes forward but doesn't override EN_CAMINO or RETIRADO if already picked up.
            // PENDIENTE_VALIDACION means checkin is done, awaiting pickup. 
            await client.query(`
                UPDATE ordenes_tratamiento 
                SET estado_logistico = CASE 
                        WHEN estado_logistico = 'PENDIENTE_CLIENTE' THEN 'PENDIENTE_VALIDACION' 
                        ELSE estado_logistico
                    END,
                    responsable_nombre = $2,
                    responsable_apellido = $3,
                    responsable_celular = $4,
                    chofer_nombre = $5,
                    fecha_validacion_chofer = COALESCE($6::timestamp, NOW())
                WHERE id = $1
            `, [
                orden.id,
                responsable_nombre || null,
                responsable_apellido || null,
                responsable_celular || null,
                chofer_nombre || null,
                fecha_evento || null
            ]);


            await client.query('COMMIT');
            return { success: true, id_orden: orden.id, detalles: detalleReal.rows[0] };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
module.exports = TratamientosModel;
