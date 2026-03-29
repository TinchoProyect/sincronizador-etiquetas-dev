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

async function runPatch() {
    try {
        const query = `
            UPDATE public.mantenimiento_movimientos mm
            SET cantidad = mm.cantidad / NULLIF(COALESCE((SELECT kilos_unidad FROM public.stock_real_consolidado WHERE articulo_numero = mm.articulo_numero), 1), 0)
            WHERE mm.tipo_movimiento = 'ENVIO_TRATAMIENTO'
              AND mm.articulo_numero IS NOT NULL
              AND mm.cantidad > (mm.cantidad / NULLIF(COALESCE((SELECT kilos_unidad FROM public.stock_real_consolidado WHERE articulo_numero = mm.articulo_numero), 1), 0))
            RETURNING id, articulo_numero, cantidad;
        `;
        const res = await pool.query(query);
        console.log("✅ Data Patch Aplicado. Registros historicos alterados: " + res.rowCount);
        if(res.rowCount > 0) console.table(res.rows);
    } catch(e) {
        console.error('Error SQL:', e.message);
    } finally {
        pool.end();
    }
}
runPatch();
