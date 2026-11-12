const { pool } = require('../config/database');
const cuentasBancariasService = require('../services/cuentasBancariasService');
const geminiService = require('../services/geminiService');
const { supabaseFetch } = require('../../produccion/utils/supabaseHelper');


/**
 * Obtiene el listado de todas las cuentas bancarias registradas
 */
async function listarCuentas(req, res, next) {
    try {
        console.log('🔍 [BANCARIO-CONTROLLER] Solicitando listado de cuentas bancarias...');
        const query = `
            SELECT id, banco, titular, tipo_cuenta, numero_cuenta, cbu, alias, saldo, estado, creado_en, actualizado_en
            FROM public.fin_cuentas_bancarias
            ORDER BY id ASC
        `;
        const resultado = await pool.query(query);
        res.json({
            success: true,
            data: resultado.rows
        });
    } catch (error) {
        console.error('❌ [BANCARIO-CONTROLLER] Error al listar cuentas:', error.message);
        next(error);
    }
}

/**
 * Obtiene los movimientos de una cuenta bancaria con filtros opcionales y orden cronológico
 */
async function listarMovimientos(req, res, next) {
    try {
        const cuentaId = parseInt(req.params.id, 10);
        const { busqueda, tipo } = req.query;
        
        console.log(`🔍 [BANCARIO-CONTROLLER] Solicitando movimientos para cuenta ID ${cuentaId}...`);
        
        // Verificar primero que la cuenta existe
        const checkCuenta = await pool.query('SELECT id FROM public.fin_cuentas_bancarias WHERE id = $1', [cuentaId]);
        if (checkCuenta.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Cuenta bancaria no encontrada'
            });
        }
        
        // Armar query dinámica
        let sql = `
            SELECT m.id, m.cuenta_id, m.fecha_movimiento, m.concepto, m.tipo_operacion, 
                   m.debito, m.credito, m.referencia, m.saldo_resultante, m.creado_en,
                   m.cuit_extraido, m.referencia_operacion, m.cliente_id, m.estado_clasificacion, m.metadata_adicional,
                   c.razon_social as cliente_razon_social
            FROM public.fin_movimientos_bancarios m
            LEFT JOIN public.bunker_clientes c ON m.cliente_id = c.id
            WHERE m.cuenta_id = $1
        `;
        
        const params = [cuentaId];
        let paramIndex = 2;
        
        if (busqueda && busqueda.trim() !== '') {
            sql += ` AND (m.concepto ILIKE $${paramIndex} OR m.referencia ILIKE $${paramIndex})`;
            params.push(`%${busqueda.trim()}%`);
            paramIndex++;
        }
        
        if (tipo && tipo !== 'TODOS') {
            sql += ` AND m.tipo_operacion = $${paramIndex}`;
            params.push(tipo);
            paramIndex++;
        }
        
        // Ordenar cronológicamente descendiente (los más recientes primero)
        sql += ` ORDER BY m.fecha_movimiento DESC, m.id DESC`;
        
        const resultado = await pool.query(sql, params);
        
        // Precargar clientes y alias aprendidos en 2 únicas consultas SQL (evita tormenta N+1 de +3.000 queries)
        const hayNoVinculados = resultado.rows.some(r => !r.cliente_id);
        const mapaClientesPorCuit = new Map();
        const mapaAliasPorCuit = new Map();
        const mapaAliasPorCbu = new Map();
        let listaAliasTitular = [];
        let listaClientes = [];

        if (hayNoVinculados) {
            const [resClientes, resAliases] = await Promise.all([
                pool.query(`
                    SELECT id, razon_social, cliente_nombre, cuit_cuil AS cuit, codigo_bunker_cliente,
                           REPLACE(COALESCE(cuit_cuil, ''), '-', '') AS cuit_limpio
                    FROM public.bunker_clientes
                `),
                pool.query(`
                    SELECT a.cliente_id, a.cuit_origen, a.cbu_cvu_origen, a.titular_origen, a.veces_vinculado, a.actualizado_en,
                           c.razon_social, c.cliente_nombre, c.cuit_cuil AS cuit, c.codigo_bunker_cliente
                    FROM public.fin_alias_bancarios_clientes a
                    JOIN public.bunker_clientes c ON a.cliente_id = c.id
                    ORDER BY a.veces_vinculado DESC, a.actualizado_en DESC
                `)
            ]);

            listaClientes = resClientes.rows.map(c => {
                if (c.cuit_limpio && !mapaClientesPorCuit.has(c.cuit_limpio)) {
                    mapaClientesPorCuit.set(c.cuit_limpio, c);
                }
                return {
                    ...c,
                    rs_lower: (c.razon_social || '').toLowerCase(),
                    cn_lower: (c.cliente_nombre || '').toLowerCase()
                };
            });

            for (const a of resAliases.rows) {
                if (a.cuit_origen && !mapaAliasPorCuit.has(a.cuit_origen)) {
                    mapaAliasPorCuit.set(a.cuit_origen, a);
                }
                if (a.cbu_cvu_origen && !mapaAliasPorCbu.has(a.cbu_cvu_origen)) {
                    mapaAliasPorCbu.set(a.cbu_cvu_origen, a);
                }
                if (a.titular_origen && a.titular_origen.trim().length > 0) {
                    listaAliasTitular.push({
                        ...a,
                        titular_lower: a.titular_origen.toLowerCase()
                    });
                }
            }
        }

        // Resolver pre-conciliaciones sugeridas dinámicamente en memoria (< 5ms para +1.200 filas)
        for (const row of resultado.rows) {
            row.sugerencia_cliente = null;
            if (!row.cliente_id) {
                const datos = cuentasBancariasService.extraerDatosBancariosDeConcepto(row.concepto, row.cuit_extraido);
                const cleanCuit = datos.cuit;
                const cleanCbu = datos.cbu;
                const titular = datos.titular;

                // 1. Intentar coincidencia exacta de CUIT oficial en bunker_clientes
                if (cleanCuit && mapaClientesPorCuit.has(cleanCuit)) {
                    const c = mapaClientesPorCuit.get(cleanCuit);
                    row.sugerencia_cliente = {
                        id: c.id,
                        razon_social: c.razon_social,
                        cliente_nombre: c.cliente_nombre,
                        cuit: c.cuit,
                        codigo_bunker: c.codigo_bunker_cliente,
                        tipo: 'cuit',
                        motivo: 'CUIT fiscal registrado en ficha oficial del cliente'
                    };
                    continue;
                }

                // 2. Intentar coincidencia por CUIT aprendido en fin_alias_bancarios_clientes
                if (cleanCuit && mapaAliasPorCuit.has(cleanCuit)) {
                    const r = mapaAliasPorCuit.get(cleanCuit);
                    row.sugerencia_cliente = {
                        id: r.cliente_id,
                        razon_social: r.razon_social,
                        cliente_nombre: r.cliente_nombre,
                        cuit: r.cuit,
                        codigo_bunker: r.codigo_bunker_cliente,
                        tipo: 'aprendido',
                        motivo: `Vínculo aprendido de transferencias anteriores (${r.veces_vinculado} ${r.veces_vinculado === 1 ? 'vez' : 'veces'})`,
                        titular_detectado: r.titular_origen || titular,
                        cuit_detectado: cleanCuit
                    };
                    continue;
                }

                // 3. Intentar coincidencia por CBU / CVU (22 dígitos) aprendido en fin_alias_bancarios_clientes
                if (cleanCbu && mapaAliasPorCbu.has(cleanCbu)) {
                    const r = mapaAliasPorCbu.get(cleanCbu);
                    row.sugerencia_cliente = {
                        id: r.cliente_id,
                        razon_social: r.razon_social,
                        cliente_nombre: r.cliente_nombre,
                        cuit: r.cuit,
                        codigo_bunker: r.codigo_bunker_cliente,
                        tipo: 'aprendido',
                        motivo: `CBU/CVU aprendido de transferencias anteriores (${r.veces_vinculado} ${r.veces_vinculado === 1 ? 'vez' : 'veces'})`,
                        titular_detectado: r.titular_origen || titular,
                        cbu_detectado: cleanCbu
                    };
                    continue;
                }

                // 4. Intentar coincidencia por Titular aprendido o coincidencia difusa de nombre
                const nombreABuscar = titular || (row.metadata_adicional && row.metadata_adicional.nombre_entidad_ia);
                if (nombreABuscar && nombreABuscar.trim().length > 3) {
                    const busqLower = nombreABuscar.trim().toLowerCase();
                    const r = listaAliasTitular.find(a => a.titular_lower.includes(busqLower));
                    if (r) {
                        row.sugerencia_cliente = {
                            id: r.cliente_id,
                            razon_social: r.razon_social,
                            cliente_nombre: r.cliente_nombre,
                            cuit: r.cuit,
                            codigo_bunker: r.codigo_bunker_cliente,
                            tipo: 'aprendido',
                            motivo: `Titular aprendido de transferencias anteriores (${r.veces_vinculado} ${r.veces_vinculado === 1 ? 'vez' : 'veces'})`,
                            titular_detectado: r.titular_origen
                        };
                        continue;
                    }

                    // Fallback: coincidencia difusa en bunker_clientes
                    const c = listaClientes.find(cl => cl.rs_lower.includes(busqLower) || cl.cn_lower.includes(busqLower));
                    if (c) {
                        row.sugerencia_cliente = {
                            id: c.id,
                            razon_social: c.razon_social,
                            cliente_nombre: c.cliente_nombre,
                            cuit: c.cuit,
                            codigo_bunker: c.codigo_bunker_cliente,
                            tipo: 'nombre',
                            motivo: 'Coincidencia de nombre comercial o razón social'
                        };
                    }
                }
            }
        }
        
        // Obtener el total general de movimientos sin filtrar para esta cuenta
        const totalCountRes = await pool.query('SELECT COUNT(*) FROM public.fin_movimientos_bancarios WHERE cuenta_id = $1', [cuentaId]);
        const totalCount = parseInt(totalCountRes.rows[0].count, 10);

        res.json({
            success: true,
            data: resultado.rows,
            totalCount: totalCount
        });
    } catch (error) {
        console.error('❌ [BANCARIO-CONTROLLER] Error al listar movimientos:', error.message);
        next(error);
    }
}

