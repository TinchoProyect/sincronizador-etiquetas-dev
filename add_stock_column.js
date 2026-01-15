const pool = require('./src/usuarios/pool');

async function migrate() {
    try {
        console.log('Iniciando migración...');
        const query = `
            ALTER TABLE ingredientes_movimientos 
            ADD COLUMN IF NOT EXISTS stock_anterior NUMERIC(20, 10) DEFAULT 0;
        `;
        await pool.query(query);
        console.log('✅ Columna stock_anterior agregada exitosamente.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error en migración:', err);
        process.exit(1);
    }
}

migrate();
