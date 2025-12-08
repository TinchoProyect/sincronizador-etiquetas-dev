/**
 * Script de diagnóstico para verificar estructura de tablas
 * Ejecutar con: node diagnostico-bd.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function diagnosticar() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  🔍 DIAGNÓSTICO DE ESTRUCTURA DE BD                  ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    try {
        // 1. Estructura de tabla rutas
        console.log('1️⃣ ESTRUCTURA DE TABLA rutas:');
        console.log('='.repeat(60));
        
        const estructuraRutas = await pool.query(`
            SELECT 
                column_name,
                data_type,
                character_maximum_length,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'rutas'
            ORDER BY ordinal_position
        `);
        
        console.table(estructuraRutas.rows);
        
        // 2. Estructura de tabla presupuestos (campos relevantes)
        console.log('\n2️⃣ ESTRUCTURA DE TABLA presupuestos (campos de logística):');
        console.log('='.repeat(60));
        
        const estructuraPresupuestos = await pool.query(`
            SELECT 
                column_name,
                data_type,
                character_maximum_length,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' 
              AND table_name = 'presupuestos'
              AND column_name IN ('id', 'id_ruta', 'id_domicilio_entrega', 'orden_entrega', 'estado_logistico')
            ORDER BY ordinal_position
        `);
        
        console.table(estructuraPresupuestos.rows);
        
        // 3. Datos de ejemplo de rutas
        console.log('\n3️⃣ RUTAS EXISTENTES:');
        console.log('='.repeat(60));
        
        const rutasExistentes = await pool.query(`
            SELECT 
                id,
                nombre_ruta,
                fecha_salida,
                id_chofer,
                id_vehiculo,
                estado
            FROM rutas
            ORDER BY id DESC
            LIMIT 5
        `);
        
        console.table(rutasExistentes.rows);
        
        // 4. Verificar tipos de datos en rutas
        console.log('\n4️⃣ TIPOS DE DATOS EN RUTAS (muestra):');
        console.log('='.repeat(60));
        
        if (rutasExistentes.rows.length > 0) {
            const ruta = rutasExistentes.rows[0];
            console.log('ID:', ruta.id, '- Tipo:', typeof ruta.id);
            console.log('id_chofer:', ruta.id_chofer, '- Tipo:', typeof ruta.id_chofer);
            console.log('id_vehiculo:', ruta.id_vehiculo, '- Tipo:', typeof ruta.id_vehiculo);
            console.log('estado:', ruta.estado, '- Tipo:', typeof ruta.estado);
        }
        
        // 5. Presupuestos asignados a rutas
        console.log('\n5️⃣ PRESUPUESTOS ASIGNADOS A RUTAS:');
        console.log('='.repeat(60));
        
        const presupuestosRutas = await pool.query(`
            SELECT 
                p.id,
                p.id_ruta,
                p.orden_entrega,
                p.estado_logistico,
                r.nombre_ruta,
                r.estado as estado_ruta
            FROM presupuestos p
            LEFT JOIN rutas r ON p.id_ruta = r.id
            WHERE p.id_ruta IS NOT NULL
            LIMIT 10
        `);
        
        console.table(presupuestosRutas.rows);
        
        // 6. Verificar tipos en presupuestos
        console.log('\n6️⃣ TIPOS DE DATOS EN PRESUPUESTOS (muestra):');
        console.log('='.repeat(60));
        
        if (presupuestosRutas.rows.length > 0) {
            const p = presupuestosRutas.rows[0];
            console.log('id:', p.id, '- Tipo:', typeof p.id);
            console.log('id_ruta:', p.id_ruta, '- Tipo:', typeof p.id_ruta);
            console.log('orden_entrega:', p.orden_entrega, '- Tipo:', typeof p.orden_entrega);
        }
        
        console.log('\n✅ Diagnóstico completado');
        
    } catch (error) {
        console.error('\n❌ Error en diagnóstico:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

diagnosticar();
