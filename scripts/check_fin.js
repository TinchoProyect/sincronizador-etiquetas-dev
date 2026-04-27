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
        // Franja horaria: 23/04/2026 después de las 15:32 ART
        const start = new Date('2026-04-23T15:32:00-03:00').getTime();
        const end = new Date('2026-04-23T23:59:59-03:00').getTime();

        const res = await pool.query(`
            SELECT timestamp_ms, latitud, longitud 
            FROM logistica_satelite_puntos 
            WHERE timestamp_ms >= $1 AND timestamp_ms <= $2
            ORDER BY timestamp_ms ASC
        `, [start, end]);

        console.log(`\n======================================================`);
        console.log(`🔍 RESULTADO DE AUDITORÍA FORENSE - NODO FIN`);
        console.log(`======================================================`);
        console.log(`Puntos encontrados entre las 15:32 y las 23:59: ${res.rows.length}`);
        
        if (res.rows.length > 0) {
            console.log(`\nMuestra de los primeros 5 puntos encontrados:`);
            res.rows.slice(0, 5).forEach(r => {
                const ms = parseInt(r.timestamp_ms);
                // Usando hour12: false para evitar el error AM/PM en formato 12 horas es-AR
                const timeStr = new Date(ms).toLocaleTimeString('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    hour12: false
                });
                console.log(`- [${timeStr}] Lat: ${r.latitud}, Lng: ${r.longitud}`);
            });
            
            console.log(`\nMuestra de los últimos 5 puntos (llegada a la noche):`);
            res.rows.slice(-5).forEach(r => {
                const ms = parseInt(r.timestamp_ms);
                const timeStr = new Date(ms).toLocaleTimeString('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    hour12: false
                });
                console.log(`- [${timeStr}] Lat: ${r.latitud}, Lng: ${r.longitud}`);
            });
        }
        
        console.log(`======================================================\n`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
