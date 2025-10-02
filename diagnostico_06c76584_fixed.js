require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { readSheetWithHeaders } = require('./src/services/gsheets/client_with_logs');

async function diagnostico06c76584() {
    console.log('🔍 [DIAG] === DIAGNÓSTICO PRESUPUESTO 06c76584 ===\n');
    
    try {
        // Función para normalizar claves con análisis detallado
        function normalizarClave(idPresupuesto, articulo, debug = false) {
            // IdPresupuesto: String, trim, toLowerCase
            const idRaw = idPresupuesto || '';
            const idNorm = String(idRaw).trim().toLowerCase();
            
            // Articulo: convertir a string sin formato científico, sin decimales, trim
            const artRaw = articulo || '';
            let artNorm = '';
            
            if (typeof artRaw === 'number') {
                // Si es número, convertir a string plana sin notación científica
                artNorm = artRaw.toString();
            } else {
                artNorm = String(artRaw);
            }
            
            // Convertir notación científica a número normal
            if (artNorm.includes('e+') || artNorm.includes('E+') || artNorm.includes('e-') || artNorm.includes('E-')) {
                try {
                    const num = parseFloat(artNorm);
                    if (!isNaN(num)) {
                        artNorm = num.toString();
                    }
                } catch (e) {
                    // Si falla, mantener original
                }
            }
            
            // Remover .0 al final
            if (artNorm.endsWith('.0')) {
                artNorm = artNorm.slice(0, -2);
            }
            
            // Remover separadores de miles (comas, puntos internos)
            artNorm = artNorm.replace(/[,.]/g, '');
            
            // Trim final
            artNorm = artNorm.trim();
            
            if (debug) {
                return {
                    clave: `${idNorm}|${artNorm}`,
                    idRaw,
                    idNorm,
                    idLength: idNorm.length,
                    artRaw,
                    artNorm,
                    artLength: artNorm.length
                };
            }
            
            return `${idNorm}|${artNorm}`;
        }
        
        // Función para analizar caracteres sospechosos
        function analizarCaracteres(str, nombre) {
            const chars = [];
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                const code = str.charCodeAt(i);
                if (code < 32 || code > 126 || code === 160) { // Caracteres no imprimibles o NBSP
                    chars.push(`${nombre}[${i}]: '${char}' (${code})`);
                }
            }
            return chars;
        }

        // 1. LEER DATOS LOCALES
        console.log('📋 [DIAG] 1. DATOS LOCALES:');
        const rsLocal = await pool.query(`
            SELECT id, id_presupuesto_ext, articulo, cantidad, valor1, precio1
            FROM public.presupuestos_detalles 
            WHERE id_presupuesto_ext = $1
            ORDER BY id
        `, ['06c76584']);
        
        console.log(`Encontrados ${rsLocal.rows.length} detalles locales\n`);
        
        // 2. LEER DATOS DE SHEETS
        console.log('📋 [DIAG] 2. DATOS DE SHEETS:');
        const config = { hoja_id: process.env.SPREADSHEET_ID };
        const existingSheetData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        console.log(`Leídas ${existingSheetData.rows?.length || 0} filas de Sheets\n`);
        
        // 3. FILTRAR SHEETS POR PRESUPUESTO 06c76584 (case-insensitive)
        const detalles06c76584Sheets = [];
        if (existingSheetData.rows) {
            existingSheetData.rows.forEach((row, index) => {
                const idPresupuesto = row[1]; // Columna B
                const idNormalizado = String(idPresupuesto || '').trim().toLowerCase();
                if (idNormalizado === '06c76584') {
                    detalles06c76584Sheets.push({
                        fila: index + 2, // +2 porque hay header y es 1-indexed
                        idDetalle: row[0], // Columna A
                        idPresupuestoRaw: row[1], // Columna B raw
                        idPresupuesto: idNormalizado, // Columna B normalizada
                        articuloRaw: row[2], // Columna C raw
                        articulo: row[2] // Columna C
                    });
                }
            });
        }
        
        console.log(`Encontrados ${detalles06c76584Sheets.length} detalles de 06c76584 en Sheets\n`);
        
        // 4. MOSTRAR MUESTRA LOCAL
        console.log('📋 [DIAG] 3. LOCAL (8 filas):');
        console.log('| CLAVE | CANTIDAD | VALOR1 | PRECIO1 |');
        console.log('|-------|----------|--------|---------|');
        
        const clavesLocales = [];
        rsLocal.rows.forEach(row => {
            const debug = normalizarClave(row.id_presupuesto_ext, row.articulo, true);
            clavesLocales.push({ clave: debug.clave, row, debug });
            console.log(`| ${debug.clave.padEnd(25)} | ${String(row.cantidad).padEnd(8)} | ${String(row.valor1).padEnd(6)} | ${String(row.precio1).padEnd(7)} |`);
        });
        
        console.log('');
        
        // 5. MOSTRAR MUESTRA SHEETS
        console.log('📋 [DIAG] 4. SHEETS (primeras 30 filas de 06c76584):');
        console.log('| FILA | ID_PRES_RAW | ID_PRES_NORM+LEN | ART_RAW | ART_NORM+LEN | ID_DETALLE |');
        console.log('|------|-------------|------------------|---------|--------------|------------|');
        
        const clavesSheets = new Map();
        detalles06c76584Sheets.slice(0, 30).forEach(item => {
            const debug = normalizarClave(item.idPresupuestoRaw, item.articuloRaw, true);
            clavesSheets.set(debug.clave, {
                fila: item.fila,
                idDetalle: item.idDetalle,
                debug
            });
            
            console.log(`| ${String(item.fila).padEnd(4)} | ${String(item.idPresupuestoRaw).padEnd(11)} | ${debug.idNorm}(${debug.idLength}) | ${String(item.articuloRaw).padEnd(7)} | ${debug.artNorm}(${debug.artLength}) | ${String(item.idDetalle).padEnd(10)} |`);
        });
        
        console.log('');
        
        // 6. CRUCE DE CLAVES
        console.log('📋 [DIAG] 5. CRUCE (8 claves locales):');
        console.log('| CLAVE_LOCAL | RESULTADO | FILA | ID_DETALLE | MOTIVO |');
        console.log('|-------------|-----------|------|------------|--------|');
        
        let foundCount = 0;
        let notFoundCount = 0;
        
        clavesLocales.forEach(({ clave, row, debug }) => {
            const match = clavesSheets.get(clave);
            
            if (match) {
                foundCount++;
                console.log(`| ${clave.padEnd(25)} | Found     | ${String(match.fila).padEnd(4)} | ${String(match.idDetalle).padEnd(10)} | OK |`);
            } else {
                notFoundCount++;
                console.log(`| ${clave.padEnd(25)} | Not Found | -    | -          | Ver análisis |`);
            }
        });
        
        console.log('');
        console.log(`📊 [DIAG] RESUMEN: ${foundCount} Found, ${notFoundCount} Not Found\n`);
        
        // 7. ANÁLISIS DETALLADO DE NOT FOUND
        if (notFoundCount > 0) {
            console.log('📋 [DIAG] 6. ANÁLISIS DETALLADO DE NOT FOUND:');
            
            clavesLocales.forEach(({ clave, row, debug }) => {
                const match = clavesSheets.get(clave);
                
                if (!match) {
                    console.log(`\n🔍 Clave local no encontrada: ${clave}`);
                    console.log(`   IdPresupuesto local: "${debug.idRaw}" → normalizado: "${debug.idNorm}" (len: ${debug.idLength})`);
                    console.log(`   Articulo local: "${debug.artRaw}" → normalizado: "${debug.artNorm}" (len: ${debug.artLength})`);
                    
                    // Analizar caracteres sospechosos
                    const charsId = analizarCaracteres(String(debug.idRaw), 'IdPresupuesto');
                    const charsArt = analizarCaracteres(String(debug.artRaw), 'Articulo');
                    
                    if (charsId.length > 0) {
                        console.log(`   Caracteres sospechosos en IdPresupuesto: ${charsId.join(', ')}`);
                    }
                    if (charsArt.length > 0) {
                        console.log(`   Caracteres sospechosos en Articulo: ${charsArt.join(', ')}`);
                    }
                    
                    // Buscar coincidencias parciales en Sheets
                    console.log('   Búsqueda de coincidencias parciales en Sheets:');
                    let encontroCoincidencia = false;
                    
                    detalles06c76584Sheets.forEach(item => {
                        const debugSheet = normalizarClave(item.idPresupuestoRaw, item.articuloRaw, true);
                        
                        // Verificar coincidencias parciales
                        if (debugSheet.idNorm === debug.idNorm || debugSheet.artNorm === debug.artNorm) {
                            console.log(`     - Coincidencia parcial: IdPres="${debugSheet.idRaw}" Art="${debugSheet.artRaw}"`);
                            console.log(`       Normalizado: "${debugSheet.clave}"`);
                            encontroCoincidencia = true;
                        }
                    });
                    
                    if (!encontroCoincidencia) {
                        console.log('     - No se encontraron coincidencias parciales');
                        console.log(`     - Motivo probable: El presupuesto 06c76584 no existe en Sheets`);
                    }
                }
            });
        }
        
        console.log('\n✅ [DIAG] Diagnóstico completado');
        
    } catch (error) {
        console.error('❌ [DIAG] Error:', error.message);
    } finally {
        await pool.end();
    }
}

diagnostico06c76584();
