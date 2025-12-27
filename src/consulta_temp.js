require('dotenv').config(); // Carga las claves de la BD
const pool = require('./src/produccion/config/database');

async function ejecutarConsulta() {
    try {
        // --- PEGAR QUERY ACÁ ABAJO ---
        const query = "SELECT id, nombre, email, rol FROM usuarios WHERE nombre ILIKE '%Matias%'"; 
        // -----------------------------

        console.log("Ejecutando consulta...");
        const res = await pool.query(query);
        console.table(res.rows); // Muestra los datos en una tabla linda
    } catch (error) {
        console.error("❌ Error SQL:", error.message);
    } finally {
        // Cierra la conexión para no dejar colgada la terminal
        process.exit(); 
    }
}

ejecutarConsulta();