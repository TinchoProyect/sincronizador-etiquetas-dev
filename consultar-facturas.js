const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function consultarFacturas() {
    try {
        const result = await pool.query('SELECT id, estado, doc_nro, fecha_emision FROM factura_facturas ORDER BY id DESC LIMIT 5');

        console.log('Facturas encontradas:');
        result.rows.forEach(f => {
            console.log(`ID: ${f.id}, Estado: ${f.estado}, Cliente: ${f.doc_nro}, Fecha: ${f.fecha_emision}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        pool.end();
    }
}

consultarFacturas();
