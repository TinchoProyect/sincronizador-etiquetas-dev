/**
 * Servicio de escritura a Google Sheets para presupuestos
 * Maneja escritura atómica en dos hojas: Presupuestos y DetallesPresupuestos
 */

const { getSheets } = require('../../google/gsheetsClient');
const { formatRowForSheets } = require('./normalizer');

console.log('🔍 [SHEETS-WRITER] Configurando servicio de escritura...');

// Configuración de hojas y rangos
const SHEETS_CONFIG = {
    PRESUPUESTOS: {
        name: 'Presupuestos',
        range: 'A:M',
        headers: [
            'IDPresupuesto', 'Fecha', 'IDCliente', 'Agente', 'Fecha de entrega',
            'Factura/Efectivo', 'Nota', 'Estado', 'InformeGenerado', 'ClienteNuevoID',
            'Estado/ImprimePDF', 'PuntoEntrega', 'Descuento'
        ]
    },
    DETALLES: {
        name: 'DetallesPresupuestos',
        range: 'A:N',
        headers: [
            'IDDetallePresupuesto', 'IdPresupuesto', 'Articulo', 'Cantidad', 'Valor1',
            'Precio1', 'IVA1', 'Diferencia', 'Condicion', 'Camp1', 'Camp2', 'Camp3',
            'Camp4', 'Camp5'
        ]
    }
};

/**
 * Obtener ID de spreadsheet desde variables de entorno
 */
function getSpreadsheetId() {
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    if (!spreadsheetId) {
        throw new Error('SPREADSHEET_ID no configurado en variables de entorno');
    }
    
    console.log('📋 [SHEETS-WRITER] Usando Spreadsheet ID:', spreadsheetId);
    return spreadsheetId;
}

/**
 * Escribir encabezado de presupuesto en hoja "Presupuestos"
 * @param {Object} presupuesto - Datos normalizados del presupuesto
 * @returns {Promise<Object>} Resultado de la operación
 */
async function writePresupuestoHeader(presupuesto) {
    console.log('🔍 [SHEETS-WRITER] Escribiendo encabezado de presupuesto...');
    console.log('📋 [SHEETS-WRITER] ID:', presupuesto.id_presupuesto_ext);
    
    try {
        const sheets = await getSheets();
        const spreadsheetId = getSpreadsheetId();
        
        // Preparar fila de datos según mapeo de columnas A:M
        const rowData = formatRowForSheets([
            presupuesto.id_presupuesto_ext,     // A: IDPresupuesto
            presupuesto.fecha,                  // B: Fecha
            presupuesto.id_cliente,             // C: IDCliente
            presupuesto.agente,                 // D: Agente
            presupuesto.fecha_entrega,          // E: Fecha de entrega
            presupuesto.tipo_comprobante,       // F: Factura/Efectivo
            presupuesto.nota,                   // G: Nota
            presupuesto.estado,                 // H: Estado
            presupuesto.informe_generado,       // I: InformeGenerado
            presupuesto.cliente_nuevo_id,       // J: ClienteNuevoID
            '',                                 // K: Estado/ImprimePDF (campo adicional)
            presupuesto.punto_entrega,          // L: PuntoEntrega
            presupuesto.descuento               // M: Descuento
        ]);
        
        console.log('📤 [SHEETS-WRITER] Datos a escribir:', rowData);
        
        // Escribir en la hoja
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: `${SHEETS_CONFIG.PRESUPUESTOS.name}!${SHEETS_CONFIG.PRESUPUESTOS.range}`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [rowData]
            }
        });
        
        console.log('✅ [SHEETS-WRITER] Encabezado escrito exitosamente');
        console.log('📊 [SHEETS-WRITER] Rango actualizado:', response.data.updates.updatedRange);
        
        return {
            success: true,
            range: response.data.updates.updatedRange,
            rowsAdded: response.data.updates.updatedRows,
            presupuestoId: presupuesto.id_presupuesto_ext
        };
        
    } catch (error) {
        console.error('❌ [SHEETS-WRITER] Error escribiendo encabezado:', error.message);
        throw new Error(`Error escribiendo encabezado: ${error.message}`);
    }
}

/**
 * Escribir detalles de presupuesto en hoja "DetallesPresupuestos"
 * @param {Array} detalles - Array de detalles normalizados
 * @returns {Promise<Object>} Resultado de la operación
 */
