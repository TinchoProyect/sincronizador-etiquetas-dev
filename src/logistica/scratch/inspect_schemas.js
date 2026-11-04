const pool = require('../../produccion/config/database');

async function checkSchemas() {
    try {
        const resIngCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'ingredientes'
            ORDER BY ordinal_position
        `);
        console.log('=== COLUMNAS INGREDIENTES ===');
        console.table(resIngCols.rows);

        const resArtCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'articulos'
            ORDER BY ordinal_position
        `);
        console.log('=== COLUMNAS ARTICULOS ===');
        console.table(resArtCols.rows.filter(r => r.column_name.includes('tipo') || r.column_name.includes('categoria') || r.column_name.includes('es_') || r.column_name.includes('kit') || r.column_name.includes('up')));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkSchemas();
