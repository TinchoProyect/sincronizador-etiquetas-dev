const pool = require('./src/usuarios/pool');
const fs = require('fs');

async function check() {
    try {
        const res = await pool.query("SELECT * FROM sectores_ingredientes");
        fs.writeFileSync('temp_sectors_output.json', JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
