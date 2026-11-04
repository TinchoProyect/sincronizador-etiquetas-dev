const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: process.env.DB_PORT || 5432
});

async function checkLastOrder() {
  try {
    const rHead = await pool.query(`
      SELECT *
      FROM public.presupuestos
      ORDER BY id DESC
      LIMIT 3;
    `);
    console.log('📋 ÚLTIMOS 3 ENCABEZADOS EN PRESUPUESTOS:');
    console.log(JSON.stringify(rHead.rows, null, 2));

    if (rHead.rows.length > 0) {
      const lastId = rHead.rows[0].id;
      const extId = rHead.rows[0].id_presupuesto_ext;
      const rDet = await pool.query(`
        SELECT *
        FROM public.presupuestos_detalles
        WHERE id_presupuesto = $1 OR id_presupuesto_ext = $2;
      `, [lastId, extId]);

      console.log(`\n📦 DETALLES PARA PRESUPUESTO #${lastId} (ext: ${extId}):`);
      console.log(JSON.stringify(rDet.rows, null, 2));
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
  process.exit(0);
}

checkLastOrder();
