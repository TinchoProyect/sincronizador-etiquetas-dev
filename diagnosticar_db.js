const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function run() {
    try {
        const res = await pool.query(`
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'liberar_stock_mantenimiento';
        `);
        console.log("Escribiendo SQL a archivo...");
        if(res.rows.length > 0) {
            fs.writeFileSync('func.sql', res.rows[0].pg_get_functiondef);
            console.log("SQL escrito en func.sql");
        } else {
            console.log("Funcion no encontrada.");
        }
    } catch (e) {
        console.error("Fallo:", e.message);
    } finally {
        pool.end();
    }
}

run();
