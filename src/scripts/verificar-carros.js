const pool = require('../usuarios/pool');

async function verificarTablaCarros() {
    try {
        // 1. Verificar si la tabla carros_produccion existe
        console.log('1. Verificando existencia de la tabla carros_produccion...');
        const existsQuery = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'carros_produccion'
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
                AND table_name = 'carros_produccion'
                ORDER BY ordinal_position;
            `;
            const columns = await pool.query(columnsQuery);
            console.log('Columnas encontradas:');
            columns.rows.forEach(col => {
                console.log(`- ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}`);
            });

            // 3. Verificar tabla carros_articulos
            console.log('\n3. Verificando tabla carros_articulos...');
            const articulosExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'carros_articulos'
                );
            `);
            console.log('¿Existe la tabla carros_articulos?:', articulosExists.rows[0].exists);

            if (articulosExists.rows[0].exists) {
                const articulosColumns = await pool.query(`
                    SELECT column_name, data_type
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'carros_articulos'
                    ORDER BY ordinal_position;
                `);
                console.log('Columnas de carros_articulos:');
                articulosColumns.rows.forEach(col => {
                    console.log(`- ${col.column_name}: ${col.data_type}`);
                });
            }

            // 4. Contar registros
            console.log('\n4. Contando registros en carros_produccion...');
            const countQuery = 'SELECT COUNT(*) FROM public.carros_produccion;';
            const count = await pool.query(countQuery);
            console.log('Cantidad de carros:', count.rows[0].count);

            if (count.rows[0].count > 0) {
                console.log('\n5. Muestra del último carro creado:');
                const lastCarroQuery = `
                    SELECT cp.*, 
                           (SELECT COUNT(*) FROM carros_articulos ca WHERE ca.carro_id = cp.id) as total_articulos
                    FROM carros_produccion cp
                    ORDER BY cp.fecha_inicio DESC
                    LIMIT 1;
                `;
                const lastCarro = await pool.query(lastCarroQuery);
                console.log(lastCarro.rows[0]);
            }
        }
    } catch (error) {
        console.error('Error durante la verificación:', error);
    } finally {
        await pool.end();
    }
}

// Ejecutar la verificación
verificarTablaCarros();
