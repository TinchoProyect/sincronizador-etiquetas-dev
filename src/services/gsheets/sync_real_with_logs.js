const { readSheetWithHeaders, extractSheetId, validateSheetAccess } = require('./client_with_logs');

console.log('[PRESUPUESTOS-BACK] Configurando servicio de sincronización para presupuestos...');

/**
 * Servicio de sincronización con Google Sheets para presupuestos
 * Maneja la sincronización de presupuestos y sus detalles desde Google Sheets
 */

/**
 * Sincronizar datos desde Google Sheets
 */
async function syncFromGoogleSheets(config, db) {
    console.log('[PRESUPUESTOS-BACK] ===== INICIANDO SINCRONIZACIÓN DESDE GOOGLE SHEETS =====');
    console.log('[PRESUPUESTOS-BACK] Configuración recibida:', {
        hoja_url: config.hoja_url,
        rango: config.rango,
        hoja_id: config.hoja_id,
        hoja_nombre: config.hoja_nombre,
        config_id: config.id,
        usuario_id: config.usuario_id
    });

    // 🔍 LOG PUNTO 1: Inicio de conexión a Google Sheets
    console.log('[PRESUPUESTOS-BACK] PUNTO 1: Iniciando conexión con Google Sheets');
    console.log('[PRESUPUESTOS-BACK] ID del archivo recibido:', config.hoja_id);
    console.log('[PRESUPUESTOS-BACK] URL construida:', config.hoja_url);
    console.log('[PRESUPUESTOS-BACK] Archivo objetivo: Presupuestos.xlsm');
    console.log('[PRESUPUESTOS-BACK] ¿La URL contiene "Presupuestos"?', config.hoja_url.includes('Presupuestos'));

    const syncLog = {
        config_id: config.id,
        registros_procesados: 0,
        registros_nuevos: 0,
        registros_actualizados: 0,
        errores: [],
        fecha_sync: new Date(),
        exitoso: false,
        usuario_id: config.usuario_id || null
    };

    try {
        // 1. Validar acceso a la hoja
        console.log('[PRESUPUESTOS-BACK] Validando acceso a Google Sheets...');
        console.log('[PRESUPUESTOS-BACK] PUNTO 3: Extrayendo ID de documento desde URL');
        const sheetId = extractSheetId(config.hoja_url);
        console.log('[PRESUPUESTOS-BACK] ID de documento detectado:', sheetId);
        console.log('[PRESUPUESTOS-BACK] ¿Coincide con el esperado? Verificando...');

        console.log('[PRESUPUESTOS-BACK] PUNTO 3: Validando acceso a la hoja');
        const accessValidation = await validateSheetAccess(sheetId);
        console.log('[PRESUPUESTOS-BACK] Resultado de validación:', accessValidation);

        if (!accessValidation.hasAccess) {
            console.log('[PRESUPUESTOS-BACK] ❌ ACCESO DENEGADO:', accessValidation.error);
            throw new Error(`No se puede acceder a la hoja: ${accessValidation.error}`);
        }

        console.log('[PRESUPUESTOS-BACK] ✅ Acceso validado al documento:', accessValidation.sheetTitle);
        console.log('[PRESUPUESTOS-BACK] Hojas disponibles en el documento:', accessValidation.availableSheets);
        console.log('[PRESUPUESTOS-BACK] ¿Contiene hoja "Presupuestos"?', accessValidation.availableSheets.includes('Presupuestos'));
        console.log('[PRESUPUESTOS-BACK] ¿Contiene hoja "DetallesPresupuestos"?', accessValidation.availableSheets.includes('DetallesPresupuestos'));

        // 2. Leer datos desde Google Sheets - AMBAS HOJAS
        console.log('[PRESUPUESTOS-BACK] Leyendo datos desde Google Sheets...');
        console.log('[PRESUPUESTOS-BACK] PUNTO 4: Intentando leer AMBAS hojas del archivo');

        // 2.1 Leer hoja "Presupuestos"
        console.log('[PRESUPUESTOS-BACK] PUNTO 4A: Intentando leer hoja "Presupuestos"');
        console.log('[PRESUPUESTOS-BACK] Parámetros para hoja Presupuestos:', {
            sheetId: sheetId,
            rango: 'A:M', // IDPresupuesto hasta Descuento
            hoja_nombre: 'Presupuestos'
        });

        const presupuestosData = await readSheetWithHeaders(sheetId, 'A:M', 'Presupuestos');

        console.log('[PRESUPUESTOS-BACK] PUNTO 5A: Datos de hoja "Presupuestos" leídos');
        console.log('[PRESUPUESTOS-BACK] Encabezados Presupuestos:', presupuestosData.headers);
        console.log('[PRESUPUESTOS-BACK] Total filas Presupuestos:', presupuestosData.rows.length);
        console.log('[PRESUPUESTOS-BACK] Primeras 2 filas Presupuestos:', presupuestosData.rows.slice(0, 2));
        console.log('[PRESUPUESTOS-BACK] ¿Se leyeron datos de Presupuestos?', presupuestosData.rows.length > 0);

        // 2.2 Leer hoja "DetallesPresupuestos"
        console.log('[PRESUPUESTOS-BACK] PUNTO 4B: Intentando leer hoja "DetallesPresupuestos"');
        console.log('[PRESUPUESTOS-BACK] Parámetros para hoja DetallesPresupuestos:', {
            sheetId: sheetId,
            rango: 'A:P', // IDDetallePresupuesto hasta LastModified
            hoja_nombre: 'DetallesPresupuestos'
        });

        const detallesData = await readSheetWithHeaders(sheetId, 'A:P', 'DetallesPresupuestos');

        console.log('[PRESUPUESTOS-BACK] PUNTO 5B: Datos de hoja "DetallesPresupuestos" leídos');
        console.log('[PRESUPUESTOS-BACK] Encabezados DetallesPresupuestos:', detallesData.headers);
        console.log('[PRESUPUESTOS-BACK] Total filas DetallesPresupuestos:', detallesData.rows.length);
        console.log('[PRESUPUESTOS-BACK] Primeras 2 filas DetallesPresupuestos:', detallesData.rows.slice(0, 2));
        console.log('[PRESUPUESTOS-BACK] ¿Se leyeron datos de DetallesPresupuestos?', detallesData.rows.length > 0);

        // 2.3 Validar que al menos una hoja tenga datos
        if (presupuestosData.rows.length === 0 && detallesData.rows.length === 0) {
            console.log('[PRESUPUESTOS-BACK] ⚠️ No se encontraron datos en ninguna hoja para sincronizar');
            console.log('[PRESUPUESTOS-BACK] ❌ RESULTADO FINAL: 0 registros en ambas hojas - revisar estructura');
            console.log('[PRESUPUESTOS-BACK] Posibles causas:');
            console.log('[PRESUPUESTOS-BACK] - Las hojas están vacías');
            console.log('[PRESUPUESTOS-BACK] - Los nombres de las hojas no coinciden exactamente');
            console.log('[PRESUPUESTOS-BACK] - Los rangos especificados están fuera de los datos');
            syncLog.exitoso = true;
            return syncLog;
        }

        console.log(`[PRESUPUESTOS-BACK] ✅ Datos leídos - Presupuestos: ${presupuestosData.rows.length}, Detalles: ${detallesData.rows.length}`);
        syncLog.registros_procesados = presupuestosData.rows.length + detallesData.rows.length;

        // 3. Mapear datos a estructura de presupuestos usando AMBAS hojas
        console.log('[PRESUPUESTOS-BACK] Mapeando datos de AMBAS hojas a estructura de presupuestos...');
        const presupuestosMapeados = mapTwoSheetsToPresupuestos(presupuestosData, detallesData, config);

        console.log(`[PRESUPUESTOS-BACK] Presupuestos mapeados: ${presupuestosMapeados.length} registros válidos`);

        // 4. Iniciar transacción de base de datos
        console.log('[PRESUPUESTOS-BACK] Iniciando transacción de base de datos...');
        await db.query('BEGIN');

        try {
            // 5. Procesar cada presupuesto
            for (let i = 0; i < presupuestosMapeados.length; i++) {
                const presupuestoData = presupuestosMapeados[i];
                console.log(`[PRESUPUESTOS-BACK] Procesando presupuesto ${i + 1}/${presupuestosMapeados.length}: ${presupuestoData.presupuesto.id_presupuesto_ext}`);

                try {
                    const resultado = await upsertPresupuesto(db, presupuestoData, config);

                    if (resultado.isNew) {
                        syncLog.registros_nuevos++;
                        console.log(`[PRESUPUESTOS-BACK] ✅ Nuevo presupuesto creado: ${presupuestoData.presupuesto.id_presupuesto_ext}`);
                    } else {
                        syncLog.registros_actualizados++;
                        console.log(`[PRESUPUESTOS-BACK] 🔄 Presupuesto actualizado: ${presupuestoData.presupuesto.id_presupuesto_ext}`);
                    }
                } catch (recordError) {
                    console.error(`[PRESUPUESTOS-BACK] ❌ Error en presupuesto ${i + 1}:`, recordError.message);
                    syncLog.errores.push(`Presupuesto ${presupuestoData.presupuesto.id_presupuesto_ext}: ${recordError.message}`);
                }
            }

            // 6. Confirmar transacción
            await db.query('COMMIT');
            console.log('[PRESUPUESTOS-BACK] ✅ Transacción confirmada');

            syncLog.exitoso = true;

        } catch (dbError) {
            // Revertir transacción en caso de error
            await db.query('ROLLBACK');
            console.error('[PRESUPUESTOS-BACK] ❌ Error en transacción, rollback realizado:', dbError.message);
            throw dbError;
        }

    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error en sincronización:', error.message);
        console.log('[PRESUPUESTOS-BACK] Stack trace completo:', error.stack);
        syncLog.errores.push(`Error general: ${error.message}`);
        syncLog.exitoso = false;
    }

    // 7. Registrar log de sincronización
    try {
        await registrarLogSincronizacion(db, syncLog);
        console.log('[PRESUPUESTOS-BACK] 📝 Log de sincronización registrado');
    } catch (logError) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al registrar log:', logError.message);
    }

    // 8. Resumen final
    console.log('[PRESUPUESTOS-BACK] 🏁 Sincronización completada:');
    console.log(`[PRESUPUESTOS-BACK]    - Registros procesados: ${syncLog.registros_procesados}`);
    console.log(`[PRESUPUESTOS-BACK]    - Registros nuevos: ${syncLog.registros_nuevos}`);
    console.log(`[PRESUPUESTOS-BACK]    - Registros actualizados: ${syncLog.registros_actualizados}`);
    console.log(`[PRESUPUESTOS-BACK]    - Errores: ${syncLog.errores.length}`);
    console.log(`[PRESUPUESTOS-BACK]    - Exitoso: ${syncLog.exitoso ? 'Sí' : 'No'}`);

    return syncLog;
}

