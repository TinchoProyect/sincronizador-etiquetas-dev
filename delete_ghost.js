const { Client } = require('pg');
require('dotenv').config();
const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

async function run() {
    await client.connect();
    try {
        console.log("Iniciando purga total del ingrediente fantasma 143...");
        
        await client.query('BEGIN');
        
        let resMov = await client.query('DELETE FROM ingredientes_movimientos WHERE ingrediente_id = 143');
        console.log(`Movimientos eliminados: ${resMov.rowCount}`);
        
        // Purgar de composiciones si estuviera
        try {
            let resCompMix = await client.query('DELETE FROM ingrediente_composicion WHERE mix_id = 143 OR ingrediente_id = 143');
            console.log(`Composiciones (mix/ingrediente) eliminadas: ${resCompMix.rowCount}`);
        } catch (e) {
            console.log("No existe ingrediente_composicion col format o no hay refer. ", e.message);
        }
        
        // Purgar otras dependencias posibles
        try {
            let resAjustes = await client.query('DELETE FROM ingredientes_ajustes WHERE ingrediente_id = 143');
            console.log(`Ajustes eliminados: ${resAjustes.rowCount}`);
        } catch (e) {}
        
        // Finalmente, erradicar el ingrediente
        let resIng = await client.query('DELETE FROM ingredientes WHERE id = 143');
        console.log(`Ingrediente fantasma eliminado: ${resIng.rowCount}`);
        
        await client.query('COMMIT');
        console.log("Purgado finalizado exitosamente.");
    } catch(err) {
        await client.query('ROLLBACK');
        console.error("Error durante purga:", err);
    }
    
    await client.end();
}

run().catch(console.error);