/**
 * Procesa el archivo subido de extracto Galicia para la cuenta especificada
 */
async function ingestaExtracto(req, res, next) {
    try {
        const cuentaId = parseInt(req.params.id, 10);
        console.log(`📥 [BANCARIO-CONTROLLER] Petición de ingesta de extracto para cuenta ID: ${cuentaId}`);
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No se subió ningún archivo'
            });
        }
        
        // Verificar que la cuenta exista
        const checkCuenta = await pool.query('SELECT id, banco FROM public.fin_cuentas_bancarias WHERE id = $1', [cuentaId]);
        if (checkCuenta.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Cuenta bancaria no encontrada'
            });
        }
        
        const result = await cuentasBancariasService.procesarExtractoGalicia(cuentaId, req.file.buffer);
        
        res.json({
            success: true,
            message: 'Extracto procesado exitosamente',
            data: {
                total: result.total,
                insertados: result.insertados,
                duplicados: result.duplicados,
                clasificadosRegla: result.clasificadosRegla,
                clasificadosIA: result.clasificadosIA,
                estadoIA: result.estadoIA
            }
        });
        
    } catch (error) {
        console.error('❌ [BANCARIO-CONTROLLER] Error en proceso de ingesta:', error.message);
        res.status(400).json({
            success: false,
            error: 'Error al procesar el archivo del extracto',
            message: error.message
        });
    }
}

/**
 * Vincula manualmente un movimiento bancario con un cliente de Búnker (Human-in-the-Loop)
 */
/**
 * Recalcula de forma robusta el saldo de una cuenta corriente a partir de su historial cronológico
 */
async function recalcularSaldoCuentaCorriente(ccId, dbClient) {
    // 1. Obtener el saldo de apertura
    const resCC = await dbClient.query(
        `SELECT saldo_apertura FROM public.factura_cuentas_corrientes WHERE id = $1`,
        [ccId]
    );
    const saldoApertura = resCC.rows.length > 0 ? parseFloat(resCC.rows[0].saldo_apertura) || 0 : 0;
    console.log(`[CC-RECALCULO] Saldo de Apertura registrado para Cuenta ID ${ccId}: $${saldoApertura}`);

    // 2. Obtener todos los movimientos ordenados por fecha y ID
    const queryMovs = `
        SELECT id, tipo_movimiento, monto 
        FROM public.factura_cuenta_corriente_movimientos 
        WHERE cuenta_corriente_id = $1 
        ORDER BY fecha_movimiento ASC, id ASC
    `;
    const resMovs = await dbClient.query(queryMovs, [ccId]);
    
    let saldoAcumulado = saldoApertura;
    for (const mov of resMovs.rows) {
        const monto = parseFloat(mov.monto) || 0;
        if (mov.tipo_movimiento === 'DEBITO') {
            saldoAcumulado += monto;
        } else if (mov.tipo_movimiento === 'CREDITO') {
            saldoAcumulado -= monto;
        }
        saldoAcumulado = parseFloat(saldoAcumulado.toFixed(2));
        
        await dbClient.query(
            `UPDATE public.factura_cuenta_corriente_movimientos 
             SET saldo_resultante = $1 
             WHERE id = $2`,
            [saldoAcumulado, mov.id]
        );
    }
    
    // 3. Actualizar el saldo final consolidado
    await dbClient.query(
        'UPDATE public.factura_cuentas_corrientes SET saldo = $1, actualizada_en = CURRENT_TIMESTAMP WHERE id = $2',
        [saldoAcumulado, ccId]
    );
    
    console.log(`[CC-RECALCULO] Saldo de Cuenta Corriente ID ${ccId} recalculado a: ${saldoAcumulado}`);
    return saldoAcumulado;
}

/**
 * Vincula manualmente un movimiento bancario con un cliente de Búnker (Human-in-the-Loop)
 * Afecta de forma transaccional la cuenta corriente comercial del cliente.
 */