/**
 * Mapear datos de DOS hojas de Google Sheets a estructura de presupuestos
 * Hoja 1: Presupuestos (IDPresupuesto, Fecha, IDCliente, Agente, etc.)
 * Hoja 2: DetallesPresupuestos (IDDetallePresupuesto, IdPresupuesto, Articulo, etc.)
 */
function mapTwoSheetsToPresupuestos(presupuestosData, detallesData, config) {
    console.log('[PRESUPUESTOS-BACK] Mapeando datos de DOS hojas de Google Sheets...');
    console.log('[PRESUPUESTOS-BACK] PUNTO 6: Iniciando mapeo de ambas hojas');

    const presupuestosMap = new Map();
    let presupuestosOmitidos = 0;
    let detallesOmitidos = 0;
    let detallesHuerfanos = 0;

    // PASO 1: Procesar hoja "Presupuestos"
    console.log('[PRESUPUESTOS-BACK] PUNTO 6A: Procesando hoja "Presupuestos"');
    console.log('[PRESUPUESTOS-BACK] Encabezados Presupuestos:', presupuestosData.headers);
    console.log('[PRESUPUESTOS-BACK] Total filas a procesar:', presupuestosData.rows.length);

    for (let i = 0; i < presupuestosData.rows.length; i++) {
        const row = presupuestosData.rows[i];

        try {
            // Mapeo según especificación: IDPresupuesto, Fecha, IDCliente, Agente, Fecha de entrega, Factura/Efectivo, Nota, Estado, InformeGenerado, ClienteNuevoID, Estado/ImprimePDF, PuntoEntrega, Descuento
            const id_presupuesto_ext = row[presupuestosData.headers[0]] || ''; // IDPresupuesto
            const fecha = row[presupuestosData.headers[1]] || null;            // Fecha
            const id_cliente = row[presupuestosData.headers[2]] || '';         // IDCliente
            const agente = row[presupuestosData.headers[3]] || null;           // Agente
            const fecha_entrega = row[presupuestosData.headers[4]] || null;    // Fecha de entrega
            const tipo_comprobante = row[presupuestosData.headers[5]] || null; // Factura/Efectivo
            const nota = row[presupuestosData.headers[6]] || null;             // Nota
            const estado = row[presupuestosData.headers[7]] || 'pendiente';    // Estado
            const informe_generado = row[presupuestosData.headers[8]] || null; // InformeGenerado
            const cliente_nuevo_id = row[presupuestosData.headers[9]] || null; // ClienteNuevoID
            const estado_imprime = row[presupuestosData.headers[10]] || null;  // Estado/ImprimePDF
            const punto_entrega = row[presupuestosData.headers[11]] || null;   // PuntoEntrega
            const descuento = row[presupuestosData.headers[12]] || 0;          // Descuento

            console.log(`[PRESUPUESTOS-BACK] Procesando presupuesto fila ${i + 2}:`, {
                id_presupuesto_ext: `"${id_presupuesto_ext}"`,
                id_cliente: `"${id_cliente}"`,
                agente: `"${agente}"`,
                estado: `"${estado}"`
            });

            // CORRECCIÓN: Validación menos restrictiva - solo verificar que no estén completamente vacíos
            const id_presupuesto_clean = String(id_presupuesto_ext || '').trim();
            const id_cliente_clean = String(id_cliente || '').trim();

            if (!id_presupuesto_clean) {
                console.log(`[PRESUPUESTOS-BACK] ⚠️ Fila ${i + 2}: ID presupuesto vacío, omitiendo`);
                console.log(`[PRESUPUESTOS-BACK] Datos de la fila:`, row);
                presupuestosOmitidos++;
                continue;
            }

            // CORRECCIÓN: Permitir id_cliente vacío pero con warning
            if (!id_cliente_clean) {
                console.log(`[PRESUPUESTOS-BACK] ⚠️ Fila ${i + 2}: ID cliente vacío para presupuesto ${id_presupuesto_clean}, usando 'SIN_CLIENTE'`);
            }

            const presupuestoKey = id_presupuesto_clean;

            const presupuesto = {
                id_presupuesto_ext: id_presupuesto_clean,
                id_cliente: id_cliente_clean || 'SIN_CLIENTE',
                fecha: parseDate(fecha),
                fecha_entrega: parseDate(fecha_entrega),
                agente: agente,
                tipo_comprobante: tipo_comprobante,
                nota: nota,
                estado: estado,
                informe_generado: informe_generado,
                cliente_nuevo_id: cliente_nuevo_id,
                punto_entrega: punto_entrega,
                descuento: parseFloat(descuento) || 0,
                activo: true,
                hoja_nombre: 'Presupuestos',
                hoja_url: config.hoja_url,
                usuario_id: config.usuario_id || null
            };

            presupuestosMap.set(presupuestoKey, {
                presupuesto: presupuesto,
                detalles: []
            });

            console.log(`[PRESUPUESTOS-BACK] ✅ Presupuesto ${presupuestoKey} agregado al mapa`);

        } catch (mappingError) {
            console.error(`[PRESUPUESTOS-BACK] ❌ Error mapeando presupuesto fila ${i + 2}:`, mappingError.message);
            console.error(`[PRESUPUESTOS-BACK] Datos de la fila:`, row);
            presupuestosOmitidos++;
        }
    }

    console.log(`[PRESUPUESTOS-BACK] ✅ Presupuestos base creados: ${presupuestosMap.size}`);
    console.log(`[PRESUPUESTOS-BACK] ⚠️ Presupuestos omitidos: ${presupuestosOmitidos}`);

    // PASO 2: Procesar hoja "DetallesPresupuestos"
    console.log('[PRESUPUESTOS-BACK] PUNTO 6B: Procesando hoja "DetallesPresupuestos"');
    console.log('[PRESUPUESTOS-BACK] Encabezados DetallesPresupuestos:', detallesData.headers);
    console.log('[PRESUPUESTOS-BACK] Total filas de detalles a procesar:', detallesData.rows.length);

    // CORRECCIÓN: Mostrar todos los IDs de presupuestos disponibles para debugging
    const presupuestosDisponibles = Array.from(presupuestosMap.keys());
    console.log('[PRESUPUESTOS-BACK] IDs de presupuestos disponibles:', presupuestosDisponibles.slice(0, 10), presupuestosDisponibles.length > 10 ? `... y ${presupuestosDisponibles.length - 10} más` : '');

    for (let i = 0; i < detallesData.rows.length; i++) {
        const row = detallesData.rows[i];

        try {
            // Mapeo según especificación del informe: IDDetallePresupuesto, IdPresupuesto, Articulo, Cantidad, Valor1, Precio1, IVA1, Diferencia, Condicion, Camp1, Camp2, Camp3, Camp4, Camp5, Camp6, LastModified
            const id_detalle_presupuesto = row[detallesData.headers[0]] || ''; // IDDetallePresupuesto (A)
            const id_presupuesto = row[detallesData.headers[1]] || '';         // IdPresupuesto (B)
            const articulo = row[detallesData.headers[2]] || '';               // Articulo (C)
            const cantidad = row[detallesData.headers[3]] || 0;                // Cantidad (D)
            const valor1 = row[detallesData.headers[4]] || 0;                  // Valor1 (E)
            const precio1 = row[detallesData.headers[5]] || 0;                 // Precio1 (F)
            const iva1 = row[detallesData.headers[6]] || 0;                    // IVA1 (G)
            const diferencia = row[detallesData.headers[7]] || 0;              // Diferencia (H)
            const condicion = row[detallesData.headers[8]] || null;            // Condicion (I)
            // CORRECCIÓN: Mapeo correcto según especificación del usuario
            const camp1 = row[detallesData.headers[9]] || 0;                   // Camp2 (J) -> camp1
            const camp2 = row[detallesData.headers[10]] || 0;                  // Camp3 (K) -> camp2
            const camp3 = row[detallesData.headers[11]] || 0;                  // Camp4 (L) -> camp3
            const camp4 = row[detallesData.headers[12]] || 0;                  // Camp5 (M) -> camp4
            const camp5 = row[detallesData.headers[13]] || 0;                  // Camp6 (N) -> camp5
            const camp6 = row[detallesData.headers[8]] || 0;                   // Condicion (I) -> camp6
            const lastModified = row[detallesData.headers[15]] || null;        // LastModified (P)

            console.log(`[PRESUPUESTOS-BACK] Procesando detalle fila ${i + 2}:`, {
                id_detalle_presupuesto: `"${id_detalle_presupuesto}"`,
                id_presupuesto: `"${id_presupuesto}"`,
                articulo: `"${articulo}"`,
                cantidad,
                precio1
            });

            // CORRECCIÓN: Validación menos restrictiva y mejor logging
            const id_presupuesto_clean = String(id_presupuesto || '').trim();
            const articulo_clean = String(articulo || '').trim();

            if (!id_presupuesto_clean) {
                console.log(`[PRESUPUESTOS-BACK] ⚠️ Detalle fila ${i + 2}: ID presupuesto vacío, omitiendo`);
                console.log(`[PRESUPUESTOS-BACK] Datos de la fila:`, row);
                detallesOmitidos++;
                continue;
            }

            if (!articulo_clean) {
                console.log(`[PRESUPUESTOS-BACK] ⚠️ Detalle fila ${i + 2}: Artículo vacío para presupuesto ${id_presupuesto_clean}, omitiendo`);
                detallesOmitidos++;
                continue;
            }

            const presupuestoKey = id_presupuesto_clean;

            // CORRECCIÓN: Mejor logging para presupuestos no encontrados
            if (presupuestosMap.has(presupuestoKey)) {
                const detalle = {
                    id_presupuesto_ext: presupuestoKey,
                    articulo: articulo_clean,
                    cantidad: parseFloat(cantidad) || 0,
                    valor1: parseFloat(valor1) || 0,
                    precio1: parseFloat(precio1) || 0,
                    iva1: parseFloat(iva1) || 0,
                    diferencia: parseFloat(diferencia) || 0,
                    camp1: parseFloat(camp1) || 0,
                    camp2: parseFloat(camp2) || 0,
                    camp3: parseFloat(camp3) || 0,
                    camp4: parseFloat(camp4) || 0,
                    camp5: parseFloat(camp5) || 0,
                    camp6: parseFloat(camp6) || 0
                };

                presupuestosMap.get(presupuestoKey).detalles.push(detalle);
                console.log(`[PRESUPUESTOS-BACK] ✅ Detalle agregado a presupuesto ${presupuestoKey}: ${articulo_clean}`);
            } else {
                console.log(`[PRESUPUESTOS-BACK] ❌ Detalle fila ${i + 2}: Presupuesto "${presupuestoKey}" NO ENCONTRADO, omitiendo detalle`);
                console.log(`[PRESUPUESTOS-BACK] Artículo: "${articulo_clean}"`);
                console.log(`[PRESUPUESTOS-BACK] ¿Existe presupuesto con ID similar?`, presupuestosDisponibles.find(id => id.includes(presupuestoKey) || presupuestoKey.includes(id)));
                detallesHuerfanos++;
            }

        } catch (mappingError) {
            console.error(`[PRESUPUESTOS-BACK] ❌ Error mapeando detalle fila ${i + 2}:`, mappingError.message);
            console.error(`[PRESUPUESTOS-BACK] Datos de la fila:`, row);
            detallesOmitidos++;
        }
    }

    const presupuestosArray = Array.from(presupuestosMap.values());

    // PASO 3: Log de resultado final MEJORADO
    console.log('[PRESUPUESTOS-BACK] PUNTO 7: Resultado final del mapeo');
    console.log(`[PRESUPUESTOS-BACK] ✅ Mapeo de DOS hojas completado: ${presupuestosArray.length} presupuestos únicos`);

    let totalDetalles = 0;
    let presupuestosSinDetalles = 0;
    presupuestosArray.forEach(p => {
        totalDetalles += p.detalles.length;
        if (p.detalles.length === 0) {
            presupuestosSinDetalles++;
        }
    });

    console.log(`[PRESUPUESTOS-BACK] 📊 ESTADÍSTICAS FINALES:`);
    console.log(`[PRESUPUESTOS-BACK]    - Total detalles mapeados: ${totalDetalles}`);
    console.log(`[PRESUPUESTOS-BACK]    - Presupuestos sin detalles: ${presupuestosSinDetalles}`);
    console.log(`[PRESUPUESTOS-BACK]    - Presupuestos omitidos: ${presupuestosOmitidos}`);
    console.log(`[PRESUPUESTOS-BACK]    - Detalles omitidos: ${detallesOmitidos}`);
    console.log(`[PRESUPUESTOS-BACK]    - Detalles huérfanos: ${detallesHuerfanos}`);

    // CORRECCIÓN: Mostrar distribución de detalles por presupuesto
    const distribucionDetalles = {};
    presupuestosArray.forEach(p => {
        const count = p.detalles.length;
        distribucionDetalles[count] = (distribucionDetalles[count] || 0) + 1;
    });
    console.log(`[PRESUPUESTOS-BACK] 📊 Distribución de detalles:`, distribucionDetalles);

    // Log detallado de los primeros 2 presupuestos para debugging
    console.log('[PRESUPUESTOS-BACK] Primeros 2 presupuestos mapeados:',
        presupuestosArray.slice(0, 2).map(p => ({
            id: p.presupuesto.id_presupuesto_ext,
            cliente: p.presupuesto.id_cliente,
            detalles_count: p.detalles.length,
            detalles: p.detalles.map(d => ({ articulo: d.articulo, cantidad: d.cantidad }))
        }))
    );

    if (presupuestosArray.length === 0) {
        console.log('[PRESUPUESTOS-BACK] ❌ RESULTADO FINAL: 0 presupuestos después del mapeo');
        console.log('[PRESUPUESTOS-BACK] Datos originales para debugging:', {
            presupuestosRows: presupuestosData.rows.length,
            detallesRows: detallesData.rows.length,
            presupuestosHeaders: presupuestosData.headers,
            detallesHeaders: detallesData.headers
        });
        console.log('[PRESUPUESTOS-BACK] Posibles causas:');
        console.log('[PRESUPUESTOS-BACK] - Todas las filas tienen campos esenciales vacíos');
        console.log('[PRESUPUESTOS-BACK] - Los encabezados no coinciden con la estructura esperada');
        console.log('[PRESUPUESTOS-BACK] - Error en el procesamiento de los datos');
    } else if (totalDetalles === 0) {
        console.log('[PRESUPUESTOS-BACK] ⚠️ ADVERTENCIA: Se mapearon presupuestos pero 0 detalles');
        console.log('[PRESUPUESTOS-BACK] Posibles causas:');
        console.log('[PRESUPUESTOS-BACK] - Los IDs de presupuesto no coinciden entre hojas');
        console.log('[PRESUPUESTOS-BACK] - Los detalles tienen campos esenciales vacíos');
        console.log('[PRESUPUESTOS-BACK] - Error en el mapeo de columnas');
    } else {
        console.log(`[PRESUPUESTOS-BACK] ✅ ÉXITO EN MAPEO: ${presupuestosArray.length} presupuestos con ${totalDetalles} detalles`);
    }

    return presupuestosArray;
}

