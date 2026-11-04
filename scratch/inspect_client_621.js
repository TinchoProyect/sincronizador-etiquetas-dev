const pool = require('../src/usuarios/pool');
async function run() {
  const r = await pool.query("SELECT id, codigo_bunker_cliente, cliente_nombre, lomas_soft_id, email_portal FROM public.bunker_clientes WHERE lomas_soft_id = '621'");
  console.log('CLIENTE 621:', r.rows);
  await pool.end();
}
run();
