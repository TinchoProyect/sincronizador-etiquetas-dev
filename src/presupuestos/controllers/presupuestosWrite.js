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
 * Crear nuevo presupuesto con encabezado + detalles
 * Transacción corta + guardas de concurrencia
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
            estado = 'PENDIENTE',
            punto_entrega,
            descuento = 0,
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

            // Insertar encabezado en BD como PENDIENTE
            const insertHeaderQuery = `
                INSERT INTO presupuestos 
                (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante, 
                 nota, estado, punto_entrega, descuento, activo, hoja_nombre, hoja_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE', $8, $9, true, 'Presupuestos', $10)
                RETURNING *
            `;

            const headerResult = await client.query(insertHeaderQuery, [
                presupuestoId,
                id_cliente,
                fechaNormalizada,
                fechaEntregaNormalizada,
                agente || '',
                tipo_comprobante || 'PRESUPUESTO',
                nota || '',
                punto_entrega || '',
                descuentoNormalizado,
                process.env.SPREADSHEET_URL || ''
            ]);

            const presupuestoBD = headerResult.rows[0];
            console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Encabezado registrado: ID=${presupuestoBD.id}`);

            // Helpers numéricos locales para cálculos
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
            const detallesNormalizados = (Array.isArray(detalles) ? detalles : []).map((detalle) => {
                const cantidad = normalizeNumber(detalle.cantidad || 0);          // D
                const netoUnit = normalizeNumber(detalle.valor1 || 0);            // E
                const alicDec = toAlicuotaDecimal(detalle.iva1 || 0);             // K (decimal)
                const ivaUnit = round2(netoUnit * alicDec);                        // G = E × K
                const brutoUnit = round2(netoUnit + ivaUnit);                      // F = E + G

                const netoTotal = round2(cantidad * netoUnit);                     // L = D × E
                const ivaTotal = round2(cantidad * ivaUnit);                       // N = D × G
                const brutoTotal = round2(netoTotal + ivaTotal);                   // M = L + N

                return {
                    id: generateDetalleId(),
                    id_presupuesto_ext: presupuestoId,
                    articulo: (detalle.articulo || '').toString().trim(),
                    cantidad: cantidad,
                    valor1: netoUnit,                                              // E
                    precio1: brutoUnit,                                            // F
                    iva1: ivaUnit,                                                 // G (monto unitario)
                    diferencia: round2(brutoUnit - round2(netoUnit / 1.20)),                                                  // H (placeholder)
                    camp1: netoUnit,                                               // I = E
                    camp2: brutoUnit,                                              // J = F
                    camp3: alicDec,                                                // K (decimal)
                    camp4: netoTotal,                                              // L
                    camp5: brutoTotal,                                             // M
                    camp6: ivaTotal                                                // N
                };
            });

            // Insertar detalles
            const insertDetalleQuery = `
                INSERT INTO presupuestos_detalles 
                (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1, 
                 diferencia, camp1, camp2, camp3, camp4, camp5, camp6)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `;
            for (const detalle of detallesNormalizados) {
                await client.query(insertDetalleQuery, [
                    presupuestoBD.id,
                    detalle.id_presupuesto_ext,
                    detalle.articulo,
                    detalle.cantidad,
                    detalle.valor1,
                    detalle.precio1,
                    detalle.iva1,
                    // mapeo correcto de columnas H–N
                    detalle.diferencia, // diferencia (H)
                    detalle.precio1,    // camp1 = F (bruto unitario)
                    detalle.camp3,      // camp2 = K (alícuota decimal)
                    detalle.camp4,      // camp3 = L (neto total)
                    detalle.camp5,      // camp4 = M (bruto total)
                    detalle.camp6,      // camp5 = N (IVA total)
                    0                   // camp6 = 0 (descartado)
                ]);
            }

            await client.query('COMMIT');

            console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Transacción OK. Presupuesto creado: ${presupuestoId}`);

            // Respuesta exitosa INMEDIATA (sin esperar Google Sheets)
            return res.status(201).json({
                success: true,
                data: {
                    id: presupuestoBD.id,
                    id_presupuesto: presupuestoId,
                    estado: 'PENDIENTE',
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
 * Editar presupuesto existente (solo datos permitidos)
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

    try {
        const { id } = req.params;
        const { agente, nota, punto_entrega, descuento, fecha_entrega } = req.body;

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Editando presupuesto ID: ${id}`);

        // Verificar que el presupuesto existe y está en estado editable
        const isNumericId = /^\d+$/.test(id);
        let checkQuery, queryParams;

        if (isNumericId) {
            checkQuery = `
                SELECT * FROM presupuestos 
                WHERE (id = $1 OR id_presupuesto_ext = $2) 
                AND activo = true 
                AND estado IN ('CONFIRMADO', 'PENDIENTE', 'Entregado', 'Lunes - Reparto 001 (Centro/Villa Elvira)')
            `;
            queryParams = [parseInt(id), id];
        } else {
            checkQuery = `
                SELECT * FROM presupuestos 
                WHERE id_presupuesto_ext = $1 
                AND activo = true 
                AND estado IN ('CONFIRMADO', 'PENDIENTE')
            `;
            queryParams = [id];
        }

        const checkResult = await req.db.query(checkQuery, queryParams);

        if (checkResult.rows.length === 0) {
            console.log(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto no encontrado o no editable`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado o no se puede editar',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        const presupuesto = checkResult.rows[0];
        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto encontrado: ${presupuesto.id_presupuesto_ext}`);

        // Construir actualización dinámica
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

        if (updates.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS-WRITE] ${requestId} - No hay campos para actualizar`);
            return res.status(400).json({
                success: false,
                error: 'No se proporcionaron campos válidos para actualizar',
                requestId,
                timestamp: new Date().toISOString()
            });
        }

        // Actualizar en BD
        paramCount++;
        params.push(presupuesto.id);

        const updateQuery = `
            UPDATE presupuestos 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `;

        const updateResult = await req.db.query(updateQuery, params);
        const presupuestoActualizado = updateResult.rows[0];

        console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto actualizado en BD`);
        console.log(`⚠️ [PRESUPUESTOS-WRITE] ${requestId} - Actualización en Sheets pendiente de implementar`);

        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Presupuesto actualizado exitosamente',
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error al editar:`, error);

        res.status(500).json({
            success: false,
            error: 'Error al editar presupuesto',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Eliminar presupuesto (baja lógica)
 */
const eliminarPresupuesto = async (req, res) => {
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`🔍 [PRESUPUESTOS-WRITE] ${requestId} - Iniciando eliminación de presupuesto...`);

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

    try {
        const { id } = req.params;

        console.log(`📋 [PRESUPUESTOS-WRITE] ${requestId} - Eliminando presupuesto ID: ${id}`);

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

        const deleteQuery = `
            UPDATE presupuestos 
            SET activo = false, estado = 'ANULADO', fecha_actualizacion = NOW()
            WHERE id = $1
            RETURNING *
        `;

        const deleteResult = await req.db.query(deleteQuery, [presupuesto.id]);
        const presupuestoEliminado = deleteResult.rows[0];

        console.log(`✅ [PRESUPUESTOS-WRITE] ${requestId} - Presupuesto marcado como ANULADO en BD`);

        res.json({
            success: true,
            data: {
                id: presupuestoEliminado.id,
                id_presupuesto: presupuestoEliminado.id_presupuesto_ext,
                estado: 'ANULADO',
                eliminado: true
            },
            message: 'Presupuesto eliminado exitosamente',
            requestId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS-WRITE] ${requestId} - Error al eliminar:`, error);

        res.status(500).json({
            success: false,
            error: 'Error al eliminar presupuesto',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
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

console.log('✅ [PRESUPUESTOS-WRITE] Controlador de escritura configurado');

module.exports = {
    crearPresupuesto,
    editarPresupuesto,
    eliminarPresupuesto,
    reintentarPresupuesto,
    obtenerEstadoPresupuesto
};
