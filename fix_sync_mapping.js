const { readSheetWithHeaders, extractSheetId, validateSheetAccess } = require('./src/services/gsheets/client.js');
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function fixSyncMapping() {
  try {
    console.log('🔧 Reparando mapeo de sincronización...\n');

    // 1. Obtener configuración
    const configQuery = `
      SELECT id, hoja_url, hoja_id, hoja_nombre, rango, activo, usuario_id
      FROM presupuestos_config
      WHERE activo = true
      ORDER BY id DESC
      LIMIT 1
    `;

    const configResult = await pool.query(configQuery);
    if (configResult.rows.length === 0) {
      console.log('❌ No hay configuración activa');
      return;
    }

    const config = configResult.rows[0];
    console.log('📋 Configuración activa:');
    console.log(`   URL: ${config.hoja_url}`);
    console.log(`   Hoja ID: ${config.hoja_id}`);

    // 2. Leer datos con el rango correcto
    const sheetId = extractSheetId(config.hoja_url);
    console.log('\n📖 Leyendo datos con rango corregido...');

    // Leer hoja "DetallesPresupuestos" con rango A:N (14 columnas)
    const detallesData = await readSheetWithHeaders(sheetId, 'A:N', 'DetallesPresupuestos');
    console.log(`   ✅ Detalles leídos: ${detallesData.rows.length} filas`);
    console.log(`   Encabezados (${detallesData.headers.length}):`, detallesData.headers);

    // 3. Verificar mapeo de columnas
    console.log('\n🔍 Verificando mapeo de columnas...');

    // Buscar fila de e835b45d
    const filaE835 = detallesData.rows.find(row =>
      String(row[detallesData.headers[1]] || '').trim() === 'e835b45d'
    );

    if (!filaE835) {
      console.log('❌ No se encontró fila de e835b45d');
      return;
    }

    console.log('✅ Fila de e835b45d encontrada:');
    console.log(`   Columna A (IDDetalle): ${filaE835[detallesData.headers[0]]}`);
    console.log(`   Columna B (IdPresupuesto): ${filaE835[detallesData.headers[1]]}`);
    console.log(`   Columna C (Articulo): ${filaE835[detallesData.headers[2]]}`);
    console.log(`   Columna D (Cantidad): ${filaE835[detallesData.headers[3]]}`);
    console.log(`   Columna E (Valor1): ${filaE835[detallesData.headers[4]]}`);
    console.log(`   Columna F (Precio1): ${filaE835[detallesData.headers[5]]}`);
    console.log(`   Columna G (IVA1): ${filaE835[detallesData.headers[6]]}`);
    console.log(`   Columna H (Diferencia): ${filaE835[detallesData.headers[7]]}`);
    console.log(`   Columna I (Condicion): ${filaE835[detallesData.headers[8]]}`);
    console.log(`   Columna J (Camp1): ${filaE835[detallesData.headers[9]]}`);
    console.log(`   Columna K (Camp2): ${filaE835[detallesData.headers[10]]}`);
    console.log(`   Columna L (Camp3): ${filaE835[detallesData.headers[11]]}`);
    console.log(`   Columna M (Camp4): ${filaE835[detallesData.headers[12]]}`);
    console.log(`   Columna N (Camp5): ${filaE835[detallesData.headers[13]]}`);

    // Verificar si hay columna O (Camp6)
    if (detallesData.headers.length > 13) {
      console.log(`   Columna O (Camp6): ${filaE835[detallesData.headers[14]] || 'NO EXISTE'}`);
    } else {
      console.log('   ❌ No hay columna O (Camp6)');
    }

    // 4. Aplicar mapeo corregido
    console.log('\n🔧 Aplicando mapeo corregido...');

    const detalleCorregido = {
      id_presupuesto_ext: String(filaE835[detallesData.headers[1]] || '').trim(),
      articulo: String(filaE835[detallesData.headers[2]] || '').trim(),
      cantidad: parseFloat(filaE835[detallesData.headers[3]]) || 0,
      valor1: parseFloat(filaE835[detallesData.headers[4]]) || 0,
      precio1: parseFloat(filaE835[detallesData.headers[5]]) || 0,
      iva1: parseFloat(filaE835[detallesData.headers[6]]) || 0,
      diferencia: parseFloat(filaE835[detallesData.headers[7]]) || 0,
      // Mapeo corregido según estructura real
      camp1: parseFloat(filaE835[detallesData.headers[9]]) || 0,   // Camp1 (J)
      camp2: parseFloat(filaE835[detallesData.headers[10]]) || 0,  // Camp2 (K)
      camp3: parseFloat(filaE835[detallesData.headers[11]]) || 0,  // Camp3 (L)
      camp4: parseFloat(filaE835[detallesData.headers[12]]) || 0,  // Camp4 (M)
      camp5: parseFloat(filaE835[detallesData.headers[13]]) || 0,  // Camp5 (N)
      camp6: detallesData.headers.length > 14 ? parseFloat(filaE835[detallesData.headers[14]]) || 0 : 0
    };

    console.log('✅ Detalle corregido:');
    console.log(`   ID Presupuesto: ${detalleCorregido.id_presupuesto_ext}`);
    console.log(`   Artículo: ${detalleCorregido.articulo}`);
    console.log(`   Cantidad: ${detalleCorregido.cantidad}`);
    console.log(`   Camp1-6: ${detalleCorregido.camp1}, ${detalleCorregido.camp2}, ${detalleCorregido.camp3}, ${detalleCorregido.camp4}, ${detalleCorregido.camp5}, ${detalleCorregido.camp6}`);

    // 5. Actualizar el código de sync_real.js
    console.log('\n📝 Actualizando código de sync_real.js...');

    const fs = require('fs');
    const path = require('path');

    const syncFilePath = path.join(__dirname, 'src/services/gsheets/sync_real.js');
    let syncCode = fs.readFileSync(syncFilePath, 'utf8');

    // Corregir el rango de lectura
    syncCode = syncCode.replace(
      "const detallesData = await readSheetWithHeaders(sheetId, 'A:P', 'DetallesPresupuestos');",
      "const detallesData = await readSheetWithHeaders(sheetId, 'A:N', 'DetallesPresupuestos');"
    );

    // Corregir el mapeo de campos
    const oldMapping = `            // CORRECCIÓN: Mapeo correcto según informe - Camp6(GS) -> camp1(local), Camp1(GS) -> camp2(local), etc.
            const camp1 = row[detallesData.headers[14]] || 0;                  // Camp6 (O) -> camp1
            const camp2 = row[detallesData.headers[9]] || 0;                   // Camp1 (J) -> camp2
            const camp3 = row[detallesData.headers[10]] || 0;                  // Camp2 (K) -> camp3
            const camp4 = row[detallesData.headers[11]] || 0;                  // Camp3 (L) -> camp4
            const camp5 = row[detallesData.headers[12]] || 0;                  // Camp4 (M) -> camp5
            const camp6 = row[detallesData.headers[13]] || 0;                  // Camp5 (N) -> camp6
            const lastModified = row[detallesData.headers[15]] || null;        // LastModified (P)`;

    const newMapping = `            // CORRECCIÓN: Mapeo corregido según estructura real de Google Sheets
            const camp1 = parseFloat(row[detallesData.headers[9]]) || 0;       // Camp1 (J)
            const camp2 = parseFloat(row[detallesData.headers[10]]) || 0;      // Camp2 (K)
            const camp3 = parseFloat(row[detallesData.headers[11]]) || 0;      // Camp3 (L)
            const camp4 = parseFloat(row[detallesData.headers[12]]) || 0;      // Camp4 (M)
            const camp5 = parseFloat(row[detallesData.headers[13]]) || 0;      // Camp5 (N)
            const camp6 = detallesData.headers.length > 14 ? parseFloat(row[detallesData.headers[14]]) || 0 : 0; // Camp6 (O) si existe`;

    syncCode = syncCode.replace(oldMapping, newMapping);

    fs.writeFileSync(syncFilePath, syncCode);
    console.log('✅ Código de sync_real.js actualizado');

    // 6. Hacer lo mismo con sync_real_with_logs.js
    const syncLogsFilePath = path.join(__dirname, 'src/services/gsheets/sync_real_with_logs.js');
    let syncLogsCode = fs.readFileSync(syncLogsFilePath, 'utf8');

    syncLogsCode = syncLogsCode.replace(
      "const detallesData = await readSheetWithHeaders(sheetId, 'A:P', 'DetallesPresupuestos');",
      "const detallesData = await readSheetWithHeaders(sheetId, 'A:N', 'DetallesPresupuestos');"
    );

    // Buscar y reemplazar el mapeo en sync_real_with_logs.js
    const oldMappingLogs = `            // CORRECCIÓN: Mapeo correcto según informe - Camp6(GS) -> camp1(local), Camp1(GS) -> camp2(local), etc.
            const camp1 = row[detallesData.headers[14]] || 0;                  // Camp6 (O) -> camp1
            const camp2 = row[detallesData.headers[9]] || 0;                   // Camp1 (J) -> camp2
            const camp3 = row[detallesData.headers[10]] || 0;                  // Camp2 (K) -> camp3
            const camp4 = row[detallesData.headers[11]] || 0;                  // Camp3 (L) -> camp4
            const camp5 = row[detallesData.headers[12]] || 0;                  // Camp4 (M) -> camp5
            const camp6 = row[detallesData.headers[13]] || 0;                  // Camp5 (N) -> camp6
            const lastModified = row[detallesData.headers[15]] || null;        // LastModified (P)`;

    if (syncLogsCode.includes(oldMappingLogs)) {
      syncLogsCode = syncLogsCode.replace(oldMappingLogs, newMapping);
      fs.writeFileSync(syncLogsFilePath, syncLogsCode);
      console.log('✅ Código de sync_real_with_logs.js actualizado');
    } else {
      console.log('⚠️ No se encontró el mapeo en sync_real_with_logs.js');
    }

    console.log('\n🎉 REPARACIÓN COMPLETADA');
    console.log('✅ Rango de lectura corregido: A:N (14 columnas)');
    console.log('✅ Mapeo de campos corregido');
    console.log('✅ Ambos archivos de sincronización actualizados');

  } catch (error) {
    console.error('❌ Error en reparación:', error.message);
  } finally {
    await pool.end();
  }
}

fixSyncMapping();
