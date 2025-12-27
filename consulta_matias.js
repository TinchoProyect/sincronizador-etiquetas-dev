require('dotenv').config();
const pool = require('./src/produccion/config/database');

async function ejecutar() {
    try {
        console.log(' Buscando a Matías...');
        const res = await pool.query(\"SELECT id, nombre, email, rol FROM usuarios WHERE nombre ILIKE '%Matias%'\");
        console.table(res.rows);
    } catch (e) { 
        console.error(' Error:', e.message); 
    } finally { 
        process.exit(); 
    }
}
ejecutar();
