/**
 * DIAGNÓSTICO SIMPLIFICADO: Análisis de hojas de Google Sheets
 * Solo lee las hojas sin conectar a la base de datos
 */

const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

async function diagnosticarSheetsSimple() {
    console.log('🔍 [DIAGNÓSTICO] Iniciando análisis de hojas de Google Sheets...\n');
    
    try {
        // Usar configuración hardcodeada
        const sheetId = '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8';
        console.log('📋 Sheet ID:', sheetId);
        
        // PASO 1: Leer hoja "Presupuestos"
        console.log('\n=== PASO 1: ANÁLISIS HOJA "Presupuestos" ===');
        const presupuestosData = await readSheetWithHeaders(sheetId, 'A:O', 'Presupuestos');
        
        console.log('📊 Encabezados Presupuestos:', presupuestosData.headers);
        console.log('📊 Total filas:', presupuestosData.rows.length);
        
        // Verificar nombres exactos de columnas
        const idPresupuestoCol = presupuestosData.headers[0];
        console.log(`🔍 Columna A (ID): "${idPresupuestoCol}"`);
        
        if (presupuestosData.rows.length > 0) {
            console.log('📋 Primeras 3 filas de presupuestos:');
            presupuestosData.rows.slice(0, 3).forEach((row, i) => {
                console.log(`   Fila ${i + 2}: ID="${row[idPresupuestoCol]}", Cliente="${row[presupuestosData.headers[2]]}", Estado="${row[presupuestosData.headers[7]]}"`);
            });
        }
        
        // PASO 2: Leer hoja "DetallesPresupuestos"
        console.log('\n=== PASO 2: ANÁLISIS HOJA "DetallesPresupuestos" ===');
        const detallesData = await readSheetWithHeaders(sheetId, 'A:Q', 'DetallesPresupuestos');
        
        console.log('📊 Encabezados DetallesPresupuestos:', detallesData.headers);
        console.log('📊 Total filas:', detallesData.rows.length);
        
        // Verificar nombres exactos de columnas
        const idDetalleCol = detallesData.headers[0];
        const idPresupuestoDetalleCol = detallesData.headers[1];
        const articuloCol = detallesData.headers[2];
        
        console.log(`🔍 Columna A (ID Detalle): "${idDetalleCol}"`);
        console.log(`🔍 Columna B (ID Presupuesto): "${idPresupuestoDetalleCol}"`);
        console.log(`🔍 Columna C (Artículo): "${articuloCol}"`);
        
        if (detallesData.rows.length > 0) {
            console.log('📋 Primeras 5 filas de detalles:');
            detallesData.rows.slice(0, 5).forEach((row, i) => {
                console.log(`   Fila ${i + 2}: IDPresupuesto="${row[idPresupuestoDetalleCol]}", Artículo="${row[articuloCol]}", Cantidad="${row[detallesData.headers[3]]}"`);
            });
        }
        
        // PASO 3: Análisis de coincidencias de ID
        console.log('\n=== PASO 3: ANÁLISIS DE COINCIDENCIAS DE ID ===');
        
        // Crear mapas de IDs
        const idsPresupuestos = new Set();
        presupuestosData.rows.forEach(row => {
            const id = (row[idPresupuestoCol] || '').toString().trim();
            if (id) idsPresupuestos.add(id);
        });
        
        const idsDetalles = new Set();
        const detallesPorPresupuesto = new Map();
        detallesData.rows.forEach(row => {
            const idPresupuesto = (row[idPresupuestoDetalleCol] || '').toString().trim();
            if (idPresupuesto) {
                idsDetalles.add(idPresupuesto);
                if (!detallesPorPresupuesto.has(idPresupuesto)) {
                    detallesPorPresupuesto.set(idPresupuesto, []);
                }
                detallesPorPresupuesto.get(idPresupuesto).push(row);
            }
        });
        
        console.log(`📊 IDs únicos en Presupuestos: ${idsPresupuestos.size}`);
        console.log(`📊 IDs únicos en Detalles: ${idsDetalles.size}`);
        
        // Encontrar coincidencias y diferencias
        const coincidencias = [...idsPresupuestos].filter(id => idsDetalles.has(id));
        const presupuestosSinDetalles = [...idsPresupuestos].filter(id => !idsDetalles.has(id));
        const detallesSinPresupuesto = [...idsDetalles].filter(id => !idsPresupuestos.has(id));
        
        console.log(`✅ Presupuestos con detalles: ${coincidencias.length}`);
        console.log(`❌ Presupuestos sin detalles: ${presupuestosSinDetalles.length}`);
        console.log(`⚠️ Detalles sin presupuesto: ${detallesSinPresupuesto.length}`);
        
        if (presupuestosSinDetalles.length > 0) {
            console.log('📋 Presupuestos sin detalles (primeros 5):');
            presupuestosSinDetalles.slice(0, 5).forEach(id => {
                console.log(`   - ${id}`);
            });
        }
        
        if (detallesSinPresupuesto.length > 0) {
            console.log('📋 Detalles sin presupuesto (primeros 5):');
            detallesSinPresupuesto.slice(0, 5).forEach(id => {
                console.log(`   - ${id}`);
            });
        }
        
        // PASO 4: Seleccionar presupuesto de prueba
        console.log('\n=== PASO 4: PRESUPUESTO DE PRUEBA ===');
        
        let presupuestoPrueba = null;
        if (coincidencias.length > 0) {
            presupuestoPrueba = coincidencias[0];
            const detallesDelPresupuesto = detallesPorPresupuesto.get(presupuestoPrueba);
            
            console.log(`🎯 Presupuesto seleccionado: ${presupuestoPrueba}`);
            console.log(`📊 Cantidad de detalles: ${detallesDelPresupuesto.length}`);
            
            console.log('📋 Detalles del presupuesto:');
            detallesDelPresupuesto.forEach((detalle, i) => {
                console.log(`   ${i + 1}. ${detalle[articuloCol]} - Cant: ${detalle[detallesData.headers[3]]} - Precio: ${detalle[detallesData.headers[5]]}`);
            });
        } else {
            console.log('❌ No se encontraron presupuestos con detalles para usar como prueba');
        }
        
        // PASO 5: Análisis de encabezados críticos
        console.log('\n=== PASO 5: ANÁLISIS DE ENCABEZADOS CRÍTICOS ===');
        
        console.log('🔍 Verificando nombres exactos de columnas:');
        console.log(`   Presupuestos[0]: "${presupuestosData.headers[0]}" (esperado: "IDPresupuesto")`);
        console.log(`   Detalles[1]: "${detallesData.headers[1]}" (esperado: "IdPresupuesto" o "IDPresupuesto")`);
        
        // Verificar si hay diferencias de mayúsculas/minúsculas
        const headerPresupuestos = presupuestosData.headers[0];
        const headerDetalles = detallesData.headers[1];
        
        if (headerPresupuestos !== headerDetalles) {
            console.log('⚠️ DIFERENCIA EN ENCABEZADOS DETECTADA:');
            console.log(`   Presupuestos: "${headerPresupuestos}"`);
            console.log(`   Detalles: "${headerDetalles}"`);
            console.log('   Esta diferencia puede causar problemas en el mapeo automático');
        } else {
            console.log('✅ Los encabezados de ID coinciden exactamente');
        }
        
        // PASO 6: Simulación de mapeo
        console.log('\n=== PASO 6: SIMULACIÓN DE MAPEO ===');
        
        // Simular el proceso de mapeo como lo hace mapTwoSheetsToPresupuestos
        const presupuestosMap = new Map();
        
        // Procesar presupuestos
        presupuestosData.rows.forEach((row, i) => {
            const id_presupuesto_ext = row[presupuestosData.headers[0]] || '';
            const id_cliente = row[presupuestosData.headers[2]] || '';
            
            if (id_presupuesto_ext && id_cliente) {
                const presupuestoKey = id_presupuesto_ext.toString().trim();
                presupuestosMap.set(presupuestoKey, {
                    presupuesto: { id_presupuesto_ext: presupuestoKey, id_cliente },
                    detalles: []
                });
            }
        });
        
        console.log(`📊 Presupuestos mapeados: ${presupuestosMap.size}`);
        
        // Procesar detalles
        let detallesAsignados = 0;
        let detallesOmitidos = 0;
        
        detallesData.rows.forEach((row, i) => {
            const id_presupuesto = row[detallesData.headers[1]] || '';
            const articulo = row[detallesData.headers[2]] || '';
            
            if (id_presupuesto && articulo) {
                const presupuestoKey = id_presupuesto.toString().trim();
                
                if (presupuestosMap.has(presupuestoKey)) {
                    presupuestosMap.get(presupuestoKey).detalles.push({
                        articulo: articulo.toString().trim(),
                        cantidad: row[detallesData.headers[3]] || 0
                    });
                    detallesAsignados++;
                } else {
                    detallesOmitidos++;
                    console.log(`   ❌ Detalle omitido: ID="${presupuestoKey}", Artículo="${articulo}"`);
                }
            }
        });
        
        console.log(`✅ Detalles asignados: ${detallesAsignados}`);
        console.log(`❌ Detalles omitidos: ${detallesOmitidos}`);
        
        // Contar presupuestos con y sin detalles después del mapeo
        let conDetalles = 0;
        let sinDetalles = 0;
        
        presupuestosMap.forEach(p => {
            if (p.detalles.length > 0) {
                conDetalles++;
            } else {
                sinDetalles++;
            }
        });
        
        console.log(`📊 Resultado del mapeo:`);
        console.log(`   - Presupuestos con detalles: ${conDetalles}`);
        console.log(`   - Presupuestos sin detalles: ${sinDetalles}`);
        
        // PASO 7: Análisis específico del código de sincronización
        console.log('\n=== PASO 7: ANÁLISIS DEL CÓDIGO DE SINCRONIZACIÓN ===');
        
        // Verificar si el problema está en la función syncDetallesDesdeSheets
        console.log('🔍 Verificando lógica de syncDetallesDesdeSheets:');
        
        // Simular la búsqueda de índice como lo hace el código real
        const H = detallesData.headers;
        const norm = (s) => (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase();
        const hmap = new Map(); 
        H.forEach((name, i) => hmap.set(norm(name), i));
        
        const findIdx = (...cands) => { 
            for (const c of cands) { 
                const hit = hmap.get(norm(c)); 
                if (hit !== undefined) return hit; 
            } 
            return -1; 
        };
        
        const idx = {
            id: findIdx('IDPresupuesto', 'ID Presupuesto'),
            art: findIdx('Articulo', 'Artículo'),
            cant: findIdx('Cantidad', 'Cant'),
            valor1: findIdx('Valor1', 'Valor 1', 'Valor'),
            precio1: findIdx('Precio1', 'Precio 1', 'Precio'),
            iva1: findIdx('IVA1', 'IVA 1', 'IVA')
        };
        
        console.log('📊 Índices encontrados por syncDetallesDesdeSheets:');
        console.log(`   - ID: ${idx.id} (columna: "${H[idx.id] || 'NO ENCONTRADA'}")`);
        console.log(`   - Artículo: ${idx.art} (columna: "${H[idx.art] || 'NO ENCONTRADA'}")`);
        console.log(`   - Cantidad: ${idx.cant} (columna: "${H[idx.cant] || 'NO ENCONTRADA'}")`);
        console.log(`   - Valor1: ${idx.valor1} (columna: "${H[idx.valor1] || 'NO ENCONTRADA'}")`);
        console.log(`   - Precio1: ${idx.precio1} (columna: "${H[idx.precio1] || 'NO ENCONTRADA'}")`);
        console.log(`   - IVA1: ${idx.iva1} (columna: "${H[idx.iva1] || 'NO ENCONTRADA'}")`);
        
        const columnasFaltantes = [];
        if (idx.id === -1) columnasFaltantes.push('IDPresupuesto');
        if (idx.art === -1) columnasFaltantes.push('Articulo');
        if (idx.cant === -1) columnasFaltantes.push('Cantidad');
        if (idx.valor1 === -1) columnasFaltantes.push('Valor1');
        if (idx.precio1 === -1) columnasFaltantes.push('Precio1');
        if (idx.iva1 === -1) columnasFaltantes.push('IVA1');
        
        if (columnasFaltantes.length > 0) {
            console.log('🚨 PROBLEMA DETECTADO: Faltan encabezados necesarios');
            console.log('❌ Columnas faltantes:', columnasFaltantes.join(', '));
            console.log('📋 Encabezados disponibles:', H);
        } else {
            console.log('✅ Todos los encabezados necesarios están presentes');
        }
        
        // PASO 8: Diagnóstico final
        console.log('\n=== DIAGNÓSTICO FINAL ===');
        
        if (columnasFaltantes.length > 0) {
            console.log('🚨 CAUSA RAÍZ IDENTIFICADA:');
            console.log('   La función syncDetallesDesdeSheets no puede procesar los detalles');
            console.log('   porque no encuentra las columnas necesarias con los nombres esperados.');
            console.log('');
            console.log('🔍 CAUSA ESPECÍFICA:');
            console.log(`   - Faltan columnas: ${columnasFaltantes.join(', ')}`);
            console.log(`   - Encabezados reales: ${H.join(', ')}`);
            console.log('');
            console.log('📍 UBICACIÓN DEL PROBLEMA:');
            console.log('   - Archivo: src/presupuestos/controllers/sync_fechas_fix.js');
            console.log('   - Función: syncDetallesDesdeSheets');
            console.log('   - Línea: ~580-590 (donde se definen los índices)');
        } else if (detallesOmitidos > 0) {
            console.log('🚨 CAUSA RAÍZ IDENTIFICADA:');
            console.log('   Los detalles se están omitiendo durante el proceso de mapeo');
            console.log('   porque no encuentran coincidencia con los presupuestos');
            
            if (headerPresupuestos !== headerDetalles) {
                console.log('🔍 CAUSA ESPECÍFICA: Diferencia en nombres de encabezados');
                console.log(`   - Hoja Presupuestos usa: "${headerPresupuestos}"`);
                console.log(`   - Hoja Detalles usa: "${headerDetalles}"`);
                console.log('   - El código espera coincidencia exacta para el mapeo');
            }
        } else {
            console.log('✅ Las hojas parecen estar correctamente estructuradas');
            console.log('   El problema puede estar en la lógica de sincronización o en la base de datos');
        }
        
    } catch (error) {
        console.error('❌ Error en diagnóstico:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Ejecutar diagnóstico si se llama directamente
if (require.main === module) {
    diagnosticarSheetsSimple();
}

module.exports = { diagnosticarSheetsSimple };
