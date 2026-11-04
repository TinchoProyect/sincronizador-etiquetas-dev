require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

async function run() {
    try {
        console.log('--- BUSCANDO LOG EXITOSO DE FACTURA 113 ---');
        const res = await pool.query(`
            SELECT id, metodo, request_xml, response_xml, observaciones, resultado, creado_en 
            FROM factura_afip_wsfe_logs 
            WHERE factura_id = '113' AND resultado = 'A'
            ORDER BY creado_en DESC
            LIMIT 1
        `);
        
        if (res.rows.length === 0) {
            console.log('No se encontró el log exitoso para la factura 113.');
        } else {
            const row = res.rows[0];
            console.log('Metodo:', row.metodo);
            console.log('Fecha:', row.creado_en);
            console.log('Request XML:', row.request_xml);
            console.log('Response XML:', row.response_xml);
        }
    } catch(e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}
run();
