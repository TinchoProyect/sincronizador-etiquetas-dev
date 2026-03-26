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

async function purgarJSONB() {
    try {
        console.log('🧹 Iniciando purga de JSONB huérfanos en bunker_articulos...');
        
        const q = "UPDATE public.bunker_articulos SET propiedades_dinamicas = '{}'::jsonb;";

        const resProd = await poolProd.query(q);
        console.log(`✅ Producción: ${resProd.rowCount} artículos purgados de basura residual.`);

        const resTest = await poolTest.query(q);
        console.log(`✅ Pruebas: ${resTest.rowCount} artículos purgados de basura residual.`);

    } catch (error) {
        console.error('❌ Error fatal vaciando jsonb:', error);
    } finally {
        await poolProd.end();
        await poolTest.end();
    }
}

purgarJSONB();
