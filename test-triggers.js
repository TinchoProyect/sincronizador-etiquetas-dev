const { Client } = require('pg');
const fs = require('fs');
const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas_pruebas',
  password: 'ta3Mionga',
  port: 5432,
});

async function main() {
  try {
    await client.connect();
    
    // First, find the trigger name for relevant tables
    const trigRes = await client.query(`
      SELECT event_object_table, trigger_name, action_statement 
      FROM information_schema.triggers 
      WHERE event_object_table IN ('ingredientes_movimientos', 'historial_inventarios', 'stock_real_consolidado')
    `);
    
    // Then get the function definition
    const funcRes = await client.query(`
      SELECT routine_definition 
      FROM information_schema.routines 
      WHERE routine_name = 'actualizar_stock_ingrediente'
         OR routine_name = 'actualizar_stock_ingrediente_func'
         OR routine_name IN (
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_definition ILIKE '%ingredientes%' 
              AND routine_definition ILIKE '%stock_actual%'
         )
    `);

    const result = {
      triggers: trigRes.rows,
      functions: funcRes.rows
    };
    
    fs.writeFileSync('./trigger_audit.json', JSON.stringify(result, null, 2));
    console.log('Trigger audit written to trigger_audit.json');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
