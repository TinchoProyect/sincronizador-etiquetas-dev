require('dotenv').config();
const { pool } = require('../src/logistica/config/database');

async function inspect() {
    try {
        console.log("🔍 [DB-INSPECTOR] Buscando tablas y columnas...");
        
        // 1. Listar todas las tablas en el esquema 'public' que contengan 'bunker', 'precio', 'costo' o 'articulo'
        const queryTables = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND (table_name LIKE '%bunker%' OR table_name LIKE '%precio%' OR table_name LIKE '%costo%' OR table_name LIKE '%articulo%' OR table_name LIKE '%lomasoft%')
            ORDER BY table_name;
        `;
        const resTables = await pool.query(queryTables);
        console.log("📋 Tablas encontradas:");
        for (const r of resTables.rows) {
            const table = r.table_name;
            const resCols = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                  AND table_name = $1
            `, [table]);
            console.log(`\nTable '${table}':`);
            console.log(`| Columns: ` + resCols.rows.map(c => `${c.column_name} (${c.data_type})`).join(', '));
        }
    } catch (e) {
        console.error("❌ Error de inspección:", e);
    }
    process.exit(0);
}

inspect();
