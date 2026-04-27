const { ejecutarQuery, ejecutarTransaccion } = require('../config/database');

class ReservorioModel {
    /**
     * Obtiene el último timestamp insertado
     */
    static async obtenerUltimoTimestamp() {
        const query = `SELECT MAX(timestamp_ms) as ultimo FROM logistica_satelite_puntos`;
        const result = await ejecutarQuery(query, [], 'Obtener último timestamp');
        return result.rows[0].ultimo ? parseInt(result.rows[0].ultimo) : 0;
    }

    /**
     * Inserción masiva de puntos (Bulk Insert)
     * @param {Array} puntosAInsertar Array de {lat, lng, timestamp, accuracy}
     */
    static async bulkInsertPuntos(puntosAInsertar) {
        if (!puntosAInsertar || puntosAInsertar.length === 0) return 0;

        let totalInsertados = 0;
        const batchSize = 1000;

        for (let i = 0; i < puntosAInsertar.length; i += batchSize) {
            const lote = puntosAInsertar.slice(i, i + batchSize);
            const values = [];
            const placeholders = [];

            lote.forEach((p, index) => {
                const offset = index * 7;
                placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
                values.push(
                    p.timestamp,
                    p.lat,
                    p.lng,
                    p.accuracy || p.precision || null,
                    p.ruido_sincronizacion || false,
                    p.velocidad_calculada_kmh || null,
                    p.es_parada_real || false
                );
            });

            const query = `
                INSERT INTO logistica_satelite_puntos 
                (timestamp_ms, latitud, longitud, precision_metros, ruido_sincronizacion, velocidad_calculada_kmh, es_parada_real) 
                VALUES ${placeholders.join(', ')}
                ON CONFLICT (timestamp_ms) DO NOTHING
            `;

            const result = await ejecutarQuery(query, values, `Bulk Insert Puntos (${i} a ${i + lote.length})`);
            totalInsertados += result.rowCount;
        }

        return totalInsertados;
    }

    /**
     * Inserción masiva de eventos (Bulk Insert)
     * @param {Array} eventosAInsertar Array de {inicio, fin, tipo, nombre}
     */
    static async bulkInsertEventos(eventosAInsertar) {
        if (!eventosAInsertar || eventosAInsertar.length === 0) return 0;

        let totalInsertados = 0;
        const batchSize = 1000;

        for (let i = 0; i < eventosAInsertar.length; i += batchSize) {
            const lote = eventosAInsertar.slice(i, i + batchSize);
            const values = [];
            const placeholders = [];

            lote.forEach((evt, index) => {
                const offset = index * 7;
                placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
                values.push(
                    evt.inicio,
                    evt.fin,
                    evt.tipo,
                    evt.nombre || null,
                    evt.lat || null,
                    evt.lng || null,
                    evt.raw_path || null
                );
            });

            const query = `
                INSERT INTO logistica_satelite_eventos 
                (timestamp_inicio, timestamp_fin, tipo_evento, nombre_referencia, latitud, longitud, raw_path) 
                VALUES ${placeholders.join(', ')}
            `;

            const result = await ejecutarQuery(query, values, `Bulk Insert Eventos (${i} a ${i + lote.length})`);
            totalInsertados += result.rowCount;
        }

        return totalInsertados;
    }

    /**
     * Consulta cronológica estricta de puntos para una ventana de tiempo
     */
    static async consultarTrazado(msInicio, msFin) {
        const query = `
            SELECT 
                latitud as lat, 
                longitud as lng, 
                timestamp_ms as timestamp,
                ruido_sincronizacion,
                velocidad_calculada_kmh,
                es_parada_real
            FROM logistica_satelite_puntos 
            WHERE timestamp_ms >= $1 
              AND timestamp_ms <= $2
              AND (ruido_sincronizacion IS FALSE OR ruido_sincronizacion IS NULL)
            ORDER BY timestamp_ms ASC
        `;
        const result = await ejecutarQuery(query, [msInicio, msFin], 'Consultar Trazado Puntos (Filtrado)');
        return result.rows.map(r => ({
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lng),
            timestamp: parseInt(r.timestamp),
            es_parada_real: r.es_parada_real,
            velocidad_calculada_kmh: r.velocidad_calculada_kmh ? parseFloat(r.velocidad_calculada_kmh) : null
        }));
    }

    /**
     * Consulta cronológica estricta de eventos para una ventana de tiempo
     */
    static async consultarEventos(msInicio, msFin) {
        // Obtenemos eventos que se solapen con la ventana
        const query = `
            SELECT timestamp_inicio, timestamp_fin, tipo_evento, nombre_referencia, latitud, longitud, raw_path 
            FROM logistica_satelite_eventos 
            WHERE timestamp_inicio <= $2 
              AND timestamp_fin >= $1
            ORDER BY timestamp_inicio ASC
        `;
        const result = await ejecutarQuery(query, [msInicio, msFin], 'Consultar Eventos');
        return result.rows.map(r => ({
            inicio: parseInt(r.timestamp_inicio),
            fin: parseInt(r.timestamp_fin),
            tipo: r.tipo_evento,
            nombre: r.nombre_referencia,
            lat: r.latitud ? parseFloat(r.latitud) : null,
            lng: r.longitud ? parseFloat(r.longitud) : null,
            raw_path: r.raw_path ? JSON.parse(r.raw_path) : null
        }));
    }

    /**
     * Vacía completamente las tablas del reservorio de forma quirúrgica
     */
    static async vaciarReservorio() {
        const queryEventos = `DELETE FROM logistica_satelite_eventos;`;
        const queryPuntos = `DELETE FROM logistica_satelite_puntos;`;
        
        await ejecutarQuery(queryEventos, [], 'Vaciar Eventos Reservorio');
        await ejecutarQuery(queryPuntos, [], 'Vaciar Puntos Reservorio');
        return true;
    }
}

module.exports = ReservorioModel;