async function writePresupuestoDetails(detalles) {
    console.log('🔍 [SHEETS-WRITER] Escribiendo detalles de presupuesto...');
    console.log('📋 [SHEETS-WRITER] Cantidad de detalles:', detalles.length);
    
    try {
        const sheets = await getSheets();
        const spreadsheetId = getSpreadsheetId();
        
        // Preparar filas de datos según mapeo de columnas A:N
        const rowsData = detalles.map((detalle, index) => {
            const rowData = formatRowForSheets([
                detalle.id_detalle_presupuesto,    // A: IDDetallePresupuesto
                detalle.id_presupuesto,            // B: IdPresupuesto
                detalle.articulo,                  // C: Articulo
                detalle.cantidad,                  // D: Cantidad
                detalle.valor1,                    // E: Valor1
                detalle.precio1,                   // F: Precio1
                detalle.iva1,                      // G: IVA1
                detalle.diferencia,                // H: Diferencia
                detalle.condicion,                 // I: Condicion
                detalle.camp1,                     // J: Camp1
                detalle.camp2,                     // K: Camp2
                detalle.camp3,                     // L: Camp3
                detalle.camp4,                     // M: Camp4
                detalle.camp5                      // N: Camp5
            ]);
            
            console.log(`📤 [SHEETS-WRITER] Detalle ${index + 1}:`, detalle.articulo);
            
            return rowData;
        });
        
        // Escribir todos los detalles en una sola operación
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: `${SHEETS_CONFIG.DETALLES.name}!${SHEETS_CONFIG.DETALLES.range}`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: rowsData
            }
        });
        
        console.log('✅ [SHEETS-WRITER] Detalles escritos exitosamente');
        console.log('📊 [SHEETS-WRITER] Rango actualizado:', response.data.updates.updatedRange);
        console.log('📊 [SHEETS-WRITER] Filas agregadas:', response.data.updates.updatedRows);
        
        return {
            success: true,
            range: response.data.updates.updatedRange,
            rowsAdded: response.data.updates.updatedRows,
            detallesCount: detalles.length
        };
        
    } catch (error) {
        console.error('❌ [SHEETS-WRITER] Error escribiendo detalles:', error.message);
        throw new Error(`Error escribiendo detalles: ${error.message}`);
    }
}

/**
 * Actualizar estado de presupuesto en hoja "Presupuestos"
 * @param {string} presupuestoId - ID del presupuesto
 * @param {string} nuevoEstado - Nuevo estado
 * @returns {Promise<Object>} Resultado de la operación
 */
async function updatePresupuestoEstado(presupuestoId, nuevoEstado) {
    console.log('🔍 [SHEETS-WRITER] Actualizando estado de presupuesto...');
    console.log('📋 [SHEETS-WRITER] ID:', presupuestoId, 'Nuevo estado:', nuevoEstado);
    
    try {
        const sheets = await getSheets();
        const spreadsheetId = getSpreadsheetId();
        
        // Primero, buscar la fila del presupuesto
        const searchResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${SHEETS_CONFIG.PRESUPUESTOS.name}!A:H`
        });
        
        const rows = searchResponse.data.values || [];
        let targetRow = -1;
        
        // Buscar fila por ID (columna A)
        for (let i = 1; i < rows.length; i++) { // Empezar desde 1 para saltar encabezados
            if (rows[i][0] === presupuestoId) {
                targetRow = i + 1; // +1 porque las filas en Sheets empiezan desde 1
                break;
            }
        }
        
        if (targetRow === -1) {
            throw new Error(`Presupuesto ${presupuestoId} no encontrado en la hoja`);
        }
        
        console.log('📍 [SHEETS-WRITER] Presupuesto encontrado en fila:', targetRow);
        
        // Actualizar solo la columna H (Estado)
        const updateResponse = await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: `${SHEETS_CONFIG.PRESUPUESTOS.name}!H${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[nuevoEstado]]
            }
        });
        
        console.log('✅ [SHEETS-WRITER] Estado actualizado exitosamente');
        console.log('📊 [SHEETS-WRITER] Rango actualizado:', updateResponse.data.updatedRange);
        
        return {
            success: true,
            range: updateResponse.data.updatedRange,
            presupuestoId: presupuestoId,
            nuevoEstado: nuevoEstado,
            fila: targetRow
        };
        
    } catch (error) {
        console.error('❌ [SHEETS-WRITER] Error actualizando estado:', error.message);
        throw new Error(`Error actualizando estado: ${error.message}`);
    }
}

/**
 * Remover encabezado de presupuesto (para rollback)
 * @param {string} presupuestoId - ID del presupuesto a remover
 * @returns {Promise<Object>} Resultado de la operación
 */
