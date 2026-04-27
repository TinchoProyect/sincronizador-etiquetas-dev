const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'root',
    port: process.env.DB_PORT || 5432,
});

async function run() {
    try {
        const start = new Date('2026-04-23T08:00:00-03:00').getTime();
        const end = new Date('2026-04-23T16:00:00-03:00').getTime();

        const res = await pool.query(`
            SELECT timestamp_ms, latitud, longitud 
            FROM logistica_satelite_puntos 
            WHERE timestamp_ms >= $1 AND timestamp_ms <= $2
            ORDER BY timestamp_ms ASC
        `, [start, end]);

        res.rows.forEach(r => {
            const ms = parseInt(r.timestamp_ms);
            const timeStr = new Date(ms).toLocaleTimeString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                hour12: false
            });
            console.log(`[${timeStr}] Lat: ${r.latitud}, Lng: ${r.longitud}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
