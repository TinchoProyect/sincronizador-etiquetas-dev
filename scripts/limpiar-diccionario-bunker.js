const { Pool } = require('pg');
require('dotenv').config();

const poolProd = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'Oeste2001',
    port: process.env.DB_PORT || 5432,
});

// Staging pool assuming standard suffix or from .env.test if we strictly parsed it
const poolTest = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: 'etiquetas_pruebas',
    password: process.env.DB_PASSWORD || 'Oeste2001',
    port: process.env.DB_PORT || 5432,
});

async function purgarDiccionarios() {
    try {
        console.log('🧹 Iniciando purga del diccionario dinámico de Búnker...');
        
        await poolProd.query('TRUNCATE TABLE public.bunker_diccionario RESTART IDENTITY CASCADE;');
        console.log('✅ Base de datos de Producción (etiquetas) purgada exitosamente.');

        await poolTest.query('TRUNCATE TABLE public.bunker_diccionario RESTART IDENTITY CASCADE;');
        console.log('✅ Base de datos de Pruebas (etiquetas_pruebas) purgada exitosamente.');

    } catch (error) {
        console.error('❌ Error fatal limpiando la base de datos:', error);
    } finally {
        await poolProd.end();
        await poolTest.end();
    }
}

purgarDiccionarios();
