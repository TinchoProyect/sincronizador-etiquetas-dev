const pool = require('../src/produccion/config/database');
const fs = require('fs');
async function check() {
    let client = await pool.connect();
    try {
        const result = await client.query("SELECT id, tipo_movimiento, cantidad, estado, observaciones FROM mantenimiento_movimientos WHERE articulo_numero='AJPX1' ORDER BY id ASC");
        fs.writeFileSync('scripts/out-ajpx1.json', JSON.stringify(result.rows, null, 2));
        console.log("Done");
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
check();
