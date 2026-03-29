const pool = require('./src/produccion/config/database');

async function getColumns() {
    try {
        const query = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'mantenimiento_movimientos';
        `;
        const res = await pool.query(query);
        console.log(JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

getColumns();
