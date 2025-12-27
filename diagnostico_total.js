require('dotenv').config();
const pool = require('./src/produccion/config/database');

async function ejecutar() {
    try {
        console.log('\n 1. BUSCANDO USUARIO MATIAS...');
        const resUser = await pool.query("SELECT id, nombre FROM usuarios WHERE nombre ILIKE '%Matias%'");
        console.table(resUser.rows);
        
        if (resUser.rows.length === 0) { 
            console.log(' ERROR: No encontré a ningún usuario con nombre Matías.'); 
            process.exit(); 
        }
        const idUsuario = resUser.rows[0].id;
        console.log(' ID Detectado:', idUsuario);

        console.log('\n 2. BUSCANDO INGREDIENTES (Miel / Coco)...');
        const resIng = await pool.query("SELECT id, nombre, codigo FROM ingredientes WHERE nombre ILIKE '%Miel%' OR nombre ILIKE '%Coco%'");
        console.table(resIng.rows);
        
        console.log('\n 3. BUSCANDO MOVIMIENTOS CRUDOS (Tabla ingredientes_stock_usuarios)...');
        // Traemos TODO lo de este usuario para ver si hay algo
        const resStock = await pool.query("SELECT isu.id, i.nombre, isu.cantidad, isu.origen_mix_id, isu.fecha_registro FROM ingredientes_stock_usuarios isu JOIN ingredientes i ON isu.ingrediente_id = i.id WHERE isu.usuario_id =  ORDER BY isu.fecha_registro DESC", [idUsuario]);
        
        if (resStock.rows.length === 0) {
            console.log(' ALERTA: LA TABLA ESTÁ VACÍA para este usuario. El ajuste NO se guardó.');
        } else {
            console.table(resStock.rows);
            
            console.log('\n 4. VERIFICANDO SUMAS (Lo que debería ver el sistema)...');
            const resSuma = await pool.query("SELECT i.nombre, SUM(isu.cantidad) as total FROM ingredientes_stock_usuarios isu JOIN ingredientes i ON isu.ingrediente_id = i.id WHERE isu.usuario_id =  GROUP BY i.nombre", [idUsuario]);
            console.table(resSuma.rows);
        }

    } catch (e) { 
        console.error(' Error:', e.message); 
    } finally { 
        process.exit(); 
    }
}
ejecutar();