/**
 * Parsear fecha desde string
 */
function parseDate(dateStr) {
    if (!dateStr) return null;

    try {
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    } catch (error) {
        console.log(`[PRESUPUESTOS-BACK] ⚠️ Error parseando fecha: ${dateStr}`);
        return null;
    }
}

/**
 * Insertar o actualizar presupuesto en base de datos
 */
async function upsertPresupuesto(db, presupuestoData, config) {
    const { presupuesto, detalles } = presupuestoData;

    console.log(`[PRESUPUESTOS-BACK] Upsert presupuesto: ${presupuesto.id_presupuesto_ext}`);

    try {
        // Verificar si el presupuesto ya existe
        const existingQuery = `
            SELECT id FROM presupuestos
            WHERE id_presupuesto_ext = $1 AND id_cliente = $2 AND activo = true
        `;

        const existingResult = await db.query(existingQuery, [
            presupuesto.id_presupuesto_ext,
            presupuesto.id_cliente
        ]);

        let presupuestoId;
        let isNew = false;

        if (existingResult.rows.length > 0) {
            // Actualizar presupuesto existente
            presupuestoId = existingResult.rows[0].id;

            const updateQuery = `
                UPDATE presupuestos
                SET fecha = $1, fecha_entrega = $2, agente = $3, tipo_comprobante = $4,
                    nota = $5, estado = $6, informe_generado = $7, cliente_nuevo_id = $8,
                    punto_entrega = $9, descuento = $10, hoja_nombre = $11, hoja_url = $12,
                    usuario_id = $13
                WHERE id = $14
                RETURNING id
            `;

            await db.query(updateQuery, [
                presupuesto.fecha,
                presupuesto.fecha_entrega,
                presupuesto.agente,
                presupuesto.tipo_comprobante,
                presupuesto.nota,
                presupuesto.estado,
                presupuesto.informe_generado,
                presupuesto.cliente_nuevo_id,
                presupuesto.punto_entrega,
                presupuesto.descuento,
                presupuesto.hoja_nombre,
                presupuesto.hoja_url,
                presupuesto.usuario_id,
                presupuestoId
            ]);

            // Eliminar detalles existentes
            await db.query('DELETE FROM presupuestos_detalles WHERE id_presupuesto = $1', [presupuestoId]);

        } else {
            // Crear nuevo presupuesto
            isNew = true;

            const insertQuery = `
                INSERT INTO presupuestos
                (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
                 nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
                 activo, hoja_nombre, hoja_url, usuario_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15)
                RETURNING id
            `;

            const insertResult = await db.query(insertQuery, [
                presupuesto.id_presupuesto_ext,
                presupuesto.id_cliente,
                presupuesto.fecha,
                presupuesto.fecha_entrega,
                presupuesto.agente,
                presupuesto.tipo_comprobante,
                presupuesto.nota,
                presupuesto.estado,
                presupuesto.informe_generado,
                presupuesto.cliente_nuevo_id,
                presupuesto.punto_entrega,
                presupuesto.descuento,
                presupuesto.hoja_nombre,
                presupuesto.hoja_url,
                presupuesto.usuario_id
            ]);

            presupuestoId = insertResult.rows[0].id;
        }

        // Insertar detalles
        console.log(`[PRESUPUESTOS-BACK] Insertando ${detalles.length} detalles para presupuesto ${presupuesto.id_presupuesto_ext}`);
        
        for (let i = 0; i < detalles.length; i++) {
            const detalle = detalles[i];
            
            try {
                const insertDetalleQuery = `
                    INSERT INTO presupuestos_detalles 
                    (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1,
                     iva1, diferencia, camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                `;
                
                const result = await db.query(insertDetalleQuery, [
                    presupuestoId,
                    detalle.id_presupuesto_ext,
                    detalle.articulo,
                    detalle.cantidad,
                    detalle.valor1,
                    detalle.precio1,
                    detalle.iva1,
                    detalle.diferencia,
                    detalle.camp1,
                    detalle.camp2,
                    detalle.camp3,
                    detalle.camp4,
                    detalle.camp5,
                    detalle.camp6
                ]);
                
                console.log(`[PRESUPUESTOS-BACK] ✅ Detalle ${i + 1}/${detalles.length} insertado: ${detalle.articulo}`);
                
            } catch (detalleError) {
                console.error(`[PRESUPUESTOS-BACK] ❌ Error insertando detalle ${i + 1}:`, detalleError.message);
                console.error(`[PRESUPUESTOS-BACK] Detalle:`, detalle);
                throw detalleError;
            }
        }

        console.log(`[PRESUPUESTOS-BACK] ✅ Presupuesto procesado: ${detalles.length} detalles`);

        return { isNew, id: presupuestoId };

    } catch (error) {
        console.error(`[PRESUPUESTOS-BACK] ❌ Error en upsert:`, error.message);
        throw error;
    }
}

