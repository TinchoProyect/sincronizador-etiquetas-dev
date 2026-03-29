require('dotenv').config();
const { Pool } = require('pg');
const envLocal = require('fs').readFileSync('.env', 'utf8').split('\n');
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

async function run() {
    try {
        const query = `
            UPDATE public.presupuestos
            SET estado_logistico = 'ANULADO',
                estado = 'Anulado'
            WHERE id_cliente::text IN ('621', '387')
              AND (tipo_comprobante = 'Orden de Retiro' OR estado = 'Orden de Retiro')
              AND (estado_logistico = 'PENDIENTE_ASIGNAR' OR id_ruta IS NOT NULL)
            RETURNING id, id_cliente;
        `;
        const res = await pool.query(query);
        console.log(`✅ Registros Anulados (Esperando Reparto): ${res.rowCount}`);
        if(res.rowCount>0) console.table(res.rows);

        // Ya que estamos, matamos de mantenimiento si hubiera:
        const q2 = `
            UPDATE mantenimiento_movimientos 
            SET estado = 'FINALIZADO' 
            WHERE cliente_id IN (621, 387) AND estado LIKE '%PENDIENTE%' AND articulo_numero ILIKE '%avellana%'
            RETURNING id;
        `;
        const r2 = await pool.query(q2).catch(()=>({rowCount:0}));
        console.log(`✅ Registros Anulados (Movimientos Backup): ${r2.rowCount}`);
    } catch(e) {
        console.error('❌ Error:', e.message);
    } finally {
        pool.end();
    }
}
run();
