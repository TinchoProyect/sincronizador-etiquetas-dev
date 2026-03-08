const fs = require('fs');
const pool = require('./src/produccion/config/database');

async function audit() {
    try {
        const resFunc = await pool.query(`
      SELECT pg_get_functiondef(oid) 
      FROM pg_proc 
      WHERE proname = 'liberar_stock_mantenimiento'
    `);

        const resTriggersVentas = await pool.query(`
      SELECT event_object_table, trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_table IN ('stock_real_consolidado', 'articulos')
    `);

        const resTriggersIngredientes = await pool.query(`
      SELECT event_object_table, trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'ingredientes'
    `);

        fs.writeFileSync('temp_out_audit.json', JSON.stringify({
            funcion: resFunc.rows[0]?.pg_get_functiondef,
            triggersVentas: resTriggersVentas.rows,
            triggersIngredientes: resTriggersIngredientes.rows
        }, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
audit();
