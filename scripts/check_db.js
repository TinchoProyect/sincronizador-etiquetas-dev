const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function runQuery() {
    try {
        console.log('Connecting to database...');
        
        // 2026-04-23 14:48:00 to 2026-04-23 15:32:00 Argentina time
        // Which is UTC 17:48 to 18:32
        const start = new Date('2026-04-23T00:00:00-03:00').getTime();
        const end = new Date('2026-04-23T23:59:59-03:00').getTime();
        
        const res = await pool.query(`
            SELECT COUNT(*) FROM logistica_satelite_puntos
            WHERE timestamp_ms >= $1 AND timestamp_ms <= $2
        `, [start, end]);
        
        console.log(`Puntos el 2026-04-23: ${res.rows[0].count}`);

        const sample = await pool.query(`
            SELECT timestamp_ms, latitud, longitud 
            FROM logistica_satelite_puntos
            WHERE timestamp_ms >= $1 AND timestamp_ms <= $2
            ORDER BY timestamp_ms ASC
        `, [start, end]);
        
        // Group points by hour
        const countsByHour = {};
        sample.rows.forEach(r => {
            const date = new Date(parseInt(r.timestamp_ms));
            const hour = date.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
            countsByHour[hour] = (countsByHour[hour] || 0) + 1;
        });
        console.log('Densidad por hora (Argentina Time):', countsByHour);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

runQuery();
