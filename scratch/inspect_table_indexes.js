const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        const res = await pool.query(`
            SELECT 
                conname AS constraint_name, 
                pg_get_constraintdef(c.oid) AS constraint_definition
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE conrelid = 'public.bunker_lista_articulos'::regclass;
        `);
        console.log("--- CONSTRAINTS ---");
        console.log(res.rows);

        const resIdx = await pool.query(`
            SELECT
                schemaname, tablename, indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'bunker_lista_articulos';
        `);
        console.log("--- INDEXES ---");
        console.log(resIdx.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
