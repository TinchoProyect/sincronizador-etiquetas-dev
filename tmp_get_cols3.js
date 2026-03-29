const pool = require('./src/produccion/config/database');
const fs = require('fs');

async function getCols() {
    try {
        const query = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'mantenimiento_movimientos';
        `;
        const res = await pool.query(query);
        const cols = res.rows.map(r => r.column_name).join(', ');
        fs.writeFileSync('tmp_cols.txt', cols);
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
getCols();
