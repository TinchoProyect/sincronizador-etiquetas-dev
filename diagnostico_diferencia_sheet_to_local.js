/**
 * DIAGNÓSTICO QUIRÚRGICO: Campo "diferencia" en sincronización Sheet → Local
 * Analiza específicamente por qué el campo "diferencia" queda NULL en local
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

async function diagnosticarDiferenciaSheetToLocal() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [DIAG-DIFERENCIA] ===== DIAGNÓSTICO QUIRÚRGICO: CAMPO DIFERENCIA =====');
        
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
        
        // PASO 2: Leer datos desde Google Sheets - SOLO DetallesPresupuestos
        console.log('\n2. Leyendo datos desde Google Sheets (DetallesPresupuestos)...');
        
        const detallesData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log('📋 [DIAG-DIFERENCIA] Encabezados leídos:', detallesData.headers);
        console.log('📋 [DIAG-DIFERENCIA] Total filas:', detallesData.rows.length);
        
        // PASO 3: ANÁLISIS ESPECÍFICO DEL CAMPO "DIFERENCIA"
        console.log('\n3. ANÁLISIS ESPECÍFICO DEL CAMPO "DIFERENCIA":');
        
        // 3.1 Verificar si existe el encabezado "Diferencia" (con mayúscula)
        const diferenciaIndex = detallesData.headers.findIndex(header => 
            header && header.toString().toLowerCase() === 'diferencia'
        );
        
        console.log(`📍 [DIAG-DIFERENCIA] Índice del campo "Diferencia" en headers: ${diferenciaIndex}`);
        
        if (diferenciaIndex === -1) {
            console.log('❌ [DIAG-DIFERENCIA] PROBLEMA: No se encontró campo "Diferencia" en encabezados');
            console.log('📋 [DIAG-DIFERENCIA] Encabezados disponibles:', detallesData.headers);
            
            // Buscar variaciones del nombre
            const variaciones = detallesData.headers.filter(header => 
                header && header.toString().toLowerCase().includes('dif')
            );
            console.log('🔍 [DIAG-DIFERENCIA] Variaciones encontradas:', variaciones);
        } else {
            console.log(`✅ [DIAG-DIFERENCIA] Campo "Diferencia" encontrado en posición ${diferenciaIndex} (columna ${String.fromCharCode(65 + diferenciaIndex)})`);
            console.log(`📋 [DIAG-DIFERENCIA] Encabezado exacto: "${detallesData.headers[diferenciaIndex]}"`);
        }
        
        // PASO 4: ANÁLISIS DE DATOS EN LAS PRIMERAS 5 FILAS
        console.log('\n4. ANÁLISIS DE DATOS EN PRIMERAS 5 FILAS:');
        
        const muestraFilas = detallesData.rows.slice(0, 5);
        
        muestraFilas.forEach((row, index) => {
            const filaNum = index + 2; // +2 porque fila 1 es header
            
            // Verificar si row es array o objeto
            let idPresupuesto, articulo, diferenciaValue;
            
            if (Array.isArray(row)) {
                idPresupuesto = row[1] || ''; // Posición 1 = IdPresupuesto
                articulo = row[2] || '';      // Posición 2 = Articulo
                diferenciaValue = row[7];     // Posición 7 = Diferencia
            } else {
                // Si es objeto, usar las claves directamente
                idPresupuesto = row['IdPresupuesto'] || row.IdPresupuesto || '';
                articulo = row['Articulo'] || row.Articulo || '';
                diferenciaValue = row['Diferencia'] || row.Diferencia;
            }
            
            console.log(`\n📊 [DIAG-DIFERENCIA] FILA ${filaNum}:`);
            console.log(`   IdPresupuesto: "${idPresupuesto}"`);
            console.log(`   Articulo: "${articulo}"`);
            console.log(`   Tipo de row: ${Array.isArray(row) ? 'Array' : 'Object'}`);
            
            if (diferenciaIndex >= 0) {
                console.log(`   Diferencia (índice ${diferenciaIndex}): "${diferenciaValue}" (tipo: ${typeof diferenciaValue})`);
                console.log(`   Diferencia parseFloat: ${parseFloat(diferenciaValue)} (isNaN: ${isNaN(parseFloat(diferenciaValue))})`);
                console.log(`   Diferencia || 0: ${parseFloat(diferenciaValue) || 0}`);
            } else {
                console.log(`   ❌ Diferencia: NO DISPONIBLE (campo no encontrado)`);
            }
            
            // Mostrar estructura de la fila para debugging
            if (Array.isArray(row)) {
                console.log(`   Valores por posición: [${row.slice(0, 10).map((val, idx) => `${idx}:"${val}"`).join(', ')}...]`);
            } else {
                console.log(`   Claves del objeto:`, Object.keys(row).slice(0, 10));
                console.log(`   Diferencia en objeto:`, row.Diferencia);
            }
        });
        
        // PASO 5: ANÁLISIS DEL MAPEO EN EL CÓDIGO
        console.log('\n5. ANÁLISIS DEL MAPEO EN EL CÓDIGO:');
        
        console.log('📍 [DIAG-DIFERENCIA] UBICACIÓN DEL MAPEO:');
        console.log('   Archivo: src/services/gsheets/sync_real.js');
        console.log('   Función: mapTwoSheetsToPresupuestos()');
        console.log('   Línea aproximada: ~200-250');
        
        console.log('\n📋 [DIAG-DIFERENCIA] MAPEO ACTUAL EN EL CÓDIGO:');
        console.log('   const diferencia = row[detallesData.headers[7]] || 0;  // Diferencia (H)');
        console.log('   diferencia: parseFloat(diferencia) || 0,');
        
        console.log('\n🔍 [DIAG-DIFERENCIA] VERIFICACIÓN DE POSICIÓN:');
        console.log(`   Esperado: headers[7] (columna H)`);
        console.log(`   Real: headers[${diferenciaIndex}] (columna ${diferenciaIndex >= 0 ? String.fromCharCode(65 + diferenciaIndex) : 'NO_ENCONTRADA'})`);
        
        if (diferenciaIndex !== 7) {
            console.log('❌ [DIAG-DIFERENCIA] PROBLEMA DETECTADO: Desalineación de columnas');
            console.log(`   El código espera "Diferencia" en headers[7] (columna H)`);
            console.log(`   Pero está en headers[${diferenciaIndex}] (columna ${diferenciaIndex >= 0 ? String.fromCharCode(65 + diferenciaIndex) : 'NO_ENCONTRADA'})`);
        }
        
        // PASO 6: SIMULAR EL MAPEO CON LOS DATOS REALES
        console.log('\n6. SIMULACIÓN DEL MAPEO CON DATOS REALES:');
        
        muestraFilas.forEach((row, index) => {
            const filaNum = index + 2;
            const idPresupuesto = row[detallesData.headers[1]] || '';
            const articulo = row[detallesData.headers[2]] || '';
            
            console.log(`\n🧪 [DIAG-DIFERENCIA] SIMULACIÓN FILA ${filaNum}:`);
            
            // Simular mapeo actual (headers[7])
            const diferenciaCodigoActual = row[detallesData.headers[7]] || 0;
            const diferenciaParseadaActual = parseFloat(diferenciaCodigoActual) || 0;
            
            console.log(`   Mapeo ACTUAL (headers[7]): "${diferenciaCodigoActual}" → ${diferenciaParseadaActual}`);
            
            // Simular mapeo correcto (si es diferente)
            if (diferenciaIndex >= 0 && diferenciaIndex !== 7) {
                const diferenciaCodigoCorrecto = row[diferenciaIndex] || 0;
                const diferenciaParseadaCorrecta = parseFloat(diferenciaCodigoCorrecto) || 0;
                
                console.log(`   Mapeo CORRECTO (headers[${diferenciaIndex}]): "${diferenciaCodigoCorrecto}" → ${diferenciaParseadaCorrecta}`);
                
                if (diferenciaParseadaActual !== diferenciaParseadaCorrecta) {
                    console.log(`   ⚠️ DIFERENCIA DETECTADA: ${diferenciaParseadaActual} vs ${diferenciaParseadaCorrecta}`);
                }
            }
            
            // Mostrar qué está en la posición headers[7] actualmente
            const valorEnPosicion7 = row[detallesData.headers[7]] || '';
            const headerEnPosicion7 = detallesData.headers[7] || '';
            console.log(`   En posición 7 (columna H): header="${headerEnPosicion7}", valor="${valorEnPosicion7}"`);
        });
        
        // PASO 7: VERIFICAR DATOS EN BASE LOCAL
        console.log('\n7. VERIFICACIÓN EN BASE LOCAL:');
        
        const localQuery = `
            SELECT id_presupuesto_ext, articulo, diferencia, 
                   CASE WHEN diferencia IS NULL THEN 'NULL' ELSE diferencia::text END as diferencia_status
            FROM presupuestos_detalles 
            WHERE id_presupuesto_ext IN (
                SELECT DISTINCT id_presupuesto_ext 
                FROM presupuestos 
                WHERE fecha_actualizacion > NOW() - INTERVAL '1 day'
            )
            ORDER BY id_presupuesto_ext, articulo
            LIMIT 10
        `;
        
        const localResult = await db.query(localQuery);
        
        console.log(`📋 [DIAG-DIFERENCIA] Registros recientes en local: ${localResult.rows.length}`);
        
        localResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.id_presupuesto_ext} - ${row.articulo}: diferencia=${row.diferencia_status}`);
        });
        
        // Contar NULLs
        const nullCount = localResult.rows.filter(row => row.diferencia === null).length;
        console.log(`📊 [DIAG-DIFERENCIA] Registros con diferencia NULL: ${nullCount}/${localResult.rows.length}`);
        
        // PASO 8: HIPÓTESIS DE CAUSA RAÍZ
        console.log('\n8. HIPÓTESIS DE CAUSA RAÍZ:');
        
        if (diferenciaIndex === -1) {
            console.log('🎯 [DIAG-DIFERENCIA] CAUSA RAÍZ: Campo "Diferencia" NO EXISTE en Google Sheets');
            console.log('   - El encabezado "Diferencia" no está presente en la hoja DetallesPresupuestos');
            console.log('   - El mapeo intenta leer headers[7] pero no corresponde a "Diferencia"');
        } else if (diferenciaIndex !== 7) {
            console.log('🎯 [DIAG-DIFERENCIA] CAUSA RAÍZ: DESALINEACIÓN DE COLUMNAS');
            console.log(`   - El código espera "Diferencia" en posición 7 (columna H)`);
            console.log(`   - Pero "Diferencia" está en posición ${diferenciaIndex} (columna ${String.fromCharCode(65 + diferenciaIndex)})`);
            console.log('   - Esto causa que se lea el valor incorrecto');
        } else {
            console.log('🎯 [DIAG-DIFERENCIA] CAUSA RAÍZ: VALORES VACÍOS O FORMATO INCORRECTO');
            console.log('   - El campo "Diferencia" está en la posición correcta');
            console.log('   - Pero los valores están vacíos o en formato no parseable');
        }
        
        console.log('\n📍 [DIAG-DIFERENCIA] PUNTOS EXACTOS DEL CÓDIGO INVOLUCRADOS:');
        console.log('   1. src/services/gsheets/sync_real.js:200-250 - función mapTwoSheetsToPresupuestos()');
        console.log('   2. Línea específica: const diferencia = row[detallesData.headers[7]] || 0;');
        console.log('   3. Línea específica: diferencia: parseFloat(diferencia) || 0,');
        console.log('   4. src/services/gsheets/sync_real.js:400-450 - función upsertPresupuesto()');
        console.log('   5. Query INSERT: detalle.diferencia se inserta en columna "diferencia"');
        
        console.log('\n🏁 [DIAG-DIFERENCIA] DIAGNÓSTICO COMPLETADO');
        
        return {
            diferenciaIndex,
            expectedIndex: 7,
            problema: diferenciaIndex !== 7 ? 'DESALINEACION' : diferenciaIndex === -1 ? 'CAMPO_FALTANTE' : 'VALORES_VACIOS',
            encabezados: detallesData.headers,
            muestraFilas: muestraFilas.map(row => ({
                diferencia_esperada: row[7],
                diferencia_real: diferenciaIndex >= 0 ? row[diferenciaIndex] : null
            }))
        };
        
    } catch (error) {
        console.error('❌ [DIAG-DIFERENCIA] Error en diagnóstico:', error.message);
        throw error;
    } finally {
        await db.end();
    }
}

// Ejecutar diagnóstico
diagnosticarDiferenciaSheetToLocal()
    .then(resultado => {
        console.log('\n🎯 [DIAG-DIFERENCIA] RESULTADO DEL DIAGNÓSTICO:', resultado.problema);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ [DIAG-DIFERENCIA] Error fatal:', error);
        process.exit(1);
    });
