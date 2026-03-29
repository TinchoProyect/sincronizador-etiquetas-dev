const pool = require('./src/produccion/config/database');

async function getCols() {
    try {
        const query = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'mantenimiento_movimientos';
        `;
        const res = await pool.query(query);
        console.log("COLUMNS:", res.rows.map(r => r.column_name).join(', '));
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
getCols();
