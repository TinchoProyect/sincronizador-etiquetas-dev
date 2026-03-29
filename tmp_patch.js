const { Pool } = require('pg');
const fs = require('fs');

const envLocal = fs.readFileSync('.env', 'utf8').split('\n');
const envVars = {};
envLocal.forEach(l => {
  const line = l.trim();
  if (line && !line.startsWith('#') && line.includes('=')) {
    const [key, ...vals] = line.split('=');
    envVars[key.trim()] = vals.join('=').trim();
  }
});

const pool = new Pool({
  user: envVars.DB_USER || 'postgres',
  host: envVars.DB_HOST || 'localhost',
  database: envVars.DB_NAME || 'lamda',
  password: envVars.DB_PASSWORD,
  port: envVars.DB_PORT || 5432,
});

async function patch() {
  try {
    const allPending = await pool.query(`
      SELECT 
        table_name 
      FROM information_schema.tables 
      WHERE table_schema='public' AND table_type='BASE TABLE'
    `);
    
    // Check main DBs:
    const checks = ['mantenimiento_movimientos', 'presupuestos_items', 'retiros_programados', 'logistica_retiros', 'devoluciones', 'seguimiento_rutas', 'mantenimiento_recepciones', 'ingredientes', 'presupuestos'];

    let resultsFound = 0;
    
    for (const table of allPending.rows) {
        const t = table.table_name;
        if (!checks.includes(t) && !t.includes('logis') && !t.includes('manten') && !t.includes('retiro') && !t.includes('devol')) continue;

        try {
            const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t}'`);
            const colNames = cols.rows.map(r=>r.column_name);
            
            let w = [];
            if(colNames.includes('cliente_id')) w.push("cliente_id IN (621, 387)");
            if(colNames.includes('id_cliente')) w.push("id_cliente IN (621, 387)");
            if(colNames.includes('cliente')) w.push("cliente IN ('621', '387')");
            if(colNames.includes('id_cliente_origen')) w.push("id_cliente_origen IN (621, 387)");
            if(colNames.includes('origen_externo_id')) w.push("origen_externo_id IN ('621', '387')");
            if(colNames.includes('identificador_externo')) w.push("identificador_externo IN ('621', '387')");
            
            if(w.length > 0) {
               const q = `SELECT * FROM ${t} WHERE ${w.join(' OR ')}`;
               const res = await pool.query(q);
               if(res.rowCount > 0) {
                  const sospechosos = res.rows.filter(r => JSON.stringify(r).toLowerCase().includes('avellana') || JSON.stringify(r).toLowerCase().includes('pendiente') || JSON.stringify(r).toLowerCase().includes('esperando'));
                  if (sospechosos.length > 0) {
                      console.log(`============= TABLA: ${t} =============`);
                      console.table(sospechosos);
                      resultsFound++;
                  }
               }
            }
        } catch(e) {}
    }
  } catch (error) {
    console.error('Error parcheando BD:', error.message);
  } finally {
    pool.end();
  }
}
patch();