async function vincularCliente(req, res, next) {
    const dbClient = await pool.connect();
    try {
        const movimientoId = parseInt(req.params.id, 10);
        const { clienteId, aplicarAjuste, montoAjuste, modoFinanciacion } = req.body;
        const modoFinNorm = String(modoFinanciacion || 'BONIFICAR').toUpperCase();
        
        console.log(`🔗 [BANCARIO-CONTROLLER] Iniciando transacción de vinculación para movimiento ID ${movimientoId} (modoFinanciacion: ${modoFinNorm})...`);
        
        await dbClient.query('BEGIN');
        
        // 1. Obtener y verificar el movimiento bancario
        const checkMov = await dbClient.query(
            'SELECT id, concepto, debito, credito, fecha_movimiento, cliente_id FROM public.fin_movimientos_bancarios WHERE id = $1 FOR UPDATE',
            [movimientoId]
        );
        if (checkMov.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Movimiento bancario no encontrado'
            });
        }
        
        const movimiento = checkMov.rows[0];
        const clienteIdAnterior = movimiento.cliente_id;
        
        // 2. Si el movimiento ya estaba vinculado (y se está desvinculando, cambiando de cliente o re-vinculando con modoFinanciacion), deshacer afectación previa
        if (clienteIdAnterior && (clienteIdAnterior !== clienteId || modoFinanciacion)) {
            console.log(`❌ [BANCARIO-CONTROLLER] Limpiando afectación previa en Cuenta Corriente del cliente ID ${clienteIdAnterior}...`);
            const resClAnt = await dbClient.query('SELECT codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1', [clienteIdAnterior]);
            if (resClAnt.rowCount > 0) {
                const codBunkerAnt = resClAnt.rows[0].codigo_bunker_cliente;
                const resCCAnt = await dbClient.query(
                    'SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = \'Cuenta Principal\' FOR UPDATE',
                    [codBunkerAnt]
                );
                if (resCCAnt.rowCount > 0) {
                    const ccIdAnt = resCCAnt.rows[0].id;
                    // Si había un borrador de factura de financiación asociado a este movimiento bancario, limpiarlo si sigue en BORRADOR
                    const resMovsPrev = await dbClient.query(
                        `SELECT id, comprobante_id
                         FROM public.factura_cuenta_corriente_movimientos
                         WHERE cuenta_corriente_id = $1
                           AND (descripcion LIKE '%[Mov: ' || $2 || ']%' OR metadatos->>'movimiento_bancario_id' = $2::text)`,
                        [ccIdAnt, movimientoId]
                    );
                    for (const mp of resMovsPrev.rows) {
                        if (mp.comprobante_id) {
                            const fCheck = await dbClient.query(
                                `SELECT id, estado FROM public.factura_facturas WHERE id = $1`,
                                [mp.comprobante_id]
                            );
                            if (fCheck.rows.length > 0 && fCheck.rows[0].estado === 'BORRADOR') {
                                await dbClient.query(`DELETE FROM public.factura_factura_items WHERE factura_id = $1`, [mp.comprobante_id]);
                                await dbClient.query(`DELETE FROM public.factura_facturas WHERE id = $1 AND estado = 'BORRADOR'`, [mp.comprobante_id]);
                            }
                        }
                    }
                    await dbClient.query(
                        `DELETE FROM public.factura_cuenta_corriente_movimientos
                         WHERE cuenta_corriente_id = $1
                           AND (descripcion LIKE '%[Mov: ' || $2 || ']%' OR metadatos->>'movimiento_bancario_id' = $2::text)`,
                        [ccIdAnt, movimientoId]
                    );
                    await recalcularSaldoCuentaCorriente(ccIdAnt, dbClient);
                }
            }
        }
        
        // Caso Desvinculación total:
        if (clienteId === null || clienteId === undefined) {
            await dbClient.query(
                'UPDATE public.fin_movimientos_bancarios SET cliente_id = NULL WHERE id = $1',
                [movimientoId]
            );
            await dbClient.query('COMMIT');
            console.log(`✅ [BANCARIO-CONTROLLER] Movimiento ID ${movimientoId} desvinculado con éxito.`);
            return res.json({
                success: true,
                message: 'Movimiento desvinculado con éxito'
            });
        }
        
        // 3. Verificar que el nuevo cliente existe
        const checkCliente = await dbClient.query(
            `SELECT id, razon_social, cliente_nombre, codigo_bunker_cliente, cuit_cuil, condicion_iva, lomas_soft_id
             FROM public.bunker_clientes WHERE id = $1`,
            [clienteId]
        );
        if (checkCliente.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Cliente de Búnker no encontrado'
            });
        }
        
        const clienteNuevo = checkCliente.rows[0];
        let movCC = null;
        let movInteresCC = null;
        let movDebitoInteresCC = null;
        let desgloseFinanciacionInfo = null;
        let saldoPostPago = 0;
        
        // 4. Si la vinculación es nueva, cambió el destinatario o se re-vincula con modoFinanciacion, registrar la transacción en la CC
        if (clienteIdAnterior !== clienteId || modoFinanciacion) {
            console.log(`➕ [BANCARIO-CONTROLLER] Registrando movimiento en Cuenta Corriente para cliente ${clienteNuevo.codigo_bunker_cliente}...`);
            
            // Obtener o crear la Cuenta Principal
            let ccIdNuevo;
            const resCCNuevo = await dbClient.query(
                'SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = \'Cuenta Principal\' FOR UPDATE',
                [clienteNuevo.codigo_bunker_cliente]
            );
            
            if (resCCNuevo.rowCount === 0) {
                const resNuevaCC = await dbClient.query(
                    'INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo) VALUES ($1, \'Cuenta Principal\', \'ARS\', 0.00) RETURNING id',
                    [clienteNuevo.codigo_bunker_cliente]
                );
                ccIdNuevo = resNuevaCC.rows[0].id;
            } else {
                ccIdNuevo = resCCNuevo.rows[0].id;
            }
            
            // Determinar importes con precisión (evitando fallos de truthy en strings '0.00')
            const credito = parseFloat(movimiento.credito || 0);
            const debito = parseFloat(movimiento.debito || 0);
            const esDebito = debito > 0 && credito === 0;
            const monto = esDebito ? debito : credito;
            
            if (monto > 0) {
                const tipoMovCC = esDebito ? 'DEBITO' : 'CREDITO';
                const tipoCompCC = esDebito ? 'PAGO_A_CLIENTE' : 'COBRO_BANCARIO';
                const conceptoCorto = String(movimiento.concepto || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 75);
                const descCC = `${esDebito ? 'Pago Emitido a Cliente/Colaborador' : 'Cobro'} Bancario Galicia [Mov: ${movimientoId}] - Concepto: ${movimiento.concepto.substring(0, 80)}`;
                
                let fechaMovFinal = new Date(movimiento.fecha_movimiento);
                if (fechaMovFinal.getUTCHours() === 3 && fechaMovFinal.getUTCMinutes() === 0 && fechaMovFinal.getUTCSeconds() === 0) {
                    fechaMovFinal = new Date(fechaMovFinal.getTime() + (23 * 3600 + 59 * 60) * 1000);
                } else if (fechaMovFinal.getHours() === 0 && fechaMovFinal.getMinutes() === 0 && fechaMovFinal.getSeconds() === 0) {
                    fechaMovFinal.setHours(23, 59, 0, 0);
                }

                const fmtMoneda = (val) => {
                    const parts = (parseFloat(val) || 0).toFixed(2).split('.');
                    return `$ ${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${parts[1]}`;
                };

                // Si es un COBRO RECIBIDO (!esDebito), simular imputación FIFO antes de insertar los movimientos
                let simImputacion = null;
                if (!esDebito) {
                    try {
                        delete require.cache[require.resolve('../../logistica/services/composicionSaldoService')];
                        const composicionSaldoService = require('../../logistica/services/composicionSaldoService');
                        simImputacion = await composicionSaldoService.simularImputacionPago(ccIdNuevo, monto, dbClient);
                    } catch (errSim) {
                        console.warn('⚠️ [BANCARIO-CONTROLLER] Aviso simulando imputación de pago bancario:', errSim.message);
                    }
                }

                const cobrarFinanciacion = !esDebito &&
                    modoFinNorm !== 'BONIFICAR' &&
                    simImputacion &&
                    simImputacion.tiene_financiacion_imputada &&
                    simImputacion.financiacion_con_iva_cancelada > 0.005;

                if (cobrarFinanciacion) {
                    const capCancelado = simImputacion.capital_cancelado_total;
                    const intNeto = simImputacion.financiacion_neta_cancelada;
                    const intIva = simImputacion.financiacion_iva_cancelada;
                    const intConIva = simImputacion.financiacion_con_iva_cancelada;
                    const detallesFin = (simImputacion.detalles_comprobantes || []).filter(d => d.con_financiacion);
                    const resumenDocs = detallesFin.map(d => {
                        const nomCorto = (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
                        return `${nomCorto} (${d.dias_al_pago}d al ${d.tasa_tem || 3}% mensual)`;
                    }).join(' + ');
                    const resumenFacturasCorto = (simImputacion.detalles_comprobantes || []).map(d => {
                        return (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
                    }).join(' + ') || 'comprobante en cuenta corriente';
                    const diasMaxFin = detallesFin.length > 0 ? detallesFin[0].dias_al_pago : 15;

                    const facturaService = require('../services/facturaService');
                    const clienteIdNum = parseInt(String(clienteNuevo.lomas_soft_id || '').replace(/\D/g, ''), 10) || clienteNuevo.id || 1;
                    const cuitStr = String(clienteNuevo.cuit_cuil || '').replace(/\D/g, '');
                    const condIvaStr = String(clienteNuevo.condicion_iva || '').toLowerCase();
                    const esRI = condIvaStr.includes('inscripto');
                    const condicionIvaId = esRI ? 1 : (condIvaStr.includes('monotrib') ? 6 : (condIvaStr.includes('exento') ? 4 : 5));
                    const docTipo = cuitStr.length === 11 ? 80 : 96;
                    const docNro = cuitStr || '0';

                    const esCircuitoArca = ['DESGLOSAR_ARCA', 'APROBACION_ARCA', 'BANDEJA_ARCA', 'ARCA'].includes(modoFinNorm);
                    const emitirAhora = (modoFinNorm === 'ARCA' || modoFinNorm === 'INTERNA');
                    const modoGuardado = esCircuitoArca
                        ? (emitirAhora ? 'ARCA' : 'APROBACION_ARCA')
                        : (emitirAhora ? 'INTERNA' : 'APROBACION_INTERNA');
                    const ptoVta = esCircuitoArca ? 32 : 90;
                    const tipoCbte = esCircuitoArca ? (esRI ? 1 : 6) : 6;
                    const ahoraDate = new Date();
                    const fechaEmisionStr = ahoraDate.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
                    const descItem = `Servicio de Financiación LAMDA s/ capital cancelado (${fmtMoneda(capCancelado)}) de ${resumenDocs || 'cuenta corriente'} — Transferencia Bancaria [Mov: ${movimientoId}]`;

                    const borrador = await facturaService.crearBorrador({
                        tipo_cbte: tipoCbte,
                        pto_vta: ptoVta,
                        concepto: 1,
                        fecha_emision: fechaEmisionStr,
                        precio_modo: 'NETO',
                        requiere_afip: esCircuitoArca,
                        serie_interna: esCircuitoArca ? null : 'X',
                        stock_descontado: true,
                        mover_stock: false,
                        origen_comprobante: 'FINANCIACION_SALVAVIDAS',
                        cliente: {
                            cliente_id: clienteIdNum,
                            doc_tipo: docTipo,
                            doc_nro: docNro,
                            condicion_iva_id: condicionIvaId
                        },
                        items: [
                            {
                                articulo_id: 'SERV-FIN-LAMDA',
                                descripcion: descItem,
                                qty: 1,
                                p_unit: intNeto,
                                alic_iva_id: 1,
                                costo_unitario: 0.0001
                            }
                        ]
                    });

                    await dbClient.query(
                        `UPDATE public.factura_facturas
                         SET imp_neto = $1, imp_iva = $2, imp_total = $3, stock_descontado = TRUE
                         WHERE id = $4`,
                        [intNeto, intIva, intConIva, borrador.id]
                    );
                    await dbClient.query(
                        `UPDATE public.factura_factura_items
                         SET p_unit = $1, imp_neto = $1, imp_iva = $2
                         WHERE factura_id = $3`,
                        [intNeto, intIva, borrador.id]
                    );

                    let facturaFinal = borrador;
                    let etiquetaComp = '';
                    let tipoCompMovDebito = 'PENDIENTE_FACTURACION';

                    if (emitirAhora) {
                        facturaFinal = await facturaService.emitir(borrador.id);
                        tipoCompMovDebito = 'FACTURA';
                        if (esCircuitoArca && facturaFinal.estado === 'APROBADA') {
                            const ptoPad = String(facturaFinal.pto_vta).padStart(4, '0');
                            const nroPad = String(facturaFinal.cbte_nro).padStart(8, '0');
                            const letraStr = tipoCbte === 1 ? 'Factura A' : 'Factura B';
                            etiquetaComp = `${letraStr} ${ptoPad}-${nroPad} (CAE: ${facturaFinal.cae || 'N/A'})`;
                        } else {
                            const nroIntPad = String(facturaFinal.nro_interno || facturaFinal.cbte_nro || facturaFinal.id).padStart(8, '0');
                            etiquetaComp = `Fac X0090-${nroIntPad}`;
                        }
                    } else {
                        if (esCircuitoArca) {
                            const letraStr = tipoCbte === 1 ? 'Factura A' : 'Factura B';
                            etiquetaComp = `${letraStr} Pto. 0032 (Pend. CAE en ARCA #${borrador.id})`;
                        } else {
                            etiquetaComp = `Comp. Interno X0090 (En Aprobación #${borrador.id})`;
                        }
                    }

                    const fechaDebitoInteres = new Date(fechaMovFinal.getTime() - 2000);
                    const fechaCreditoInteres = new Date(fechaMovFinal.getTime() - 1000);
                    const fechaCreditoCapital = fechaMovFinal;

                    const descMovDebito = `${etiquetaComp} — Servicio Financiación ${diasMaxFin}d (Transf. [Mov: ${movimientoId}])`;
                    const metaDebito = {
                        es_cargo_financiacion: true,
                        modo_facturacion: modoGuardado,
                        movimiento_bancario_id: movimientoId,
                        monto_total_sobre: monto,
                        capital_cancelado: capCancelado,
                        financiacion_neta: intNeto,
                        financiacion_iva: intIva,
                        financiacion_con_iva: intConIva,
                        detalles_comprobantes: simImputacion.detalles_comprobantes
                    };

                    const existDebRes = await dbClient.query(
                        `SELECT id FROM public.factura_cuenta_corriente_movimientos WHERE cuenta_corriente_id = $1 AND comprobante_id = $2`,
                        [ccIdNuevo, facturaFinal.id]
                    );
                    if (existDebRes.rows.length > 0) {
                        const upDeb = await dbClient.query(
                            `UPDATE public.factura_cuenta_corriente_movimientos
                             SET descripcion = $1, fecha_movimiento = $2, metadatos = $3::jsonb
                             WHERE id = $4
                             RETURNING *`,
                            [descMovDebito, fechaDebitoInteres, JSON.stringify(metaDebito), existDebRes.rows[0].id]
                        );
                        movDebitoInteresCC = upDeb.rows[0];
                    } else {
                        const insDeb = await dbClient.query(
                            `INSERT INTO public.factura_cuenta_corriente_movimientos (
                                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento, metadatos
                             ) VALUES ($1, 'DEBITO', $2, 0.00, $3, $4, $5, $6, $7)
                             RETURNING *`,
                            [ccIdNuevo, intConIva, tipoCompMovDebito, facturaFinal.id, descMovDebito, fechaDebitoInteres, JSON.stringify(metaDebito)]
                        );
                        movDebitoInteresCC = insDeb.rows[0];
                    }

                    // Crédito 1: Cancelación del Interés de Financiación
                    const descMovInteres = `Cobro Bancario [Mov: ${movimientoId}] — Cancelación Interés Financiación ${diasMaxFin}d (Parte de transf. ${fmtMoneda(monto)}) - Concepto: ${conceptoCorto}`;
                    const metaInteres = {
                        tipo_pago: 'Transferencia Bancaria',
                        banco_origen: 'Transferencia Bancaria',
                        nro_operacion: String(movimientoId),
                        movimiento_bancario_id: movimientoId,
                        es_pago_financiacion: true,
                        es_desglose_separado_en_cc: true,
                        monto_total_sobre: monto,
                        capital_cancelado_sobre: capCancelado,
                        financiacion_neta_sobre: intNeto,
                        financiacion_iva_sobre: intIva,
                        financiacion_con_iva_sobre: intConIva,
                        financiacion_facturada_id: facturaFinal.id,
                        financiacion_facturada_mov_id: movDebitoInteresCC.id,
                        financiacion_facturada_nro: etiquetaComp,
                        financiacion_facturada_modo: modoGuardado,
                        detalles_comprobantes: simImputacion.detalles_comprobantes
                    };

                    const resMovInt = await dbClient.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, descripcion, fecha_movimiento, metadatos
                         ) VALUES ($1, 'CREDITO', $2, 0.00, 'COBRO_BANCARIO', $3, $4, $5)
                         RETURNING id, cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, tipo_comprobante, fecha_movimiento, descripcion, metadatos`,
                        [ccIdNuevo, intConIva, descMovInteres, fechaCreditoInteres, JSON.stringify(metaInteres)]
                    );
                    movInteresCC = resMovInt.rows[0];

                    // Crédito 2: Cancelación del Capital ya facturado
                    const descMovCapital = `Cobro Bancario [Mov: ${movimientoId}] — Cancelación Capital s/ ${resumenFacturasCorto} (Parte de transf. ${fmtMoneda(monto)}) - Concepto: ${conceptoCorto}`;
                    const metaCapital = {
                        tipo_pago: 'Transferencia Bancaria',
                        banco_origen: 'Transferencia Bancaria',
                        nro_operacion: String(movimientoId),
                        movimiento_bancario_id: movimientoId,
                        es_pago_capital_separado: true,
                        es_desglose_separado_en_cc: true,
                        pago_interes_mov_id: movInteresCC.id,
                        debito_interes_mov_id: movDebitoInteresCC.id,
                        monto_total_sobre: monto,
                        capital_cancelado_sobre: capCancelado,
                        financiacion_neta_sobre: intNeto,
                        financiacion_iva_sobre: intIva,
                        financiacion_con_iva_sobre: intConIva,
                        financiacion_facturada_id: facturaFinal.id,
                        financiacion_facturada_mov_id: movDebitoInteresCC.id,
                        financiacion_facturada_nro: etiquetaComp,
                        financiacion_facturada_modo: modoGuardado,
                        detalles_comprobantes: simImputacion.detalles_comprobantes
                    };

                    const resMovCap = await dbClient.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, descripcion, fecha_movimiento, metadatos
                         ) VALUES ($1, 'CREDITO', $2, 0.00, 'COBRO_BANCARIO', $3, $4, $5)
                         RETURNING id, cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, tipo_comprobante, fecha_movimiento, descripcion, metadatos`,
                        [ccIdNuevo, capCancelado, descMovCapital, fechaCreditoCapital, JSON.stringify(metaCapital)]
                    );
                    movCC = resMovCap.rows[0];

                    // Vincular cruzadamente los IDs en los movimientos de interés y débito
                    await dbClient.query(
                        `UPDATE public.factura_cuenta_corriente_movimientos
                         SET metadatos = metadatos || $1::jsonb
                         WHERE id = $2`,
                        [JSON.stringify({ pago_capital_mov_id: movCC.id }), movInteresCC.id]
                    );
                    await dbClient.query(
                        `UPDATE public.factura_cuenta_corriente_movimientos
                         SET metadatos = metadatos || $1::jsonb
                         WHERE id = $2`,
                        [JSON.stringify({ pago_origen_id: movCC.id, pago_interes_mov_id: movInteresCC.id }), movDebitoInteresCC.id]
                    );

                    desgloseFinanciacionInfo = {
                        factura_id: facturaFinal.id,
                        estado: facturaFinal.estado,
                        modo_facturacion: modoGuardado,
                        etiqueta_comprobante: etiquetaComp,
                        capital_cancelado: capCancelado,
                        financiacion_neta: intNeto,
                        financiacion_iva: intIva,
                        financiacion_con_iva: intConIva,
                        movimiento_capital_id: movCC.id,
                        movimiento_interes_id: movInteresCC.id,
                        movimiento_debito_id: movDebitoInteresCC.id
                    };
                } else {
                    const metaSimple = {
                        tipo_pago: esDebito ? 'Transferencia Bancaria Emitida' : 'Transferencia Bancaria',
                        nro_operacion: String(movimientoId),
                        movimiento_bancario_id: movimientoId
                    };
                    if (!esDebito && modoFinNorm === 'BONIFICAR' && simImputacion && simImputacion.financiacion_con_iva_cancelada > 0.005) {
                        metaSimple.financiacion_bonificada = true;
                        metaSimple.financiacion_bonificada_con_iva = simImputacion.financiacion_con_iva_cancelada;
                    }

                    // Insertar el movimiento único en la Cuenta Corriente
                    const resInsertCC = await dbClient.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento, metadatos
                        ) VALUES ($1, $2, $3, 0.00, $4, NULL, $5, $6, $7)
                        RETURNING id, cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, tipo_comprobante, fecha_movimiento, descripcion, metadatos`,
                        [
                            ccIdNuevo,
                            tipoMovCC,
                            monto,
                            tipoCompCC,
                            descCC,
                            fechaMovFinal,
                            JSON.stringify(metaSimple)
                        ]
                    );
                    movCC = resInsertCC.rows[0];
                }
                
                // Recalcular saldo acumulado de la nueva cuenta
                saldoPostPago = await recalcularSaldoCuentaCorriente(ccIdNuevo, dbClient);
                if (movCC) {
                    movCC.saldo_resultante = saldoPostPago;
                    if (!movCC.numero_comprobante) {
                        movCC.numero_comprobante = esDebito
                            ? `PAGO-TRANSF-${String(movCC.id).padStart(8, '0')}`
                            : `REC-PAGO-${String(movCC.id).padStart(8, '0')}`;
                    }
                }

                // 4b. Si se solicitó ajuste automático de saldo para netear la cuenta a cero
                if (aplicarAjuste) {
                    if (Math.abs(saldoPostPago) > 0.001) {
                        const tipoMovAjuste = saldoPostPago > 0 ? 'CREDITO' : 'DEBITO';
                        const valAjuste = parseFloat(Math.abs(saldoPostPago).toFixed(2));
                        const descAjuste = `Ajuste automático de saldo por vinculación bancaria [Mov: ${movimientoId}]`;

                        await dbClient.query(
                            `INSERT INTO public.factura_cuenta_corriente_movimientos (
                                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento
                            ) VALUES ($1, $2, $3, 0.00, 'AJUSTE_REDONDEO', NULL, $4, CURRENT_TIMESTAMP)`,
                            [
                                ccIdNuevo,
                                tipoMovAjuste,
                                valAjuste,
                                descAjuste
                            ]
                        );

                        saldoPostPago = await recalcularSaldoCuentaCorriente(ccIdNuevo, dbClient);
                        if (movCC) movCC.saldo_resultante = saldoPostPago;
                        console.log(`⚡ [BANCARIO-CONTROLLER] Ajuste automático de saldo aplicado (${valAjuste}) para cliente ${clienteNuevo.codigo_bunker_cliente}.`);
                    }
                }
            }
        }
        
        // 5. Guardar la vinculación en el movimiento bancario
        await dbClient.query(
            'UPDATE public.fin_movimientos_bancarios SET cliente_id = $1 WHERE id = $2',
            [clienteId, movimientoId]
        );

        // 6. Aprender y registrar alias bancario (CUIT, CBU y Titular)
        const datosBancarios = cuentasBancariasService.extraerDatosBancariosDeConcepto(movimiento.concepto, movimiento.cuit_extraido);
        if (datosBancarios.cuit) {
            await dbClient.query(`
                INSERT INTO public.fin_alias_bancarios_clientes 
                    (cliente_id, cuit_origen, cbu_cvu_origen, titular_origen, veces_vinculado, origen)
                VALUES ($1, $2, $3, $4, 1, 'MANUAL')
                ON CONFLICT (cliente_id, cuit_origen) WHERE cuit_origen IS NOT NULL
                DO UPDATE SET 
                    veces_vinculado = fin_alias_bancarios_clientes.veces_vinculado + 1,
                    titular_origen = COALESCE(fin_alias_bancarios_clientes.titular_origen, EXCLUDED.titular_origen),
                    cbu_cvu_origen = COALESCE(fin_alias_bancarios_clientes.cbu_cvu_origen, EXCLUDED.cbu_cvu_origen),
                    actualizado_en = CURRENT_TIMESTAMP
            `, [clienteId, datosBancarios.cuit, datosBancarios.cbu, datosBancarios.titular]);
            console.log(`🧠 [BANCARIO-CONTROLLER] Alias bancario aprendido para cliente ID ${clienteId} (CUIT: ${datosBancarios.cuit}, Titular: ${datosBancarios.titular}).`);
        } else if (datosBancarios.cbu) {
            await dbClient.query(`
                INSERT INTO public.fin_alias_bancarios_clientes 
                    (cliente_id, cuit_origen, cbu_cvu_origen, titular_origen, veces_vinculado, origen)
                VALUES ($1, NULL, $2, $3, 1, 'MANUAL')
                ON CONFLICT (cliente_id, cbu_cvu_origen) WHERE cbu_cvu_origen IS NOT NULL
                DO UPDATE SET 
                    veces_vinculado = fin_alias_bancarios_clientes.veces_vinculado + 1,
                    titular_origen = COALESCE(fin_alias_bancarios_clientes.titular_origen, EXCLUDED.titular_origen),
                    actualizado_en = CURRENT_TIMESTAMP
            `, [clienteId, datosBancarios.cbu, datosBancarios.titular]);
            console.log(`🧠 [BANCARIO-CONTROLLER] Alias bancario aprendido para cliente ID ${clienteId} (CBU: ${datosBancarios.cbu}).`);
        }

        // 7. Consultar datos de contacto completos del cliente para el modal de WhatsApp
        const resClienteDetalle = await dbClient.query(`
            SELECT id, razon_social, cliente_nombre, cuit_cuil, codigo_bunker_cliente,
                   whatsapp_facturas, email_facturas, email_portal
            FROM public.bunker_clientes
            WHERE id = $1
        `, [clienteId]);
        const clienteCompleto = resClienteDetalle.rows[0];
        
        await dbClient.query('COMMIT');
        console.log(`✅ [BANCARIO-CONTROLLER] Movimiento ID ${movimientoId} vinculado con éxito al cliente ${clienteNuevo.codigo_bunker_cliente}.`);
        
        // Determinar sentido
        const creditoFin = parseFloat(movimiento.credito || 0);
        const debitoFin = parseFloat(movimiento.debito || 0);
        const esCobro = creditoFin > 0 || debitoFin === 0;

        res.json({
            success: true,
            message: 'Movimiento vinculado con éxito',
            data: {
                cliente_id: clienteId,
                cliente_razon_social: clienteNuevo.razon_social,
                cliente: clienteCompleto,
                movimiento_cc: movCC,
                movimiento_interes_cc: movInteresCC,
                movimiento_debito_interes_cc: movDebitoInteresCC,
                desglose_financiacion: desgloseFinanciacionInfo,
                saldo_cuenta_corriente: saldoPostPago,
                es_cobro: esCobro
            }
        });
        
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('❌ [BANCARIO-CONTROLLER] Error al vincular/desvincular cliente:', error.message);
        next(error);
    } finally {
        dbClient.release();
    }
}

/**
 * Obtiene el listado de clientes de Búnker para vincular movimientos
 */
async function listarClientesBunker(req, res, next) {
    try {
        console.log('🔍 [BANCARIO-CONTROLLER] Obteniendo clientes de Búnker...');
        const query = `
            SELECT 
                c.id, 
                c.razon_social, 
                c.cliente_nombre, 
                c.cuit_cuil AS cuit, 
                c.codigo_bunker_cliente AS codigo_bunker, 
                c.lomas_soft_id,
                cc.id AS cuenta_corriente_id,
                COALESCE(cc.saldo, 0.00) AS saldo_cuenta_corriente
            FROM public.bunker_clientes c
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = c.codigo_bunker_cliente
            ORDER BY c.razon_social ASC
        `;
        const result = await pool.query(query);
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('❌ [BANCARIO-CONTROLLER] Error al listar clientes de Búnker:', error.message);
        next(error);
    }
}

/**
 * Obtiene el listado de cheques desde la cartera centralizada de Supabase
 * cruzándola en memoria eficientemente con los datos de vinculación local.
 */
async function listarCheques(req, res, next) {
    try {
        console.log('🔍 [BANCARIO-CONTROLLER] Solicitando listado de cheques en cartera...');
        
        // 1. Obtener la clave de Supabase
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key || key === 'MISSING_ENV_KEY') {
            return res.status(500).json({
                success: false,
                error: 'Falta configurar la variable de entorno SUPABASE_SERVICE_KEY'
            });
        }
        
        // 2. Consultar Supabase con filtros dinámicos según el estado solicitado
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
        
        const estadoParam = (req.query.estado || 'EN_CARTERA').toUpperCase();
        let queryEstado = '';
        // En las tres solapas (En Cartera, Endosados e Histórico Completo) se ordena por fecha del cheque (fecha_pago)
        // posicionando los más recientes arriba de todo y los más antiguos al final.
        const orderClause = 'order=fecha_pago.desc.nullslast';

        if (estadoParam === 'EN_CARTERA') {
            queryEstado = '&estado_interno=eq.EN_CARTERA';
        } else if (estadoParam === 'ENDOSADO') {
            queryEstado = '&estado_interno=eq.ENDOSADO&proveedor_endosado_id=not.is.null';
        } else if (estadoParam === 'TODOS') {
            // Histórico completo: traer todos los estados excepto ENDOSADO, y limitar por defecto a los últimos 6 meses o nulos
            const seisMesesAtras = new Date();
            seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);
            const fechaLimiteStr = seisMesesAtras.toISOString().split('T')[0];
            queryEstado = `&estado_interno=neq.ENDOSADO&or=(fecha_pago.gte.${fechaLimiteStr},fecha_pago.is.null)`;
        } else {
            // Fallback por defecto
            queryEstado = '&estado_interno=eq.EN_CARTERA';
        }

        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/cheques_cartera?select=id,numero_cheque,banco_emisor,importe,fecha_pago,librador_razon_social,estado_interno,fecha_endoso,proveedor_endosado_id${queryEstado}&${orderClause}`;
        
        const response = await supabaseFetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Error en Supabase: ${await response.text()}`);
        }
        
        const chequesSupabase = await response.json();
        
        if (chequesSupabase.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }
        
        // Obtener nombres comerciales de los proveedores involucrados para cruzarlos en memoria (evitando el límite de 1000 filas)
        let proveedoresMap = new Map();
        if (estadoParam === 'ENDOSADO' || estadoParam === 'TODOS') {
            const proveedorIds = [...new Set(chequesSupabase.map(ch => ch.proveedor_endosado_id).filter(Boolean))];
            if (proveedorIds.length > 0) {
                try {
                    const urlProv = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/proveedores?select=id,nombre&id=in.(${proveedorIds.join(',')})`;
                    const responseProv = await supabaseFetch(urlProv, { headers });
                    if (responseProv.ok) {
                        const proveedores = await responseProv.json();
                        proveedores.forEach(p => {
                            proveedoresMap.set(p.id, p.nombre);
                        });
                    }
                } catch (errProv) {
                    console.error('⚠️ [BANCARIO-CONTROLLER] Error al obtener proveedores para cruce en memoria:', errProv.message);
                }
            }
        }

        // 3. Extraer los UUIDs devueltos por Supabase y los números de cheque
        const uuids = chequesSupabase.map(ch => ch.id).filter(Boolean);
        const numCheques = chequesSupabase.map(ch => ch.numero_cheque).filter(Boolean);
        
        // 4. Consultar en la BD local por UUID directo Y por Número de Cheque (para autosanación si cambió el UUID)
        let localLinks = [];
        if (uuids.length > 0 || numCheques.length > 0) {
            const queryLocal = `
                SELECT cv.id as vinculacion_id, cv.cheque_id, cv.cliente_id, cv.numero_cheque, cv.banco_emisor, cv.importe, c.razon_social as cliente_razon_social
                FROM public.fin_cheques_vinculados cv
                LEFT JOIN public.bunker_clientes c ON cv.cliente_id = c.id
                WHERE cv.cheque_id = ANY($1::uuid[]) OR cv.numero_cheque = ANY($2::text[])
            `;
            const resLocal = await pool.query(queryLocal, [uuids, numCheques]);
            localLinks = resLocal.rows;
        }
        
        // 5. Cruzar en memoria (Prioridad 1: UUID exacto | Prioridad 2: Número de cheque + Importe/Banco)
        const uuidLinksMap = new Map();
        const numChequeLinksMap = new Map();

        localLinks.forEach(row => {
            if (row.cheque_id) {
                uuidLinksMap.set(row.cheque_id, row);
            }
            if (row.numero_cheque) {
                numChequeLinksMap.set(`${row.numero_cheque}_${parseFloat(row.importe || 0)}`, row);
                numChequeLinksMap.set(row.numero_cheque, row);
            }
        });
        
        const autoHealPromises = [];

        const dataResult = chequesSupabase.map(ch => {
            let link = uuidLinksMap.get(ch.id);
            let reconciliadoPorNumero = false;

            if (!link && ch.numero_cheque) {
                const keyCombo = `${ch.numero_cheque}_${parseFloat(ch.importe || 0)}`;
                link = numChequeLinksMap.get(keyCombo) || numChequeLinksMap.get(ch.numero_cheque);

                if (link) {
                    reconciliadoPorNumero = true;
                    // Auto-sanar en segundo plano la vinculación local con el nuevo UUID de Supabase
                    autoHealPromises.push(
                        pool.query(
                            'UPDATE public.fin_cheques_vinculados SET cheque_id = $1, actualizado_en = CURRENT_TIMESTAMP WHERE id = $2',
                            [ch.id, link.vinculacion_id]
                        ).catch(e => console.error('⚠️ Error en auto-heal de cheque_id:', e.message))
                    );
                }
            }

            return {
                id: ch.id,
                numero_cheque: ch.numero_cheque,
                banco_emisor: ch.banco_emisor,
                importe: parseFloat(ch.importe) || 0,
                fecha_pago: ch.fecha_pago,
                librador_razon_social: ch.librador_razon_social,
                estado_interno: ch.estado_interno,
                fecha_endoso: ch.fecha_endoso,
                proveedor_endosado_id: ch.proveedor_endosado_id,
                proveedor_nombre_comercial: ch.proveedor_endosado_id ? (proveedoresMap.get(ch.proveedor_endosado_id) || null) : null,
                cliente_id: link ? link.cliente_id : null,
                cliente_razon_social: link ? link.cliente_razon_social : null,
                vinculacion_id: link ? link.vinculacion_id : null,
                reconciliado_por_numero: reconciliadoPorNumero
            };
        });

        if (autoHealPromises.length > 0) {
            Promise.all(autoHealPromises).then(() => {
                console.log(`⚡ [BANCARIO-CONTROLLER] Auto-sanación de UUID completada para ${autoHealPromises.length} cheques.`);
            });
        }
        
        dataResult.sort((a, b) => {
            const timeA = a.fecha_pago ? new Date(a.fecha_pago).getTime() : -Infinity;
            const timeB = b.fecha_pago ? new Date(b.fecha_pago).getTime() : -Infinity;
            const validA = Number.isFinite(timeA) ? timeA : -Infinity;
            const validB = Number.isFinite(timeB) ? timeB : -Infinity;
            if (validB !== validA) return validB - validA;
            return String(b.numero_cheque || '').localeCompare(String(a.numero_cheque || ''));
        });

        res.json({
            success: true,
            data: dataResult
        });
    } catch (error) {
        console.error('❌ [BANCARIO-CONTROLLER] Error al listar cheques en cartera:', error.message);
        next(error);
    }
}

