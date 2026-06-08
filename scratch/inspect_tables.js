const pool = require('../src/produccion/config/database');

async function inspectTable(tableName) {
    try {
        const query = `
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position;
        `;
        const res = await pool.query(query, [tableName]);
        console.log(`\n=== Table: ${tableName} ===`);
        res.rows.forEach(row => {
            console.log(`  - ${row.column_name} (${row.data_type}) [Nullable: ${row.is_nullable}]`);
        });
    } catch (error) {
        console.error(`Error inspecting table ${tableName}:`, error);
    }
}

async function run() {
    const tables = [
        'recetas',
        'receta_ingredientes',
        'receta_articulos',
        'ingredientes',
        'articulos',
        'bunker_articulos'
    ];
    for (const table of tables) {
        await inspectTable(table);
    }
    pool.end();
}

run();
