require('dotenv').config();
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

async function run() {
    try {
        const query = `
            SELECT id, articulo_numero, cantidad, tipo_movimiento, estado
            FROM public.mantenimiento_movimientos 
            WHERE articulo_numero IS NOT NULL
            ORDER BY id DESC LIMIT 20;
        `;
        const res = await pool.query(query);
        fs.writeFileSync('diag_almendra.json', JSON.stringify(res.rows, null, 2));

        const sumQ = `
            SELECT articulo_numero, 
                   SUM(CASE WHEN tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES', 'RETORNO_TRATAMIENTO') THEN cantidad ELSE 0 END) AS creditos,
                   SUM(CASE WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE', 'ENVIO_TRATAMIENTO') THEN cantidad ELSE 0 END) AS debitos,
                   SUM(CASE 
                        WHEN tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES', 'RETORNO_TRATAMIENTO') THEN cantidad 
                        WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE', 'ENVIO_TRATAMIENTO') THEN -cantidad
                        ELSE 0 
                    END) AS algebra
            FROM public.mantenimiento_movimientos
            WHERE articulo_numero IS NOT NULL
              AND estado IS DISTINCT FROM 'REVERTIDO' 
              AND estado IS DISTINCT FROM 'FINALIZADO'
              AND estado IS DISTINCT FROM 'ANULADO'
              AND estado IS DISTINCT FROM 'FINALIZADO_TRATAMIENTO'
            GROUP BY articulo_numero
        `;
        const sumR = await pool.query(sumQ);
        fs.writeFileSync('diag_almendra_sum.json', JSON.stringify(sumR.rows, null, 2));

    } catch(e) {
        console.error('Error:', e.message);
    } finally {
        pool.end();
    }
}
run();
