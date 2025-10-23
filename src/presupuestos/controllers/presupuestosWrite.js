console.log('🔍 [PRESUPUESTOS-WRITE] Cargando controlador de escritura local...');

// ====== Flags de concurrencia de proceso (simple mutex) ======
if (global.__SYNC_RUNNING__ === undefined) global.__SYNC_RUNNING__ = false; // lo marca el motor de sync
if (global.__WRITE_ACTIVE__ === undefined) global.__WRITE_ACTIVE__ = 0;     // cantidad de escrituras en curso

function isSyncRunning() {
    return !!global.__SYNC_RUNNING__;
}
function markWriteStart() {
    global.__WRITE_ACTIVE__ = (global.__WRITE_ACTIVE__ || 0) + 1;
}
function markWriteEnd() {
    global.__WRITE_ACTIVE__ = Math.max((global.__WRITE_ACTIVE__ || 1) - 1, 0);
}

// Generadores de ID locales (sin dependencias de Google Sheets)
function generatePresupuestoId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `${timestamp}-${random}`;
}

function generateDetalleId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 3);
    return `D-${timestamp}-${random}`;
}

// Normalizadores locales (sin dependencias de Google Sheets)
function normalizeDate(dateInput) {
    if (!dateInput) return new Date().toISOString().split('T')[0];

    if (dateInput instanceof Date) {
        return dateInput.toISOString().split('T')[0];
    }

    if (typeof dateInput === 'string') {
        const date = new Date(dateInput);
        return date.toISOString().split('T')[0];
    }

    return new Date().toISOString().split('T')[0];
}

function normalizeNumber(numberInput) {
    if (numberInput === null || numberInput === undefined) return 0;
    const num = parseFloat(numberInput);
    return isNaN(num) ? 0 : num;
}

/**
 * Push automático a Google Sheets (fire-and-forget)
 * Se ejecuta en segundo plano después del COMMIT exitoso
 */
async function pushToSheetsFireAndForget(presupuestoId, detallesCount, requestId, db) {
    try {
        console.log(`🚀 [SYNC-UP] ${requestId} - Iniciando push automático a Sheets: ${presupuestoId} (${detallesCount} detalles)`);
        
        // Obtener configuración de Sheets
        let config = null;
        try {
            const configQuery = `
                SELECT sheet_url, sheet_id 
                FROM presupuestos_config 
                WHERE activo = true 
                ORDER BY fecha_creacion DESC 
                LIMIT 1
            `;
            const configResult = await db.query(configQuery);
            
            if (configResult.rows.length > 0) {
                const configPersistida = configResult.rows[0];
                config = {
                    hoja_id: configPersistida.sheet_id,
                    hoja_url: configPersistida.sheet_url,
                    hoja_nombre: 'Presupuestos',
                    usuario_id: null
                };
            } else {
                // Usar configuración por defecto
                config = {
                    hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                    hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                    hoja_nombre: 'Presupuestos',
                    usuario_id: null
                };
            }
        } catch (configError) {
            console.warn(`⚠️ [SYNC-UP] ${requestId} - Error obteniendo config, usando por defecto:`, configError.message);
            config = {
                hoja_id: '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
                hoja_url: 'https://docs.google.com/spreadsheets/d/1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8/edit',
                hoja_nombre: 'Presupuestos',
                usuario_id: null
            };
        }

        if (!config.hoja_id) {
            console.warn(`⚠️ [SYNC-UP] ${requestId} - No hay configuración válida para push automático`);
            return;
        }

        // Importar funciones de push (usando las existentes del servicio)
        const { pushAltasLocalesASheets, pushDetallesLocalesASheets } = require('../../services/gsheets/sync_fechas_fix');
        const { readSheetWithHeaders } = require('../../services/gsheets/client_with_logs');

        // Leer datos actuales de Sheets para el push
        console.log(`🔍 [SYNC-UP] ${requestId} - Leyendo datos actuales de Sheets...`);
        const presupuestosData = await readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos');
        
        // Push de cabecera (solo el presupuesto recién creado)
        console.log(`📤 [SYNC-UP] ${requestId} - Ejecutando push de cabecera...`);
        const insertedIds = await pushAltasLocalesASheets(presupuestosData, config, db);
        
        if (insertedIds && insertedIds.size > 0 && insertedIds.has(presupuestoId)) {
            console.log(`✅ [SYNC-UP] ${requestId} - Cabecera enviada exitosamente: ${presupuestoId}`);
            
            // Push de detalles
            console.log(`📤 [SYNC-UP] ${requestId} - Ejecutando push de detalles...`);
            await pushDetallesLocalesASheets(insertedIds, config, db);
            console.log(`✅ [SYNC-UP] ${requestId} - Push automático completado: ${presupuestoId} con ${detallesCount} detalles`);
        } else {
            console.log(`ℹ️ [SYNC-UP] ${requestId} - Presupuesto ya existía en Sheets o no se pudo enviar: ${presupuestoId}`);
        }

    } catch (pushError) {
        // Error en push NO debe afectar la respuesta al cliente
        console.error(`❌ [SYNC-UP] ${requestId} - Error en push automático (no crítico):`, pushError.message);
        console.error(`❌ [SYNC-UP] ${requestId} - Stack:`, pushError.stack);
    }
}