async function removePresupuestoHeader(presupuestoId) {
    console.log('🔍 [SHEETS-WRITER] Removiendo encabezado para rollback...');
    console.log('📋 [SHEETS-WRITER] ID:', presupuestoId);
    
    try {
        const sheets = await getSheets();
        const spreadsheetId = getSpreadsheetId();
        
        // Buscar la fila del presupuesto
        const searchResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${SHEETS_CONFIG.PRESUPUESTOS.name}!A:A`
        });
        
        const rows = searchResponse.data.values || [];
        let targetRow = -1;
        
        // Buscar fila por ID
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] === presupuestoId) {
                targetRow = i;
                break;
            }
        }
        
        if (targetRow === -1) {
            console.log('⚠️ [SHEETS-WRITER] Presupuesto no encontrado para rollback:', presupuestoId);
            return {
                success: true,
                message: 'Presupuesto no encontrado (posiblemente ya removido)',
                presupuestoId: presupuestoId
            };
        }
        
        console.log('📍 [SHEETS-WRITER] Removiendo fila:', targetRow + 1);
        
        // Eliminar la fila
        const deleteResponse = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: spreadsheetId,
            resource: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: 0, // Asumiendo que "Presupuestos" es la primera hoja
                            dimension: 'ROWS',
                            startIndex: targetRow,
                            endIndex: targetRow + 1
                        }
                    }
                }]
            }
        });
        
        console.log('✅ [SHEETS-WRITER] Encabezado removido exitosamente (rollback)');
        
        return {
            success: true,
            presupuestoId: presupuestoId,
            filaRemovida: targetRow + 1,
            rollback: true
        };
        
    } catch (error) {
        console.error('❌ [SHEETS-WRITER] Error en rollback:', error.message);
        
        // En caso de error en rollback, marcar como ERROR en lugar de eliminar
        try {
            await updatePresupuestoEstado(presupuestoId, 'ERROR');
            console.log('⚠️ [SHEETS-WRITER] Rollback fallido, marcado como ERROR');
            
            return {
                success: false,
                error: error.message,
                fallbackAction: 'Marcado como ERROR',
                presupuestoId: presupuestoId
            };
        } catch (fallbackError) {
            console.error('❌ [SHEETS-WRITER] Error en fallback:', fallbackError.message);
            throw new Error(`Error en rollback y fallback: ${error.message}`);
        }
    }
}

/**
 * Verificar conectividad con Google Sheets
 * @returns {Promise<Object>} Estado de la conexión
 */
async function testConnection() {
    console.log('🔍 [SHEETS-WRITER] Verificando conexión...');
    
    try {
        const sheets = await getSheets();
        const spreadsheetId = getSpreadsheetId();
        
        // Intentar leer metadatos del spreadsheet
        const response = await sheets.spreadsheets.get({
            spreadsheetId: spreadsheetId,
            fields: 'properties,sheets.properties'
        });
        
        const spreadsheet = response.data;
        const availableSheets = spreadsheet.sheets.map(sheet => sheet.properties.title);
        
        console.log('✅ [SHEETS-WRITER] Conexión exitosa');
        console.log('📋 [SHEETS-WRITER] Spreadsheet:', spreadsheet.properties.title);
        console.log('📋 [SHEETS-WRITER] Hojas disponibles:', availableSheets);
        
        // Verificar que las hojas requeridas existen
        const requiredSheets = [SHEETS_CONFIG.PRESUPUESTOS.name, SHEETS_CONFIG.DETALLES.name];
        const missingSheets = requiredSheets.filter(sheet => !availableSheets.includes(sheet));
        
        if (missingSheets.length > 0) {
            console.log('⚠️ [SHEETS-WRITER] Hojas faltantes:', missingSheets);
        }
        
        return {
            success: true,
            spreadsheetTitle: spreadsheet.properties.title,
            availableSheets: availableSheets,
            requiredSheets: requiredSheets,
            missingSheets: missingSheets,
            isReady: missingSheets.length === 0
        };
        
    } catch (error) {
        console.error('❌ [SHEETS-WRITER] Error de conexión:', error.message);
        
        return {
            success: false,
            error: error.message,
            isReady: false
        };
    }
}

console.log('✅ [SHEETS-WRITER] Servicio de escritura configurado');

module.exports = {
    writePresupuestoHeader,
    writePresupuestoDetails,
    updatePresupuestoEstado,
    removePresupuestoHeader,
    testConnection,
    SHEETS_CONFIG
};
