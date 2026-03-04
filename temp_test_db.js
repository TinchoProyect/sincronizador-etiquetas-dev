const pool = require('./src/config/database');
async function test() {
    const { rows } = await pool.query('SELECT * FROM sectores_ingredientes');
    console.log(rows);
    process.exit(0);
}
test();