/**
 * Crear nuevo presupuesto con encabezado + detalles
 * Transacción corta + guardas de concurrencia + PUSH AUTOMÁTICO A SHEETS
 */
const crearPresupuesto = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Iniciando creación de presupuesto...`);

    // Si está corriendo el motor de sincronización, respondemos rápido para no colgar el front
    if (isSyncRunning()) {
        console.log(`⏳ [PRESUPUESTOS-WRITE] ${requestId} - Rechazado: SYNC en curso`);
        return res.status(503).json({
            success: false,
            error: 'Sincronización en curso. Intente nuevamente en unos segundos.',
            code: 'SYNC_IN_PROGRESS',
            requestId,
            timestamp: new Date().toISOString()
        });
    }

    const idempotencyKey = req.headers['idempotency-key'];

    let client; // pg client para transacción
    markWriteStart();
    try {
        const {
            id_cliente,
            fecha,
            fecha_entrega,
            agente,
            tipo_comprobante,
            nota,
            estado,
            punto_entrega,
            descuento = 0,
            secuencia,
            detalles = []
        } = req.body;

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Datos recibidos:`, {
            id_cliente, fecha, tipo_comprobante, detalles_count: detalles.length, idempotencyKey
        });

        // Validaciones básicas rápidas
        if (!id_cliente) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - ID cliente requerido`);
            return res.status(400).json({
                success: false,
                error: 'ID de cliente es requerido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        if (!detalles || detalles.length === 0) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Detalles requeridos`);
            return res.status(400).json({
                success: false,
                error: 'Al menos un detalle de artículo es requerido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        // Preparar normalizados
        const presupuestoId = generatePresupuestoId();
        const fechaNormalizada = normalizeDate(fecha || new Date());
        const fechaEntregaNormalizada = fecha_entrega ? normalizeDate(fecha_entrega) : null;
        const descuentoNormalizado = normalizeNumber(descuento);
        const estadoNormalizado = (typeof estado === 'string' && estado.trim()) ? estado.trim() : 'Presupuesto/Orden';

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - IDs/fechas listos:`, {
            presupuestoId, fechaNormalizada, fechaEntregaNormalizada, descuentoNormalizado
        });

        // ===== Transacción corta para header + detalles =====
        client = await req.db.connect();
        try {
            await client.query('BEGIN');
            // Evitar esperas largas por bloqueos
            await client.query("SET LOCAL lock_timeout TO '5s'");
            await client.query("SET LOCAL statement_timeout TO '15s'");

            // Obtener configuración activa para completar campos
            const configQuery = `
                SELECT hoja_url
                FROM presupuestos_config
                WHERE activo = true
                ORDER BY id DESC
                LIMIT 1
            `;
            const configResult = await client.query(configQuery);
            
            let configHojaUrl = process.env.SPREADSHEET_URL || '';
            if (configResult.rows.length > 0) {
                configHojaUrl = configResult.rows[0].hoja_url;
                console.log(`[SINCRO] Config hoja_url para nuevo presupuesto: ${configHojaUrl}`);
            }

            // Insertar encabezado en BD como PENDIENTE
            const insertHeaderQuery = `
                INSERT INTO presupuestos 
                (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante, 
                nota, estado, informe_generado, punto_entrega, descuento, secuencia, activo, hoja_nombre, hoja_url, usuario_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pendiente', $9, $10, $11, true, 'Presupuestos', $12, $13)
                RETURNING *
            `;

            const headerResult = await client.query(insertHeaderQuery, [
                presupuestoId,
                id_cliente,
                fechaNormalizada,
                fechaEntregaNormalizada,
                agente || '',
                tipo_comprobante || 'Factura',
                nota || '',
                estadoNormalizado,
                punto_entrega || '',
                descuentoNormalizado,
                secuencia || 'Imprimir', // Valor predeterminado: "Imprimir"
                configHojaUrl,
                1 // usuario_id = 1 por defecto
            ]);

            const presupuestoBD = headerResult.rows[0];
            console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Encabezado registrado: ID=${presupuestoBD.id}`);

            // Helpers numéricos locales para cálculos

           // Busca el costo unitario por código de barras (detalle.articulo)
async function obtenerCostoUnitarioPorBarcode(pgClient, codigoBarras) {
    const cb = (codigoBarras ?? '').toString().trim();
    if (!cb) return 0;
    const sql = `
        SELECT pa.costo
        FROM articulos a
        JOIN precios_articulos pa ON pa.articulo = a.numero
        WHERE TRIM(a.codigo_barras)::text = $1
        LIMIT 1
    `;
    try {
        const r = await pgClient.query(sql, [cb]);
        const costo = r.rows?.[0]?.costo;
        return normalizeNumber(costo);
    } catch (e) {
        console.warn('⚠️ [PRESUPUESTOS-WRITE] ' + requestId + ' - lookup costo falló para barcode ' + cb + ': ' + e.message);
        return 0;
    }
}


            function round2(valor) {
                const n = Number(valor);
                return Math.round((n + Number.EPSILON) * 100) / 100;
            }
            function toAlicuotaDecimal(valor) {
                const v = parseFloat(valor);
                if (!Number.isFinite(v) || v < 0) return 0;
                return v > 1 ? v / 100 : v;
            }

            // Generar IDs para detalles y CALCULAR campos según mapa A–N

            // === construir detallesNormalizados (usa obtenerCostoUnitarioPorBarcode) ===
            const detallesNormalizados = [];
            const detallesInput = Array.isArray(detalles) ? detalles : [];

            for (const det of detallesInput) {
            const cantidad = normalizeNumber(det.cantidad || 0);          // D
            const netoUnit = normalizeNumber(det.valor1 || 0);            // E
            const alicDec  = toAlicuotaDecimal(det.iva1 || 0);            // K (decimal)
            const ivaUnit  = round2(netoUnit * alicDec);                  // G = E × K
            const brutoUnit = round2(netoUnit + ivaUnit);                 // F = E + G

            const netoTotal  = round2(cantidad * netoUnit);               // L
            const ivaTotal   = round2(cantidad * ivaUnit);                // N
            const brutoTotal = round2(netoTotal + ivaTotal);              // M

            const barcode   = (det.articulo || '').toString().trim();
            const costoUnit = await obtenerCostoUnitarioPorBarcode(client, barcode); // costo por barcode

            // LOG ANTES - Mapeo actual detectado
            console.log(`🔍 [CAMP-MAPPING-ANTES] ${requestId} - CAMP2<=brutoUnit, CAMP3<=alicDec, CAMP4<=netoTotal, CAMP5<=brutoTotal, CAMP6<=ivaTotal`);

            detallesNormalizados.push({
                id: generateDetalleId(),
                id_presupuesto_ext: presupuestoId,
                articulo: barcode,
                cantidad,
                valor1: netoUnit,                 // E
                precio1: brutoUnit,               // F (con IVA)
                iva1: ivaUnit,                    // G (monto unitario)
                diferencia: round2(brutoUnit - costoUnit), // H = Precio1 - Costo
                camp1: netoUnit,                  // I (sin cambio)
                camp2: alicDec,                   // K (era camp3) - CORRIMIENTO
                camp3: netoTotal,                 // L (era camp4) - CORRIMIENTO  
                camp4: brutoTotal,                // M (era camp5) - CORRIMIENTO
                camp5: ivaTotal,                  // N (era camp6) - CORRIMIENTO
                camp6: null                       // Sin uso (era ivaTotal)
            });

            // LOG DESPUÉS - Mapeo efectivo aplicado
            console.log(`✅ [CAMP-MAPPING-DESPUES] ${requestId} - CAMP2<=alicDec, CAMP3<=netoTotal, CAMP4<=brutoTotal, CAMP5<=ivaTotal, CAMP6<=null`);
            }

            const insertDetalleQuery = `
                INSERT INTO presupuestos_detalles
                (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1,
                 diferencia, camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
            `;
                let detallesInsertados = 0;
                for (const detalle of detallesNormalizados) {
                    console.log(`[PUT-DET] Insertando detalle ${detallesInsertados + 1}/${detallesNormalizados.length}: articulo=${detalle.articulo}`);
                    await client.query(insertDetalleQuery, [
                    presupuestoBD.id,
                    detalle.id_presupuesto_ext,
                    detalle.articulo,
                    detalle.cantidad,
                    detalle.valor1,
                    detalle.precio1,
                    detalle.iva1,
                    // Corrección de mapeo según especificación del usuario
                    detalle.diferencia, // diferencia (H)
                    detalle.camp1,      // camp1 ↔ Camp2
                    detalle.camp2,      // camp2 ↔ Camp3
                    detalle.camp3,      // camp3 ↔ Camp4
                    detalle.camp4,      // camp4 ↔ Camp5 (columna M)
                    detalle.camp5,      // camp5 ↔ Camp6 (columna N)
                    detalle.camp6       // camp6 ↔ Condicion (columna O)
                ]);
            }

            await client.query('COMMIT');

            console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Transacción OK. Presupuesto creado: ${presupuestoId}`);

            // ===== PUENTE AUTOMÁTICO LOCAL→JIT (FIRE-AND-FORGET POST-COMMIT) =====
            // Disparar push automático en segundo plano SIN esperar respuesta
            setImmediate(() => {
                pushToSheetsFireAndForget(presupuestoId, detallesNormalizados.length, requestId, req.db);
            });

            // Respuesta exitosa INMEDIATA (sin esperar Google Sheets)
            return res.status(201).json({
                success: true,
                data: {
                    id: presupuestoBD.id,
                    id_presupuesto: presupuestoId,
                    estado: presupuestoBD.estado,
                    detalles_count: detallesNormalizados.length,
                    created_at: presupuestoBD.fecha_actualizacion
                },
                message: 'Presupuesto creado exitosamente en BD local',
                requestId,
                idempotencyKey,
                timestamp: new Date().toISOString()
            });

        } catch (dbErr) {
            // Rollback si algo falló dentro de la transacción
            try { await client.query('ROLLBACK'); } catch (_) {}
            console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error en transacción:`, dbErr);

            // Códigos útiles: 55P03 (lock_not_available), 57014 (query_canceled por timeout)
            const msg = (dbErr && dbErr.message) ? dbErr.message : '';
            if (dbErr.code === '55P03' || /lock timeout/i.test(msg)) {
                return res.status(503).json({
                    success: false,
                    error: 'Recurso bloqueado por proceso de sincronización. Intente nuevamente en breve.',
                    code: 'LOCK_TIMEOUT',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }
            if (dbErr.code === '57014' || /statement timeout/i.test(msg)) {
                return res.status(503).json({
                    success: false,
                    error: 'La operación superó el tiempo máximo permitido. Intente nuevamente.',
                    code: 'STATEMENT_TIMEOUT',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Error interno al crear presupuesto',
                message: msg,
                requestId,
                timestamp: new Date().toISOString()
            });
        } finally {
            if (client) client.release();
        }

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error general:`, error);
        return res.status(500).json({
            success: false,
            error: 'Error interno al crear presupuesto',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    } finally {
        markWriteEnd();
    }
};



/**
 * Editar presupuesto existente (cabecera + detalles opcionales)
 */
const editarPresupuesto = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Iniciando edición de presupuesto...`);

    if (isSyncRunning()) {
        console.log(`⏳ [PRESUPUESTOS-WRITE] ${requestId} - Rechazado: SYNC en curso`);
        return res.status(503).json({
            success: false,
            error: 'Sincronización en curso. Intente nuevamente en unos segundos.',
            code: 'SYNC_IN_PROGRESS',
            requestId,
            timestamp: new Date().toISOString()
        });
    }

    let client; // pg client para transacción
    markWriteStart();

    try {
        const { id } = req.params;
        const { 
            agente, 
            nota, 
            punto_entrega, 
            descuento, 
            fecha_entrega, 
            detalles,
            // NUEVOS: Campos del encabezado que faltaban
            tipo_comprobante,
            estado,
            id_cliente,
            fecha,
            secuencia
        } = req.body;

    console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Editando presupuesto ID: ${id}`);
    console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Datos recibidos para edición:`, req.body);

        // Helpers numéricos locales para cálculos (copiados del POST)
        function round2(valor) {
            const n = Number(valor);
            return Math.round((n + Number.EPSILON) * 100) / 100;
        }
        function toAlicuotaDecimal(valor) {
            const v = parseFloat(valor);
            if (!Number.isFinite(v) || v < 0) return 0;
            return v > 1 ? v / 100 : v;
        }

        // Busca el costo unitario por código de barras (copiado del POST)
        async function obtenerCostoUnitarioPorBarcode(pgClient, codigoBarras) {
            const cb = (codigoBarras ?? '').toString().trim();
            if (!cb) return 0;
            const sql = `
                SELECT pa.costo
                FROM articulos a
                JOIN precios_articulos pa ON pa.articulo = a.numero
                WHERE TRIM(a.codigo_barras)::text = $1
                LIMIT 1
            `;
            try {
                const r = await pgClient.query(sql, [cb]);
                const costo = r.rows?.[0]?.costo;
                return normalizeNumber(costo);
            } catch (e) {
                console.warn('⚠️ [PRESUPUESTOS-WRITE] ' + requestId + ' - lookup costo falló para barcode ' + cb + ': ' + e.message);
                return 0;
            }
        }

        // ===== Transacción para cabecera + detalles =====
        client = await req.db.connect();
        try {
            await client.query('BEGIN');
            // Evitar esperas largas por bloqueos
            await client.query("SET LOCAL lock_timeout TO '5s'");
            await client.query("SET LOCAL statement_timeout TO '15s'");

            // Resolver identificador: numérico vs externo
            const isNumericId = /^\d+$/.test(id);
            let campo, valor;
            
            if (isNumericId) {
                campo = 'id (numérico)';
                valor = parseInt(id);
            } else {
                campo = 'id_presupuesto_ext (externo)';
                valor = id;
            }

            console.log(`[PUT] Resolver ID`, { raw: id, campo, valor });

            // Buscar presupuesto usando el campo resuelto
            let checkQuery, queryParams;

            if (isNumericId) {
                checkQuery = `
                    SELECT * FROM presupuestos 
                    WHERE (id = $1 OR id_presupuesto_ext = $2) 
                    AND activo = true
                `;
                queryParams = [parseInt(id), id];
            } else {
                checkQuery = `
                    SELECT * FROM presupuestos 
                    WHERE id_presupuesto_ext = $1 
                    AND activo = true
                `;
                queryParams = [id];
            }

            const checkResult = await client.query(checkQuery, queryParams);

            if (checkResult.rows.length === 0) {
                console.warn(`[PUT] No se encontró presupuesto`, { campo, valor });
                return res.status(404).json({
                    success: false,
                    error: 'Presupuesto no encontrado o no se puede editar',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }

            const presupuesto = checkResult.rows[0];
            console.log(`[PUT] Presupuesto encontrado`, { id: presupuesto.id });

            // Construir actualización dinámica de cabecera
            const updates = [];
            const params = [];
            let paramCount = 0;

            if (agente !== undefined) {
                paramCount++;
                updates.push(`agente = $${paramCount}`);
                params.push(agente);
            }

            if (nota !== undefined) {
                paramCount++;
                updates.push(`nota = $${paramCount}`);
                params.push(nota);
            }

            if (punto_entrega !== undefined) {
                paramCount++;
                updates.push(`punto_entrega = $${paramCount}`);
                params.push(punto_entrega);
            }

            if (descuento !== undefined) {
                paramCount++;
                updates.push(`descuento = $${paramCount}`);
                params.push(normalizeNumber(descuento));
            }

            if (fecha_entrega !== undefined) {
                paramCount++;
                updates.push(`fecha_entrega = $${paramCount}`);
                params.push(fecha_entrega ? normalizeDate(fecha_entrega) : null);
            }

            // NUEVOS: Campos del encabezado que faltaban
            if (tipo_comprobante !== undefined) {
                paramCount++;
                updates.push(`tipo_comprobante = $${paramCount}`);
                params.push(tipo_comprobante);
            }

            if (estado !== undefined) {
                paramCount++;
                updates.push(`estado = $${paramCount}`);
                params.push(estado);
            }

            if (id_cliente !== undefined) {
                paramCount++;
                updates.push(`id_cliente = $${paramCount}`);
                params.push(id_cliente);
            }

            if (fecha !== undefined) {
                paramCount++;
                updates.push(`fecha = $${paramCount}`);
                params.push(fecha ? normalizeDate(fecha) : null);
            }

            if (secuencia !== undefined) {
                paramCount++;
                updates.push(`secuencia = $${paramCount}`);
                params.push(secuencia || null);
            }

            // Actualizar cabecera si hay campos
            let presupuestoActualizado = presupuesto;
            if (updates.length > 0) {
                // CRÍTICO: Agregar fecha_actualizacion para que la sincronización detecte el cambio
                paramCount++;
                updates.push(`fecha_actualizacion = $${paramCount}`);
                params.push(new Date().toISOString());
                
                paramCount++;
                params.push(presupuesto.id);

                const updateQuery = `
                    UPDATE presupuestos 
                    SET ${updates.join(', ')}
                    WHERE id = $${paramCount}
                    RETURNING *
                `;

                const updateResult = await client.query(updateQuery, params);
                presupuestoActualizado = updateResult.rows[0];
                console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Cabecera actualizada con timestamp`);
            }

            // Determinar si actualizar detalles
            if (Array.isArray(detalles)) {
                console.log(`[PUT-DET] ===== INICIO PROCESAMIENTO DETALLES =====`);
                console.log(`[PUT-DET] detalles recibidos:`, JSON.stringify(detalles, null, 2));
                console.log(`[PUT-DET] detalles.length: ${detalles.length}`);
                console.log(`[PUT-DET] primer detalle:`, detalles[0]);
                console.log(`[PUT-DET] reemplazando detalles → count=${detalles.length}`);

                // Validar detalles antes de procesar
                for (const det of detalles) {
                    const barcode = (det.articulo || '').toString().trim();
                    console.log(`[PUT-DET] Validando detalle: articulo="${barcode}", cantidad=${det.cantidad}, valor1=${det.valor1}`);
                    if (!barcode) {
                        console.error(`[PUT-DET] ❌ Detalle sin código de barras válido:`, det);
                        throw new Error(`Detalle sin código de barras válido: ${JSON.stringify(det)}`);
                    }
                }
                console.log(`[PUT-DET] ✅ Todos los detalles validados correctamente`);

                // 1. Eliminar detalles existentes
                console.log(`[PUT-DET] Ejecutando DELETE de detalles existentes para id_presupuesto=${presupuesto.id}`);
                const deleteDetallesQuery = `
                    DELETE FROM presupuestos_detalles
                    WHERE id_presupuesto = $1
                `;
                const deleteResult = await client.query(deleteDetallesQuery, [presupuesto.id]);
                const detallesEliminados = deleteResult.rowCount;
                console.log(`[PUT-DET] ✅ DELETE ejecutado: ${detallesEliminados} detalles eliminados`);

                // 2. Construir detalles normalizados (USAR MISMO CÁLCULO QUE EN CREACIÓN)
                console.log(`[PUT-DET] Construyendo detalles normalizados...`);
                const detallesNormalizados = [];
                const detallesInput = Array.isArray(detalles) ? detalles : [];
                console.log(`[PUT-DET] detallesInput.length: ${detallesInput.length}`);

                for (const det of detallesInput) {
                    console.log(`[PUT-DET] Procesando detalle:`, det);
                    const cantidad = normalizeNumber(det.cantidad || 0);          // D
                    const netoUnit = normalizeNumber(det.valor1 || 0);            // E
                    const alicDec  = toAlicuotaDecimal(det.iva1 || 0);            // K (decimal)
                    const ivaUnit  = round2(netoUnit * alicDec);                  // G = E × K
                    const brutoUnit = round2(netoUnit + ivaUnit);                 // F = E + G

                    const netoTotal  = round2(cantidad * netoUnit);               // L
                    const ivaTotal   = round2(cantidad * ivaUnit);                // N
                    const brutoTotal = round2(netoTotal + ivaTotal);              // M

                    const barcode   = (det.articulo || '').toString().trim();
                    const costoUnit = await obtenerCostoUnitarioPorBarcode(client, barcode); // costo por barcode

                    // LOG ANTES - Mapeo actual detectado (edición)
                    console.log(`🔍 [CAMP-MAPPING-ANTES-EDIT] ${requestId} - CAMP2<=brutoUnit, CAMP3<=alicDec, CAMP4<=netoTotal, CAMP5<=brutoTotal, CAMP6<=ivaTotal`);

                    detallesNormalizados.push({
                        id: generateDetalleId(),
                        id_presupuesto_ext: presupuesto.id_presupuesto_ext,
                        articulo: barcode,
                        cantidad,
                        valor1: netoUnit,                 // E
                        precio1: brutoUnit,               // F (con IVA)
                        iva1: ivaUnit,                    // G (monto unitario)
                        diferencia: round2(brutoUnit - costoUnit), // H = Precio1 - Costo
                        camp1: netoUnit,                  // I (sin cambio)
                        camp2: alicDec,                   // K (era camp3) - CORRIMIENTO
                        camp3: netoTotal,                 // L (era camp4) - CORRIMIENTO
                        camp4: brutoTotal,                // M (era camp5) - CORRIMIENTO
                        camp5: ivaTotal,                  // N (era camp6) - CORRIMIENTO
                        camp6: null                       // Sin uso (era ivaTotal)
                    });

                    // LOG DESPUÉS - Mapeo efectivo aplicado (edición)
                    console.log(`✅ [CAMP-MAPPING-DESPUES-EDIT] ${requestId} - CAMP2<=alicDec, CAMP3<=netoTotal, CAMP4<=brutoTotal, CAMP5<=ivaTotal, CAMP6<=null`);
                }

                console.log(`[PUT-DET] ===== RESUMEN NORMALIZACIÓN =====`);
                console.log(`[PUT-DET] Total detalles normalizados: ${detallesNormalizados.length}`);
                if (detallesNormalizados.length > 0) {
                    console.log(`[PUT-DET] Ejemplo primer detalle normalizado:`, detallesNormalizados[0]);
                } else {
                    console.warn(`[PUT-DET] ⚠️ NO SE NORMALIZÓ NINGÚN DETALLE - Los detalles desaparecerán`);
                }

                // 3. Insertar nuevos detalles (versión simple)
                console.log(`[PUT-DET] Iniciando INSERT de ${detallesNormalizados.length} detalles...`);
                const insertDetalleQuery = `
                    INSERT INTO presupuestos_detalles
                    (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1,
                     diferencia, camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                `;
                let detallesInsertados = 0;
                for (const detalle of detallesNormalizados) {
                    console.log(`[PUT-DET] Insertando detalle ${detallesInsertados + 1}/${detallesNormalizados.length}: articulo=${detalle.articulo}`);
                    await client.query(insertDetalleQuery, [
                        presupuesto.id,
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
                    detallesInsertados++;
                }

                console.log(`[PUT-DET] ===== RESUMEN FINAL =====`);
                console.log(`[PUT-DET] Detalles eliminados: ${detallesEliminados}`);
                console.log(`[PUT-DET] Detalles insertados: ${detallesInsertados}`);
                console.log(`[PUT-DET] ✅ Operación de detalles completada`);
                
                // Log antes del COMMIT
                console.log(`[TRACE-EDIT-LOCAL] id=${presupuesto.id_presupuesto_ext} detalles_eliminados=${detallesEliminados} detalles_insertados=${detallesNormalizados.length}`);
            }

            await client.query('COMMIT');
            
            // Log después del COMMIT
            console.log(`[TRACE-EDIT-LOCAL] commit_ok id=${presupuesto.id_presupuesto_ext}`);

            console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Transacción completada`);

            res.json({
                success: true,
                data: presupuestoActualizado,
                message: 'Presupuesto actualizado exitosamente',
                requestId,
                timestamp: new Date().toISOString()
            });

        } catch (dbErr) {
            // Rollback si algo falló dentro de la transacción
            try { await client.query('ROLLBACK'); } catch (_) {}
            console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error en transacción:`, dbErr);

            // Códigos útiles: 55P03 (lock_not_available), 57014 (query_canceled por timeout)
            const msg = (dbErr && dbErr.message) ? dbErr.message : '';
            if (dbErr.code === '55P03' || /lock timeout/i.test(msg)) {
                return res.status(503).json({
                    success: false,
                    error: 'Recurso bloqueado por proceso de sincronización. Intente nuevamente en breve.',
                    code: 'LOCK_TIMEOUT',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }
            if (dbErr.code === '57014' || /statement timeout/i.test(msg)) {
                return res.status(503).json({
                    success: false,
                    error: 'La operación superó el tiempo máximo permitido. Intente nuevamente.',
                    code: 'STATEMENT_TIMEOUT',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Error interno al actualizar presupuesto',
                message: msg,
                requestId,
                timestamp: new Date().toISOString()
            });
        } finally {
            if (client) client.release();
        }

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error al editar:`, error);

        res.status(500).json({
            success: false,
            error: 'Error al editar presupuesto',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    } finally {
        markWriteEnd();
    }
};

/**
 * Eliminar presupuesto (borrado físico completo con detalles)
 */
const eliminarPresupuesto = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Iniciando eliminación física de presupuesto...`);

    if (isSyncRunning()) {
        console.log(`⏳ [PRESUPUESTOS-WRITE] ${requestId} - Rechazado: SYNC en curso`);
        return res.status(503).json({
            success: false,
            error: 'Sincronización en curso. Intente nuevamente en unos segundos.',
            code: 'SYNC_IN_PROGRESS',
            requestId,
            timestamp: new Date().toISOString()
        });
    }

    let client; // pg client para transacción
    markWriteStart();

    try {
        const { id } = req.params;

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Eliminando presupuesto ID: ${id}`);

        const isNumericId = /^\d+$/.test(id);
        let checkQuery, queryParams;

        if (isNumericId) {
            checkQuery = `
                SELECT id, id_presupuesto_ext, id_cliente, fecha, estado, tipo_comprobante
                FROM presupuestos
                WHERE (id = $1 OR id_presupuesto_ext = $2)
                AND activo = true
            `;
            queryParams = [parseInt(id), id];
        } else {
            checkQuery = `
                SELECT id, id_presupuesto_ext, id_cliente, fecha, estado, tipo_comprobante
                FROM presupuestos
                WHERE id_presupuesto_ext = $1
                AND activo = true
            `;
            queryParams = [id];
        }

        // Verificar que el presupuesto existe
        const checkResult = await req.db.query(checkQuery, queryParams);

        if (checkResult.rows.length === 0) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto no encontrado`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = checkResult.rows[0];
        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto encontrado: ${presupuesto.id_presupuesto_ext}`);

        // ===== Transacción para borrado físico completo =====
        client = await req.db.connect();
        try {
            await client.query('BEGIN');
            // Evitar esperas largas por bloqueos
            await client.query("SET LOCAL lock_timeout TO '5s'");
            await client.query("SET LOCAL statement_timeout TO '15s'");

            // SOFT-DELETE (solo encabezado, sin tocar detalles)
                await client.query(`
                UPDATE presupuestos
                    SET activo = false,
                        estado = CASE WHEN COALESCE(estado,'')='' THEN 'Anulado' ELSE estado END
                WHERE id = $1 AND activo = true
                `, [presupuesto.id]);

                await client.query('COMMIT');

                return res.json({
                success: true,
                data: {
                    id: presupuesto.id,
                    id_presupuesto: presupuesto.id_presupuesto_ext,
                    anulado: true
                },
                message: 'Presupuesto anulado (soft-delete)',
                requestId,
                timestamp: new Date().toISOString()
            });

        } catch (dbErr) {
            // Rollback si algo falló dentro de la transacción
            try { await client.query('ROLLBACK'); } catch (_) {}
            console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error en transacción:`, dbErr);

            // Códigos útiles: 55P03 (lock_not_available), 57014 (query_canceled por timeout)
            const msg = (dbErr && dbErr.message) ? dbErr.message : '';
            if (dbErr.code === '55P03' || /lock timeout/i.test(msg)) {
                return res.status(503).json({
                    success: false,
                    error: 'Recurso bloqueado por proceso de sincronización. Intente nuevamente en breve.',
                    code: 'LOCK_TIMEOUT',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }
            if (dbErr.code === '57014' || /statement timeout/i.test(msg)) {
                return res.status(503).json({
                    success: false,
                    error: 'La operación superó el tiempo máximo permitido. Intente nuevamente.',
                    code: 'STATEMENT_TIMEOUT',
                    requestId,
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Error interno al eliminar presupuesto',
                message: msg,
                requestId,
                timestamp: new Date().toISOString()
            });
        } finally {
            if (client) client.release();
        }

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error general:`, error);

        res.status(500).json({
            success: false,
            error: 'Error interno al eliminar presupuesto',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    } finally {
        markWriteEnd();
    }
};

/**
 * Reintentar operación usando idempotencia
 */
const reintentarPresupuesto = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Iniciando reintento de presupuesto...`);

    try {
        const { id } = req.params;
        const idempotencyKey = req.headers['idempotency-key'];

        if (!idempotencyKey) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Idempotency-Key requerido para reintento`);
            return res.status(400).json({
                success: false,
                error: 'Idempotency-Key es requerido para reintentos',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Reintentando presupuesto ID: ${id}, Key: ${idempotencyKey}`);

        const isNumericId = /^\d+$/.test(id);
        let checkQuery, queryParams;

        if (isNumericId) {
            checkQuery = `
                SELECT * FROM presupuestos 
                WHERE (id = $1 OR id_presupuesto_ext = $2) 
                AND activo = true
            `;
            queryParams = [parseInt(id), id];
        } else {
            checkQuery = `
                SELECT * FROM presupuestos 
                WHERE id_presupuesto_ext = $1 
                AND activo = true
            `;
            queryParams = [id];
        }

        const checkResult = await req.db.query(checkQuery, queryParams);

        if (checkResult.rows.length === 0) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto no encontrado para reintento`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = checkResult.rows[0];
        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Estado actual: ${presupuesto.estado}`);

        if (presupuesto.estado === 'CONFIRMADO') {
            console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Ya confirmado`);
            return res.json({
                success: true,
                data: {
                    id: presupuesto.id,
                    id_presupuesto: presupuesto.id_presupuesto_ext,
                    estado: presupuesto.estado,
                    message: 'Presupuesto ya estaba confirmado'
                },
                requestId,
                idempotencyKey,
                timestamp: new Date().toISOString()
            });
        }

        if (presupuesto.estado !== 'ERROR' && presupuesto.estado !== 'PENDIENTE') {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Estado no permite reintento: ${presupuesto.estado}`);
            return res.status(400).json({
                success: false,
                error: `No se puede reintentar presupuesto en estado: ${presupuesto.estado}`,
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`ℹ️ [PRESUPUESTOS-WRITE] ${requestId} - Flujo local-first: reintentos de Sheets se manejan por separado`);

        return res.json({
            success: true,
            data: {
                id: presupuesto.id,
                id_presupuesto: presupuesto.id_presupuesto_ext,
                estado: presupuesto.estado,
                message: 'Presupuesto en BD local, sincronización pendiente'
            },
            requestId,
            idempotencyKey,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error general en reintento:`, error);

        res.status(500).json({
            success: false,
            error: 'Error interno en reintento',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estado de un presupuesto
 */
const obtenerEstadoPresupuesto = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Obteniendo estado de presupuesto...`);

    try {
        const { id } = req.params;

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Consultando estado de ID: ${id}`);

        const isNumericId = /^\d+$/.test(id);
        let query, queryParams;

        if (isNumericId) {
            query = `
                SELECT 
                    id,
                    id_presupuesto_ext,
                    estado,
                    error_motivo,
                    fecha_actualizacion,
                    activo,
                    (SELECT COUNT(*) FROM presupuestos_detalles WHERE id_presupuesto = p.id) as detalles_count
                FROM presupuestos p
                WHERE (id = $1 OR id_presupuesto_ext = $2)
                AND activo = true
            `;
            queryParams = [parseInt(id), id];
        } else {
            query = `
                SELECT 
                    id,
                    id_presupuesto_ext,
                    estado,
                    error_motivo,
                    fecha_actualizacion,
                    activo,
                    (SELECT COUNT(*) FROM presupuestos_detalles WHERE id_presupuesto = p.id) as detalles_count
                FROM presupuestos p
                WHERE id_presupuesto_ext = $1
                AND activo = true
            `;
            queryParams = [id];
        }

        const result = await req.db.query(query, queryParams);

        if (result.rows.length === 0) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto no encontrado`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = result.rows[0];
        console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Estado: ${presupuesto.estado}`);

        res.json({
            success: true,
            data: {
                id: presupuesto.id,
                id_presupuesto: presupuesto.id_presupuesto_ext,
                estado: presupuesto.estado,
                error_motivo: presupuesto.error_motivo,
                detalles_count: parseInt(presupuesto.detalles_count),
                fecha_actualizacion: presupuesto.fecha_actualizacion,
                activo: presupuesto.activo
            },
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error al obtener estado:`, error);

        res.status(500).json({
            success: false,
            error: 'Error al obtener estado del presupuesto',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar factura_id de un presupuesto
 * PUT /api/presupuestos/:id/factura
 */
const actualizarFacturaId = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Actualizando factura_id...`);

    try {
        const { id } = req.params;
        const { factura_id } = req.body;

        if (!factura_id) {
            return res.status(400).json({
                success: false,
                error: 'factura_id es requerido',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto: ${id}, Factura: ${factura_id}`);

        const isNumericId = /^\d+$/.test(id);
        let updateQuery, queryParams;

        if (isNumericId) {
            updateQuery = `
                UPDATE presupuestos 
                SET factura_id = $1, fecha_actualizacion = NOW()
                WHERE (id = $2 OR id_presupuesto_ext = $3) AND activo = true
                RETURNING id, id_presupuesto_ext, factura_id
            `;
            queryParams = [parseInt(factura_id), parseInt(id), id];
        } else {
            updateQuery = `
                UPDATE presupuestos 
                SET factura_id = $1, fecha_actualizacion = NOW()
                WHERE id_presupuesto_ext = $2 AND activo = true
                RETURNING id, id_presupuesto_ext, factura_id
            `;
            queryParams = [parseInt(factura_id), id];
        }

        const result = await req.db.query(updateQuery, queryParams);

        if (result.rows.length === 0) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto no encontrado`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = result.rows[0];
        console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - factura_id actualizado: ${presupuesto.factura_id}`);

        res.json({
            success: true,
            data: {
                id: presupuesto.id,
                id_presupuesto: presupuesto.id_presupuesto_ext,
                factura_id: presupuesto.factura_id
            },
            message: 'factura_id actualizado exitosamente',
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar factura_id',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('✅ [PRESUPUESTOS-WRITE] Controlador de escritura configurado');

module.exports = {
    crearPresupuesto,
    editarPresupuesto,
    eliminarPresupuesto,
    reintentarPresupuesto,
    obtenerEstadoPresupuesto,
    actualizarFacturaId
};
