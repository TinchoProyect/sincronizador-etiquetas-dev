require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function scanTables() {
  try {
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema='public' AND table_type='BASE TABLE'
    `);
    const tables = tableRes.rows.map(r => r.table_name);
    
    for (const t of tables) {
      const colRes = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='${t}'
      `);
      const cols = colRes.rows.map(r => r.column_name);

      let whereConds = [];
      if (cols.includes('cliente_id')) whereConds.push('cliente_id IN (621, 387)');
      if (cols.includes('id_cliente')) whereConds.push('id_cliente IN (621, 387)');
      if (cols.includes('articulo_numero')) whereConds.push("articulo_numero ILIKE '%Avellana%'");
      if (cols.includes('articulo')) whereConds.push("articulo ILIKE '%Avellana%'");
      if (cols.includes('descripcion')) whereConds.push("descripcion ILIKE '%Avellana%'");
      if (cols.includes('estado')) whereConds.push("(estado ILIKE '%PENDIENTE%' OR estado ILIKE '%ESPERANDO%')");

      if (whereConds.length > 0) {
        // Only run query if there's a good filtering combo to avoid massive dumps
        // But let's be sure it's 621 or 387 AND Avellana
        if (cols.some(c => c.includes('cliente'))) {
            try {
                const queryStr = `SELECT * FROM ${t} WHERE (${whereConds.filter(c => c.includes('cliente')).join(' OR ')})`;
                const data = await pool.query(queryStr);
                const suspects = data.rows.filter(r => JSON.stringify(r).toLowerCase().includes('avellana') || JSON.stringify(r).toLowerCase().includes('esperando') || JSON.stringify(r).toLowerCase().includes('pendiente'));
                if (suspects.length > 0) {
                  console.log(`\n=== TABLA: ${t} ===`);
                  console.table(suspects);
                }
            } catch(e){}
        }
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    pool.end();
  }
}

scanTables();