/**
 * Vincula manualmente un cheque de Supabase con un cliente en Bunker.
 * Afecta de forma transaccional la cuenta corriente comercial del cliente (CREDITO).
 * 
 * CRÍTICO: La marca final '[Cheque: UUID]' en la descripción del movimiento
 * es un contrato inmutable del backend. No debe alterarse para asegurar que 
 * la desvinculación pueda resolver y eliminar dicho movimiento.
 */
async function vincularCheque(req, res, next) {
    const dbClient = await pool.connect();
    try {
        const { chequeId } = req.params;
        const { clienteId } = req.body;
        
        console.log(`🔗 [BANCARIO-CONTROLLER] Iniciando vinculación manual de cheque UUID: ${chequeId}...`);
        
        if (!clienteId) {
            return res.status(400).json({
                success: false,
                error: 'Debe especificar el clienteId'
            });
        }
        
        await dbClient.query('BEGIN');
        
        // 1. Obtener la clave de Supabase
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key || key === 'MISSING_ENV_KEY') {
            await dbClient.query('ROLLBACK');
            return res.status(500).json({
                success: false,
                error: 'Falta configurar la variable de entorno SUPABASE_SERVICE_KEY'
            });
        }
        
        // 2. Verificar en Supabase el estado del cheque para asegurar que esté 'EN_CARTERA'
        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/cheques_cartera?select=id,numero_cheque,banco_emisor,importe,fecha_pago,librador_razon_social,estado_interno&id=eq.${chequeId}`;
        
        const response = await supabaseFetch(url, { headers });
        if (!response.ok) {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `Error al consultar estado del cheque en Supabase`
            });
        }
        
        const cheques = await response.json();
        if (cheques.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Cheque no encontrado en la cartera centralizada de Supabase'
            });
        }
        
        const cheque = cheques[0];
        if (cheque.estado_interno !== 'EN_CARTERA' && cheque.estado_interno !== 'ENDOSADO') {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `El cheque ya no está disponible en cartera para vinculación (Estado actual: ${cheque.estado_interno})`
            });
        }
        
        // 3. Verificar si ya está vinculado localmente (por cheque_id o por numero_cheque)
        const checkLink = await dbClient.query(
            `SELECT cv.id, cv.cliente_id, cv.cheque_id, c.razon_social 
             FROM public.fin_cheques_vinculados cv 
             LEFT JOIN public.bunker_clientes c ON cv.cliente_id = c.id 
             WHERE cv.cheque_id = $1 OR (cv.numero_cheque = $2 AND cv.numero_cheque IS NOT NULL AND cv.numero_cheque != '') 
             FOR UPDATE OF cv`,
            [chequeId, cheque.numero_cheque]
        );
        
        if (checkLink.rowCount > 0) {
            const vinculacionExistente = checkLink.rows[0];
            if (vinculacionExistente.cliente_id === parseInt(clienteId, 10)) {
                if (vinculacionExistente.cheque_id !== chequeId) {
                    await dbClient.query(
                        'UPDATE public.fin_cheques_vinculados SET cheque_id = $1, actualizado_en = CURRENT_TIMESTAMP WHERE id = $2',
                        [chequeId, vinculacionExistente.id]
                    );
                }
                await dbClient.query('COMMIT');
                return res.json({
                    success: true,
                    message: 'El cheque ya se encuentra vinculado a este cliente'
                });
            } else {
                // Si estaba vinculado a otro cliente, desvincular primero
                console.log(`🔄 [BANCARIO-CONTROLLER] Cheque ya vinculado a otro cliente (${vinculacionExistente.razon_social}). Desvinculando primero...`);
                await desvincularChequeInterno(vinculacionExistente.cheque_id || chequeId, dbClient);
            }
        }
        
        // 4. Verificar que el cliente existe
        const checkCliente = await dbClient.query(
            'SELECT id, razon_social, codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1',
            [clienteId]
        );
        if (checkCliente.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Cliente de Búnker no encontrado'
            });
        }
        const cliente = checkCliente.rows[0];
        
        // 5. Insertar en tabla de vinculaciones locales
        await dbClient.query(`
            INSERT INTO public.fin_cheques_vinculados (
                cheque_id, cliente_id, numero_cheque, importe, fecha_pago, banco_emisor, librador_razon_social
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (cheque_id) DO UPDATE 
            SET cliente_id = EXCLUDED.cliente_id, actualizado_en = CURRENT_TIMESTAMP
        `, [
            chequeId,
            clienteId,
            cheque.numero_cheque,
            cheque.importe,
            cheque.fecha_pago,
            cheque.banco_emisor,
            cheque.librador_razon_social
        ]);
        
        // 6. Obtener o crear Cuenta Corriente Principal
        let ccId;
        const resCC = await dbClient.query(
            "SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = 'Cuenta Principal' FOR UPDATE",
            [cliente.codigo_bunker_cliente]
        );
        
        if (resCC.rowCount === 0) {
            const resNuevaCC = await dbClient.query(
                "INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo) VALUES ($1, 'Cuenta Principal', 'ARS', 0.00) RETURNING id",
                [cliente.codigo_bunker_cliente]
            );
            ccId = resNuevaCC.rows[0].id;
        } else {
            ccId = resCC.rows[0].id;
        }
        
        // 7. Insertar el movimiento en la Cuenta Corriente
        // NOTA: La descripción final "[Cheque: UUID]" es inmutable (contrato del backend)
        let fechaVtoFmt = 'N/A';
        if (cheque.fecha_pago) {
            try {
                const parts = cheque.fecha_pago.toString().split('T')[0].split('-');
                if (parts.length === 3) {
                    fechaVtoFmt = `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
                } else {
                    const d = new Date(cheque.fecha_pago);
                    if (!isNaN(d.getTime())) {
                        const day = String(d.getUTCDate()).padStart(2, '0');
                        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                        const year = d.getUTCFullYear();
                        fechaVtoFmt = `${day}/${month}/${year}`;
                    } else {
                        fechaVtoFmt = cheque.fecha_pago;
                    }
                }
            } catch (e) {
                fechaVtoFmt = cheque.fecha_pago;
            }
        }

        const descCC = `Val Ch ${cheque.numero_cheque} (Vto: ${fechaVtoFmt}) [Cheque: ${chequeId}] - Banco: ${cheque.banco_emisor} - Emisor: ${cheque.librador_razon_social || 'N/A'}`;
        
        await dbClient.query(
            `INSERT INTO public.factura_cuenta_corriente_movimientos (
                cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                tipo_comprobante, comprobante_id, descripcion, fecha_movimiento
            ) VALUES ($1, 'CREDITO', $2, 0.00, 'COBRO_CHEQUE', NULL, $3, CURRENT_TIMESTAMP)`,
            [
                ccId,
                cheque.importe,
                descCC
            ]
        );
        
        // 8. Recalcular el saldo
        const saldoPostPago = await recalcularSaldoCuentaCorriente(ccId, dbClient);

        // 8b. Si se solicitó ajuste automático de saldo para netear la cuenta a cero
        const { aplicarAjuste, montoAjuste } = req.body;
        if (aplicarAjuste && montoAjuste > 0) {
            if (Math.abs(saldoPostPago) > 0) {
                const tipoMovAjuste = saldoPostPago > 0 ? 'CREDITO' : 'DEBITO';
                const valAjuste = parseFloat(montoAjuste) || Math.abs(saldoPostPago);
                const descAjuste = `Ajuste automático de saldo por vinculación de cheque [Cheque: ${chequeId}]`;

                await dbClient.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
                        tipo_comprobante, comprobante_id, descripcion, fecha_movimiento
                    ) VALUES ($1, $2, $3, 0.00, 'AJUSTE_REDONDEO', NULL, $4, CURRENT_TIMESTAMP)`,
                    [
                        ccId,
                        tipoMovAjuste,
                        valAjuste,
                        descAjuste
                    ]
                );

                await recalcularSaldoCuentaCorriente(ccId, dbClient);
                console.log(`⚡ [BANCARIO-CONTROLLER] Ajuste automático de saldo aplicado por cheque ($${valAjuste}) para cliente ${cliente.codigo_bunker_cliente}.`);
            }
        }
        
        await dbClient.query('COMMIT');
        
        res.json({
            success: true,
            message: 'Cheque vinculado con éxito y cuenta corriente impactada',
            data: {
                cheque_id: chequeId,
                cliente_id: clienteId,
                cliente_razon_social: cliente.razon_social
            }
        });
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('❌ [BANCARIO-CONTROLLER] Error al vincular cheque:', error.message);
        next(error);
    } finally {
        dbClient.release();
    }
}

/**
 * Helper interno para desvincular un cheque dentro de una transacción activa.
 */
async function desvincularChequeInterno(chequeId, dbClient) {
    // 1. Obtener la vinculación actual
    const checkLink = await dbClient.query(
        'SELECT cliente_id FROM public.fin_cheques_vinculados WHERE cheque_id = $1 FOR UPDATE',
        [chequeId]
    );
    
    if (checkLink.rowCount === 0) {
        return; // No estaba vinculado
    }
    
    const clienteId = checkLink.rows[0].cliente_id;
    
    if (clienteId) {
        // 2. Obtener la cuenta corriente comercial del cliente
        const resCl = await dbClient.query('SELECT codigo_bunker_cliente FROM public.bunker_clientes WHERE id = $1', [clienteId]);
        if (resCl.rowCount > 0) {
            const codBunker = resCl.rows[0].codigo_bunker_cliente;
            const resCC = await dbClient.query(
                "SELECT id FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 AND nombre_cuenta = 'Cuenta Principal' FOR UPDATE",
                [codBunker]
            );
            if (resCC.rowCount > 0) {
                const ccId = resCC.rows[0].id;
                // 3. Eliminar el movimiento de cuenta corriente utilizando el token [Cheque: UUID]
                await dbClient.query(
                    "DELETE FROM public.factura_cuenta_corriente_movimientos WHERE cuenta_corriente_id = $1 AND descripcion LIKE '%[Cheque: ' || $2 || ']%'",
                    [ccId, chequeId]
                );
                // 4. Recalcular saldo de la cuenta corriente
                await recalcularSaldoCuentaCorriente(ccId, dbClient);
            }
        }
    }
    
    // 5. Eliminar la vinculación local
    await dbClient.query(
        'DELETE FROM public.fin_cheques_vinculados WHERE cheque_id = $1',
        [chequeId]
    );
}

/**
 * Desvincula manualmente un cheque de su cliente asociado.
 * Remueve el link local y revierte la afectación en la cuenta corriente comercial.
 */
async function desvincularCheque(req, res, next) {
    const dbClient = await pool.connect();
    try {
        const { chequeId } = req.params;
        
        console.log(`🔗 [BANCARIO-CONTROLLER] Iniciando desvinculación de cheque UUID: ${chequeId}...`);
        
        await dbClient.query('BEGIN');
        
        // 1. Ejecutar desvinculación usando el helper común
        await desvincularChequeInterno(chequeId, dbClient);
        
        await dbClient.query('COMMIT');
        
        res.json({
            success: true,
            message: 'Cheque desvinculado con éxito y saldo revertido'
        });
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('❌ [BANCARIO-CONTROLLER] Error al desvincular cheque:', error.message);
        next(error);
    } finally {
        dbClient.release();
    }
}

/**
 * Endpoint para verificar conectividad y salud del servicio de IA Gemini
 */
async function verificarEstadoIA(req, res, next) {
    try {
        const salud = await geminiService.verificarSaludIA();
        res.json({
            success: true,
            data: salud
        });
    } catch (error) {
        res.json({
            success: true,
            data: { activa: false, razon: error.message, modelo: 'gemini-2.0-flash' }
        });
    }
}

module.exports = {
    listarCuentas,
    listarMovimientos,
    ingestaExtracto,
    vincularCliente,
    listarClientesBunker,
    listarCheques,
    vincularCheque,
    desvincularCheque,
    verificarEstadoIA
};
