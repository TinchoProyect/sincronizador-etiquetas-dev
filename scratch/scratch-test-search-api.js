const fetch = require('node-fetch');

async function test() {
    try {
        console.log('Sending request to local API...');
        const response = await fetch('http://localhost:3002/api/produccion/buscar-articulos?q=avena');
        if (response.ok) {
            const data = await response.json();
            console.log('API is active and responded successfully!');
            console.log('Sample search results:');
            console.log(JSON.stringify(data.articulos.slice(0, 3), null, 2));
        } else {
            console.log('API responded with error status:', response.status);
        }
    } catch (e) {
        console.log('Local API server is not running or unreachable. Testing controller query directly...');
        const { Pool } = require('pg');
        require('dotenv').config();

        const pool = new Pool({
            user: process.env.DB_USER || 'postgres',
            host: process.env.DB_HOST || 'localhost',
            database: process.env.DB_NAME || 'etiquetas',
            password: process.env.DB_PASSWORD || 'ta3Mionga',
            port: parseInt(process.env.DB_PORT || '5432'),
        });

        try {
            const term = 'avena';
            const query = `
                SELECT 
                    src.articulo_numero as codigo,
                    src.descripcion,
                    src.codigo_barras,
                    src.stock_consolidado,
                    src.es_pack,
                    src.pack_hijo_codigo,
                    src.pack_unidades,
                    src.kilos_unidad
                FROM stock_real_consolidado src
                WHERE (src.descripcion ILIKE $1 OR src.articulo_numero ILIKE $1)
                ORDER BY src.descripcion
                LIMIT 3
            `;
            const res = await pool.query(query, [`%${term}%`]);
            console.log('Database query executed successfully! Results:');
            console.log(JSON.stringify(res.rows, null, 2));
        } catch (dbErr) {
            console.error('Error executing DB query directly:', dbErr);
        } finally {
            await pool.end();
        }
    }
}

test();
