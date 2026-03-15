const pool = require('./src/produccion/config/database');

pool.query("SELECT DISTINCT observaciones, usuario FROM public.mantenimiento_movimientos WHERE tipo_movimiento = 'INGRESO'").then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    pool.end();
}).catch(e => {
    console.error(e);
    pool.end();
});
