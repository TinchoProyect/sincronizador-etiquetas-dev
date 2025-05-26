const pool = require('../usuarios/pool');

async function verificarTablaArticulos() {
    try {
        // 1. Verificar si la tabla existe
        console.log('1. Verificando existencia de la tabla articulos...');
        const existsQuery = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'articulos'
            );
        `;
        const tableExists = await pool.query(existsQuery);
        console.log('¿Existe la tabla?:', tableExists.rows[0].exists);

        if (tableExists.rows[0].exists) {
            // 2. Obtener estructura de la tabla
            console.log('\n2. Obteniendo estructura de la tabla...');
            const columnsQuery = `
                SELECT column_name, data_type, character_maximum_length
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'articulos'
                ORDER BY ordinal_position;
            `;
            const columns = await pool.query(columnsQuery);
            console.log('Columnas encontradas:');
            columns.rows.forEach(col => {
                console.log(`- ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}`);
            });

            // 3. Contar registros
            console.log('\n3. Contando registros...');
            const countQuery = 'SELECT COUNT(*) FROM public.articulos;';
            const count = await pool.query(countQuery);
            console.log('Cantidad de registros:', count.rows[0].count);

            // 4. Mostrar muestra de registros
            if (count.rows[0].count > 0) {
                console.log('\n4. Muestra de los primeros 5 registros:');
                const sampleQuery = 'SELECT * FROM public.articulos LIMIT 5;';
                const sample = await pool.query(sampleQuery);
                console.log(sample.rows);
            }
        }
    } catch (error) {
        console.error('Error durante la verificación:', error);
    } finally {
        // Cerrar el pool
        await pool.end();
    }
}

// Ejecutar la verificación
verificarTablaArticulos();
