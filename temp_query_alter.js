const { Pool } = require('pg'); 
require('dotenv').config(); 
const pool = new Pool({ 
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
}); 
pool.query(`
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS firma_digital TEXT; 
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS id_orden_tratamiento INTEGER; 
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMP; 
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS observaciones TEXT; 
ALTER TABLE entregas_eventos ADD COLUMN IF NOT EXISTS dni_receptor VARCHAR(50);
`).then(r => console.log('OK')).catch(e=>console.error(e)).finally(() => pool.end());
