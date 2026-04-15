const { pool } = require('./src/logistica/config/database');
const query = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'mantenimiento_movimientos'`;

pool.query(query).then(res => {
    console.log(res.rows);
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
