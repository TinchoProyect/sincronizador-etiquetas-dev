const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function main() {
    try {
        console.log("Searching for 'Calle C8' in the database...");
        
        // 1. Search for customer 621
        const resCliente = await pool.query(`
            SELECT * FROM public.clientes WHERE cliente_id = 621
        `);
        console.log("Customer 621:", JSON.stringify(resCliente.rows, null, 2));

        // 2. Search for tables that might contain addresses
        const resTables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        console.log("Found tables. Searching tables for 'Calle C8' or 'C8'...");
        for (const row of resTables.rows) {
            const tableName = row.table_name;
            try {
                // Find character columns in this table
                const colRes = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('character varying', 'text', 'character')
                `, [tableName]);
                
                if (colRes.rows.length === 0) continue;
                
                const selectCols = colRes.rows.map(c => `CAST("${c.column_name}" AS TEXT)`).join(' || ');
                const searchRes = await pool.query(`
                    SELECT * FROM public."${tableName}" 
                    WHERE (${selectCols}) ILIKE '%C8%'
                `);
                
                if (searchRes.rows.length > 0) {
                    console.log(`\n🎯 Match in Table [${tableName}]:`, JSON.stringify(searchRes.rows, null, 2));
                }
            } catch (err) {
                // Ignore table search errors (e.g. empty or special tables)
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
