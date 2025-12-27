require('dotenv').config();
const pool = require('./src/produccion/config/database');

async function auditarSumas() {
    try {
        console.log(' AUDITORIA MATEMATICA EXACTA (Usuario 5 - Matias)');
        
        // Consulta en una sola linea con comillas dobles para evitar errores de sintaxis
        const query = "SELECT i.nombre, COUNT(isu.id) as cantidad_registros, SUM(isu.cantidad) as suma_cruda_sql, (SUM(isu.cantidad) > 0) as pasa_filtro_mayor_cero, (SUM(isu.cantidad) >= 0) as pasa_filtro_mayor_igual_cero FROM ingredientes_stock_usuarios isu JOIN ingredientes i ON isu.ingrediente_id = i.id WHERE isu.usuario_id = 5 AND i.id IN (135, 136) GROUP BY i.nombre";

        const res = await pool.query(query);
        console.table(res.rows);

    } catch (e) {
        console.error(' Error:', e.message);
    } finally {
        process.exit();
    }
}
auditarSumas();
