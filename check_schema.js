const pool = require('./src/usuarios/pool');

async function checkSchema() {
    try {
        const query = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ingredientes_movimientos';
        `;
        const res = await pool.query(query);
        console.log('Columnas en ingredientes_movimientos:');
        res.rows.forEach(row => {
            console.log(`- ${row.column_name} (${row.data_type})`);
        });
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkSchema();