/**
 * Registrar log de sincronización
 */
async function registrarLogSincronizacion(db, syncLog) {
    console.log('[PRESUPUESTOS-BACK] 📝 Registrando log de sincronización...');

    try {
        const insertLogQuery = `
            INSERT INTO presupuestos_sync_log
            (config_id, registros_procesados, registros_nuevos, registros_actualizados,
             errores, fecha_sync, exitoso, usuario_id, tipo_sync)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
            RETURNING id
        `;

        const erroresText = syncLog.errores.length > 0 ? syncLog.errores.join('\n') : null;

        const result = await db.query(insertLogQuery, [
            syncLog.config_id,
            syncLog.registros_procesados,
            syncLog.registros_nuevos,
            syncLog.registros_actualizados,
            erroresText,
            syncLog.exitoso,
            syncLog.usuario_id,
            'manual'
        ]);

        console.log('[PRESUPUESTOS-BACK] ✅ Log registrado con ID:', result.rows[0].id);

        return result.rows[0].id;
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al registrar log:', error.message);
        throw error;
    }
}

console.log('[PRESUPUESTOS-BACK] ✅ Servicio de sincronización para presupuestos configurado');

module.exports = {
    syncFromGoogleSheets,
    upsertPresupuesto,
    registrarLogSincronizacion
};
