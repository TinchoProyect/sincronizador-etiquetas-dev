const db = require('./src/produccion/config/database');

async function checkSchema() {
    try {
        const query = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ingredientes_movimientos'
        `;
        const result = await db.query(query);
        console.log('Columns in ingredientes_movimientos:');
        result.rows.forEach(row => {
            console.log(`${row.column_name} (${row.data_type})`);
        });
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkSchema();
