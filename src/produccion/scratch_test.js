const pool = require('./config/database');

async function test() {
    try {
        const query = `
            SELECT camp4
            FROM presupuestos_detalles
            WHERE id_presupuesto_ext = 'mnv6nrwb-ol5nz'
        `;
        const result = await pool.query(query);
        console.log("PD CAMP4:", result.rows);
    } catch (e) {
        console.error("ERROR", e);
    } finally {
        process.exit(0);
    }
}

test();
