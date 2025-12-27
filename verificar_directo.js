require('dotenv').config();
const pool = require('./src/produccion/config/database');

async function verificar() {
    try {
        console.log(' Verificando stock crudo para Matías (ID 5)...');
        
        // Consulta simple y directa sin JOINs ni complicaciones
        const res = await pool.query('SELECT * FROM ingredientes_stock_usuarios WHERE usuario_id = 5');
        
        if (res.rows.length === 0) {
            console.log(' LA TABLA ESTÁ VACÍA: El ajuste NO se guardó.');
            console.log('Diagnóstico: El problema está en el momento de GUARDAR (Botón Ajuste Rápido).');
        } else {
            console.log(' DATOS ENCONTRADOS: ' + res.rows.length + ' registros.');
            console.table(res.rows);
            console.log('Diagnóstico: Los datos existen. El problema es visual (Filtros ocultos).');
        }

    } catch (e) {
        console.error(' Error SQL:', e.message);
    } finally {
        process.exit();
    }
}
verificar();
