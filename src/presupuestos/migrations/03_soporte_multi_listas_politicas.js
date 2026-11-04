// filepath: src/presupuestos/migrations/03_soporte_multi_listas_politicas.js
'use strict';

const { pool } = require('../config/database');

async function runMigration() {
    console.log('🔄 Ejecutando migración: Soporte Multi-Listas para Políticas Comerciales...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Crear tabla de unión Many-to-Many entre políticas y listas de precios
        await client.query(`
            CREATE TABLE IF NOT EXISTS public.bunker_politica_listas (
                id SERIAL PRIMARY KEY,
                politica_id INT NOT NULL REFERENCES public.bunker_politicas_descuento(id) ON DELETE CASCADE,
                bunker_lista_precio_id INT NOT NULL REFERENCES public.bunker_listas_precios(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT unq_bunker_politica_lista UNIQUE (politica_id, bunker_lista_precio_id)
            );
        `);
        console.log('✅ Tabla public.bunker_politica_listas lista.');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_bunker_pol_listas_politica_id ON public.bunker_politica_listas(politica_id);
            CREATE INDEX IF NOT EXISTS idx_bunker_pol_listas_lista_id ON public.bunker_politica_listas(bunker_lista_precio_id);
        `);

        // 2. Añadir flag de aplicación universal (Todas las listas)
        await client.query(`
            ALTER TABLE public.bunker_politicas_descuento 
            ADD COLUMN IF NOT EXISTS aplica_a_todas BOOLEAN NOT NULL DEFAULT false;
        `);
        console.log('✅ Columna aplica_a_todas agregada en bunker_politicas_descuento.');

        // 3. Quitar restricción UNIQUE en bunker_lista_precio_id para admitir múltiples políticas por lista o políticas multi-lista
        await client.query(`
            ALTER TABLE public.bunker_politicas_descuento 
            DROP CONSTRAINT IF EXISTS bunker_politicas_descuento_bunker_lista_precio_id_key;
        `);
        console.log('✅ Restricción UNIQUE eliminada en bunker_lista_precio_id.');

        // 4. Migrar asociaciones existentes hacia bunker_politica_listas
        await client.query(`
            INSERT INTO public.bunker_politica_listas (politica_id, bunker_lista_precio_id)
            SELECT id, bunker_lista_precio_id 
            FROM public.bunker_politicas_descuento 
            WHERE bunker_lista_precio_id IS NOT NULL 
            ON CONFLICT (politica_id, bunker_lista_precio_id) DO NOTHING;
        `);
        console.log('✅ Asociaciones existentes migradas hacia bunker_politica_listas.');

        await client.query('COMMIT');
        console.log('🎉 Migración 03 completada con éxito.');
        process.exit(0);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración 03:', err);
        process.exit(1);
    } finally {
        client.release();
    }
}

runMigration();
