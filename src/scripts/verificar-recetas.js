const pool = require('../usuarios/pool');

async function verificarTablaRecetas() {
    try {
        // 1. Verificar si la tabla existe
        console.log('1. Verificando existencia de la tabla recetas...');
        const existsQuery = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'recetas'
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
                AND table_name = 'recetas'
                ORDER BY ordinal_position;
            `;
            const columns = await pool.query(columnsQuery);
            console.log('Columnas encontradas:');
            columns.rows.forEach(col => {
                console.log(`- ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}`);
            });

            // 3. Contar registros
            console.log('\n3. Contando registros...');
            const countQuery = 'SELECT COUNT(*) FROM public.recetas;';
            const count = await pool.query(countQuery);
            console.log('Cantidad de registros:', count.rows[0].count);

            // 4. Mostrar muestra de registros
            if (count.rows[0].count > 0) {
                console.log('\n4. Muestra de los primeros 5 registros:');
                const sampleQuery = 'SELECT * FROM public.recetas LIMIT 5;';
                const sample = await pool.query(sampleQuery);
                console.log(sample.rows);
            }

            // 5. Verificar tabla de ingredientes
            console.log('\n5. Verificando tabla receta_ingredientes...');
            const ingredientesExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'receta_ingredientes'
                );
            `);
            console.log('¿Existe la tabla de ingredientes?:', ingredientesExists.rows[0].exists);

            if (ingredientesExists.rows[0].exists) {
                const ingredientesColumns = await pool.query(`
                    SELECT column_name, data_type
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'receta_ingredientes'
                    ORDER BY ordinal_position;
                `);
                console.log('Columnas de receta_ingredientes:');
                ingredientesColumns.rows.forEach(col => {
                    console.log(`- ${col.column_name}: ${col.data_type}`);
                });
            }
        }
    } catch (error) {
        console.error('Error durante la verificación:', error);
    } finally {
        await pool.end();
    }
}

// Ejecutar la verificación
verificarTablaRecetas();
