require('dotenv').config();
const pool = require('./src/produccion/config/database');

async function ejecutar() {
    try {
        console.log('\n ESCANEANDO TABLA USUARIOS...');
        
        // Traemos 1 fila solo para ver los nombres de las columnas
        const res = await pool.query("SELECT * FROM usuarios LIMIT 1");
        
        if (res.rows.length > 0) {
            console.log(' Columnas encontradas:');
            // Mostramos las llaves (nombres de columnas) del primer resultado
            console.log(Object.keys(res.rows[0]).join(' | '));
            
            console.log('\n Ejemplo de datos:');
            console.table(res.rows);
        } else {
            console.log(' La tabla usuarios existe pero está VACÍA.');
        }

    } catch (e) { 
        console.error(' Error:', e.message); 
    } finally { 
        process.exit(); 
    }
}
ejecutar();
