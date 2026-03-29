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
            SELECT id, id_presupuesto_origen, articulo_numero, ingrediente_id, cantidad, tipo_movimiento, fecha_movimiento, usuario, observaciones, estado
            FROM public.mantenimiento_movimientos 
            ORDER BY id DESC LIMIT 20;
        `;
        const res = await pool.query(query);
        fs.writeFileSync('diag_operaciones.json', JSON.stringify(res.rows, null, 2));
    } catch(e) {
        console.error('Error:', e.message);
    } finally {
        pool.end();
    }
}
run();
