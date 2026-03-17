const { Client } = require('pg');

async function main() {
    const client = new Client({
        user: 'postgres',
        host: 'localhost',
        database: 'etiquetas',
        password: 'ta3Mionga',
        port: 5432
    });

    try {
        await client.connect();
        
        // Find all text/varchar columns in public tables
        const query = `
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND data_type IN ('text', 'character varying');
        `;
        const res = await client.query(query);
        
        for (const row of res.rows) {
            const searchQ = `SELECT count(*) as count FROM ${row.table_name} WHERE ${row.column_name} LIKE '%ngrok%' OR ${row.column_name} LIKE '%127.0.0.1%' OR ${row.column_name} LIKE '%localhost%';`;
            try {
                const searchRes = await client.query(searchQ);
                if (parseInt(searchRes.rows[0].count) > 0) {
                    console.log(`[!] Found in ${row.table_name}.${row.column_name}: ${searchRes.rows[0].count} rows`);
                    
                    const detailsQ = `SELECT ${row.column_name} FROM ${row.table_name} WHERE ${row.column_name} LIKE '%ngrok%' OR ${row.column_name} LIKE '%localhost%' LIMIT 3;`;
                    const detailsRes = await client.query(detailsQ);
                    console.log('   ->', detailsRes.rows.map(r => r[row.column_name]));
                }
            } catch(e) {
                // Ignore if query fails (e.g. view)
            }
        }
        
    } catch(e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
main();
