const fs = require('fs');
const { pool } = require('../src/logistica/config/database');

async function run() {
    try {
        console.log('⏳ Borrando tablas existentes...');
        await pool.query('DROP TABLE IF EXISTS logistica_satelite_puntos;');
        await pool.query('DROP TABLE IF EXISTS logistica_satelite_eventos;');
        console.log('✅ Tablas borradas exitosamente.');

        console.log('⏳ Aplicando migración 07_reservorio_satelital.sql...');
        const sql = fs.readFileSync('./src/logistica/migrations/07_reservorio_satelital.sql', 'utf8');
        await pool.query(sql);
        console.log('✅ Migración aplicada exitosamente.');

        console.log('⏳ Verificando constraints (restricciones UNIQUE)...');
        const res = await pool.query("SELECT conname FROM pg_constraint WHERE conrelid = 'logistica_satelite_puntos'::regclass;");
        console.log('✅ Constraints encontradas:', res.rows.map(r => r.conname));
        
        const tieneUnique = res.rows.some(r => r.conname === 'uk_chofer_tiempo');
        if (tieneUnique) {
            console.log('🎉 Todo perfecto: la restricción uk_chofer_tiempo está activa.');
        } else {
            console.log('⚠️ ALERTA: La restricción uk_chofer_tiempo NO se aplicó.');
        }

    } catch(e) {
        console.error('❌ Error:', e);
    } finally {
        pool.end();
    }
}

run();
