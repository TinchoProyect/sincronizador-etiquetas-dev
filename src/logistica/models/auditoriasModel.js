/**
 * Modelo de Auditorías de Rutas
 * Capa de acceso a datos para las tablas rutas_auditorias y rutas_auditorias_tramos
 */

const { pool } = require('../config/database');

class AuditoriasModel {
    
    /**
     * Obtener historial de auditorías
     * @returns {Promise<Array>} Lista de auditorías
     */
    static async obtenerTodas() {
        const query = `
            SELECT a.id, a.id_ruta, a.distancia_real_km, a.tiempo_real_minutos, 
                   a.desviacion_global_porcentaje, a.fecha_auditoria, a.usuario_auditor, a.estado,
                   r.nombre_ruta, u.nombre_completo as chofer_nombre
            FROM rutas_auditorias a
            INNER JOIN rutas r ON a.id_ruta = r.id
            LEFT JOIN usuarios u ON r.id_chofer = u.id
            ORDER BY a.fecha_auditoria DESC
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    /**
     * Obtener una auditoría con sus tramos
     * @param {number} id - ID Auditoría
     */
    static async obtenerPorId(id) {
        const queryAuditoria = `
            SELECT a.*, r.nombre_ruta, u.nombre_completo as chofer_nombre
            FROM rutas_auditorias a
            INNER JOIN rutas r ON a.id_ruta = r.id
            LEFT JOIN usuarios u ON r.id_chofer = u.id
            WHERE a.id = $1
        `;
        const resultAuditoria = await pool.query(queryAuditoria, [id]);
        
        if (resultAuditoria.rows.length === 0) return null;
        
        const auditoria = resultAuditoria.rows[0];

        const queryTramos = `
            SELECT t.*, 
                   p.id_cliente, 
                   c.nombre as cliente_nombre, 
                   p.estado as estado_presupuesto
            FROM rutas_auditorias_tramos t
            LEFT JOIN presupuestos p ON t.id_presupuesto = p.id
            LEFT JOIN clientes c ON p.id_cliente::text = c.cliente_id::text
            WHERE t.id_auditoria = $1
            ORDER BY t.hora_inicio ASC
        `;
        const resultTramos = await pool.query(queryTramos, [id]);
        
        auditoria.tramos = resultTramos.rows;
        return auditoria;
    }

    /**
     * Guardar una auditoría consolidada (Cabecera y Detalles) de forma atómica
     * @param {Object} auditoriaData - Datos procesados por el parser
     */
    static async guardar(auditoriaData) {
        const { id_ruta, distancia_real_km, tiempo_real_minutos, desviacion_global_porcentaje, usuario_auditor, estado, tramos } = auditoriaData;
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            const cabeceraQuery = `
                INSERT INTO rutas_auditorias 
                (id_ruta, distancia_real_km, tiempo_real_minutos, desviacion_global_porcentaje, usuario_auditor, estado, fecha_auditoria)
                VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'CONFIRMADA'), NOW())
                RETURNING id
            `;
            
            const cabeceraResult = await client.query(cabeceraQuery, [
                id_ruta, 
                distancia_real_km, 
                tiempo_real_minutos, 
                desviacion_global_porcentaje, 
                usuario_auditor, 
                estado
            ]);
            
            const id_auditoria = cabeceraResult.rows[0].id;

            for (const tramo of tramos) {
                const traceJson = tramo.trace_empirico ? JSON.stringify(tramo.trace_empirico) : null;
                const tramoQuery = `
                    INSERT INTO rutas_auditorias_tramos
                    (id_auditoria, id_presupuesto, tipo_tramo, tiempo_duracion_minutos, 
                     coordenada_real_lat, coordenada_real_lng, distancia_geocerca_metros, 
                     hora_inicio, hora_fin, metodo_conciliacion, trace_empirico)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                `;
                await client.query(tramoQuery, [
                    id_auditoria,
                    tramo.id_presupuesto || null,
                    tramo.tipo_tramo,
                    tramo.tiempo_duracion_minutos || 0,
                    tramo.coordenada_real_lat || null,
                    tramo.coordenada_real_lng || null,
                    tramo.distancia_geocerca_metros || null,
                    tramo.hora_inicio ? new Date(tramo.hora_inicio) : null,
                    tramo.hora_fin ? new Date(tramo.hora_fin) : null,
                    tramo.metodo_conciliacion || null,
                    traceJson
                ]);
            }

            await client.query('COMMIT');
            return { success: true, id_auditoria };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Eliminar una auditoría y sus tramos de forma atómica.
     * @param {number} id - ID de la auditoría a eliminar
     * @returns {Promise<boolean>}
     */
    static async eliminar(id) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Eliminar tramos (si no hay CASCADE)
            await client.query('DELETE FROM rutas_auditorias_tramos WHERE id_auditoria = $1', [id]);
            
            // Eliminar cabecera
            const res = await client.query('DELETE FROM rutas_auditorias WHERE id = $1 RETURNING id', [id]);
            
            await client.query('COMMIT');
            return res.rowCount > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = AuditoriasModel;
