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

async function runMigration() {
    try {
        console.log('Migración: Añadiendo expresado_en_gramos a Producción...');
        await poolProd.query("ALTER TABLE public.bunker_articulos ADD COLUMN expresado_en_gramos BOOLEAN DEFAULT FALSE;");
        console.log('✅ Producción lista.');
    } catch(e) { console.error('Error Producción (quizá ya existe):', e.message); }

    try {
        console.log('Migración: Añadiendo expresado_en_gramos a Pruebas...');
        await poolTest.query("ALTER TABLE public.bunker_articulos ADD COLUMN expresado_en_gramos BOOLEAN DEFAULT FALSE;");
        console.log('✅ Pruebas listas.');
    } catch(e) { console.error('Error Pruebas (quizá ya existe):', e.message); }

    poolProd.end();
    poolTest.end();
}

runMigration();
