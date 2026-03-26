const { Pool } = require('pg');
require('dotenv').config();

const poolProd = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'Oeste2001',
    port: process.env.DB_PORT || 5432,
});

const poolTest = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: 'etiquetas_pruebas',
    password: process.env.DB_PASSWORD || 'Oeste2001',
    port: process.env.DB_PORT || 5432,
});

async function limpiarSufijos() {
    try {
        console.log('🧹 Limpiando sufijos x 10kg en bunker_diccionario...');
        
        // Find all entries in bunker_diccionario where termino contains ' x ' and ends with number or kg
        const querySelect = `
            SELECT id, termino, abreviatura 
            FROM public.bunker_diccionario 
            WHERE termino ILIKE '% x %' 
               OR termino ~* '\\s*\\d*\\s*x\\s*\\d+(\\.\\d+)?[kg]*'
        `;

        for (const pool of [poolProd, poolTest]) {
            const res = await pool.query(querySelect);
            let count = 0;
            for (const row of res.rows) {
                // Strip suffix
                let newTermino = row.termino.replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]?/g, '').trim();
                let newAbrev = row.abreviatura.replace(/\s*\d*\s*[xX]\s*\d+(\.\d+)?[kK]?[gG]?/g, '').trim();

                if (newTermino !== row.termino) {
                    try {
                        // Attempt update
                        await pool.query(
                            `UPDATE public.bunker_diccionario 
                             SET termino = $1, abreviatura = $2 
                             WHERE id = $3`, 
                            [newTermino, newAbrev, row.id]
                        );
                        count++;
                    } catch (err) {
                        // If it conflicts with existing clean term, just delete this duplicate dirty term
                        await pool.query(`DELETE FROM public.bunker_diccionario WHERE id = $1`, [row.id]);
                        count++;
                    }
                }
            }
            console.log(`✅ Base limpiada. Registros corregidos: ${count}`);
        }
    } catch (error) {
        console.error('❌ Error fatal limpiando sufijos:', error);
    } finally {
        await poolProd.end();
        await poolTest.end();
    }
}

limpiarSufijos();
