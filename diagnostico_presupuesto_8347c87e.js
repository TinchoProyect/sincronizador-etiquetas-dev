/**
 * DIAGNÓSTICO ESPECÍFICO: Presupuesto 8347c87e recién creado
 * Verifica qué pasa con el campo "diferencia" en este presupuesto específico
 */

const { Pool } = require('pg');
const { readSheetWithHeaders } = require('./src/services/gsheets/client');

// Configuración de base de datos
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function diagnosticarPresupuesto8347c87e() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-8347c87e] ===== DIAGNÓSTICO PRESUPUESTO 8347c87e =====');
        
        // PASO 1: Obtener configuración activa
        console.log('\n1. Obteniendo configuración activa...');
        const configQuery = `
            SELECT hoja_url, hoja_id, hoja_nombre
            FROM presupuestos_config
            WHERE activo = true
            ORDER BY id DESC
            LIMIT 1
        `;
        const configResult = await db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            throw new Error('No se encontró configuración activa');
        }
        
        const config = configResult.rows[0];
        console.log('✅ Config encontrada:', {
            hoja_id: config.hoja_id,
            hoja_url: config.hoja_url
        });
        
        // PASO 2: Buscar el presupuesto 8347c87e en Google Sheets
        console.log('\n2. Buscando presupuesto 8347c87e en Google Sheets...');
        
        const detallesData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log('📋 [DIAG-8347c87e] Headers:', detallesData.headers);
        console.log('📋 [DIAG-8347c87e] Total filas:', detallesData.rows.length);
        
        // Buscar filas del presupuesto 8347c87e
        const filas8347c87e = detallesData.rows.filter(row => {
            const idPresupuesto = row.IdPresupuesto || row['IdPresupuesto'] || '';
            return idPresupuesto.toString().includes('8347c87e');
        });
        
        console.log(`📋 [DIAG-8347c87e] Filas encontradas para 8347c87e: ${filas8347c87e.length}`);
        
        if (filas8347c87e.length === 0) {
            console.log('❌ [DIAG-8347c87e] No se encontraron filas para el presupuesto 8347c87e');
            console.log('🔍 [DIAG-8347c87e] Buscando IDs similares...');
            
            // Buscar IDs que contengan parte del string
            const idsSimilares = detallesData.rows
                .map(row => row.IdPresupuesto || row['IdPresupuesto'] || '')
                .filter(id => id.toString().includes('8347') || id.toString().includes('c87e'))
                .slice(0, 10);
            
            console.log('🔍 [DIAG-8347c87e] IDs similares encontrados:', idsSimilares);
            return;
        }
        
        // PASO 3: Analizar cada fila del presupuesto 8347c87e
        console.log('\n3. ANÁLISIS DETALLADO DE FILAS DEL PRESUPUESTO 8347c87e:');
        
        filas8347c87e.forEach((row, index) => {
            console.log(`\n📊 [DIAG-8347c87e] FILA ${index + 1}:`);
            console.log(`   IdPresupuesto: "${row.IdPresupuesto}"`);
            console.log(`   Articulo: "${row.Articulo}"`);
            console.log(`   Cantidad: ${row.Cantidad}`);
            console.log(`   Valor1: ${row.Valor1}`);
            console.log(`   Precio1: ${row.Precio1}`);
            console.log(`   IVA1: ${row.IVA1}`);
            console.log(`   Diferencia: ${row.Diferencia} (tipo: ${typeof row.Diferencia})`);
            
            // Simular el mapeo actual
            const diferenciaMapeada = row.Diferencia || row['Diferencia'] || 0;
            const diferenciaParsed = parseFloat(diferenciaMapeada) || 0;
            
            console.log(`   Mapeo actual: ${diferenciaMapeada} → parseFloat: ${diferenciaParsed}`);
            
            if (diferenciaParsed === 0 && row.Diferencia !== 0 && row.Diferencia !== null) {
                console.log(`   ⚠️ PROBLEMA: Diferencia original ${row.Diferencia} se convierte en 0`);
            } else if (diferenciaParsed > 0) {
                console.log(`   ✅ CORRECTO: Diferencia se mapea correctamente`);
            }
        });
        
        // PASO 4: Verificar si ya existe en base local
        console.log('\n4. VERIFICANDO EN BASE LOCAL:');
        
        const localQuery = `
            SELECT id, id_presupuesto_ext, articulo, diferencia, fecha_actualizacion
            FROM presupuestos_detalles 
            WHERE id_presupuesto_ext LIKE '%8347c87e%'
            ORDER BY fecha_actualizacion DESC
        `;
        
        const localResult = await db.query(localQuery);
        
        console.log(`📋 [DIAG-8347c87e] Registros en local: ${localResult.rows.length}`);
        
        if (localResult.rows.length > 0) {
            localResult.rows.forEach((row, index) => {
                console.log(`   ${index + 1}. ${row.id_presupuesto_ext} - ${row.articulo}: diferencia=${row.diferencia} (${row.fecha_actualizacion})`);
            });
        } else {
            console.log('   No se encontraron registros en local para 8347c87e');
        }
        
        // PASO 5: Recomendaciones
        console.log('\n5. RECOMENDACIONES:');
        
        if (filas8347c87e.length > 0) {
            const tieneValoresReales = filas8347c87e.some(row => 
                row.Diferencia !== null && row.Diferencia !== 0 && !isNaN(parseFloat(row.Diferencia))
            );
            
            if (tieneValoresReales) {
                console.log('✅ [DIAG-8347c87e] El presupuesto 8347c87e SÍ tiene valores reales de diferencia en Sheets');
                console.log('🔄 [DIAG-8347c87e] Ejecuta una sincronización manual para ver si se transfieren correctamente');
            } else {
                console.log('❌ [DIAG-8347c87e] El presupuesto 8347c87e NO tiene valores válidos de diferencia');
            }
        }
        
        console.log('\n🏁 [DIAG-8347c87e] DIAGNÓSTICO COMPLETADO');
        
        return {
            filasEncontradas: filas8347c87e.length,
            registrosEnLocal: localResult.rows.length,
            datosSheets: filas8347c87e.map(row => ({
                articulo: row.Articulo,
                diferencia: row.Diferencia,
                diferenciaTipo: typeof row.Diferencia
            }))
        };
        
    } catch (error) {
        console.error('❌ [DIAG-8347c87e] Error en diagnóstico:', error.message);
        throw error;
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticarPresupuesto8347c87e()
    .then(resultado => {
        console.log('\n🎯 [DIAG-8347c87e] RESULTADO FINAL:', resultado);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ [DIAG-8347c87e] Error fatal:', error);
        process.exit(1);
    });
