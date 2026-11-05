/**
 * Servicio de facturación
 * Lógica de negocio para crear, calcular y emitir facturas
 */

const { pool, ejecutarTransaccion } = require('../config/database');
const { ENTORNO, ALICUOTAS_IVA } = require('../config/afip');
const { paraBD, fechaActual, desdeFormatoAFIP } = require('../config/timezone');
const { comaAPunto, redondear, calcularIVA } = require('../utils/decimales');
const { validarFacturaCompleta, puedeEmitirse } = require('../utils/validaciones');
const { nextAfip, nextInterno } = require('./numeroService');
const { solicitarCAE } = require('./wsfeService');
const { COMPANY_CONFIG } = require('../config/company');
const cuentaCorrienteService = require('./cuentaCorrienteService');
const { calcularCostoIntegradoArticulo } = require('./costoIntegradoService');

/**
 * Enriquecer ítems procesados con la foto contable de costos Búnker al momento de crear el comprobante
 */
async function enriquecerItemsConFotoCostos(db, itemsProcesados, clienteId) {
    let clienteListaId = 1;
    if (clienteId) {
        try {
            const rCli = await db.query(
                `SELECT COALESCE(bc.lista_precios_bunker_id, NULLIF(c.lista_precios, '')::int, 1) as lista_id
                 FROM public.clientes c
                 LEFT JOIN public.bunker_clientes bc ON (CASE WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer ELSE NULL END) = c.cliente_id
                 WHERE c.cliente_id = $1 LIMIT 1`,
                [clienteId]
            );
            if (rCli.rows.length > 0 && rCli.rows[0].lista_id) {
                clienteListaId = parseInt(rCli.rows[0].lista_id) || 1;
            }
        } catch (_) { }
    }

    for (const item of itemsProcesados) {
        const qty = parseFloat(comaAPunto(item.qty)) || 0;
        let costoUnit = parseFloat(item.costo_unitario) || 0;
        let cMercUnit = parseFloat(item.costo_mercaderia_unitario) || 0;
        let cMoUnit = parseFloat(item.costo_mano_obra_unitario) || 0;
        let cInsUnit = parseFloat(item.costo_insumos_unitario) || 0;
        let artIdResuelto = item.articulo_id || item.articulo || null;

        if (costoUnit <= 0) {
            try {
                const ident = artIdResuelto || String(item.descripcion || '').replace(/^Devolución:\s*/i, '').trim();
                const resCosto = await calcularCostoIntegradoArticulo(db, ident, clienteListaId);
                const pUnitNeto = parseFloat(comaAPunto(item.p_unit_neto || item.p_unit)) || 0;
                // Si el precio unitario neto es menor al 50% del costo integrado (ej. NC por ajuste parcial de precio), no asignamos costo físico de mercadería
                if (resCosto.costo_unitario > 0 && pUnitNeto > 0 && pUnitNeto < (resCosto.costo_unitario * 0.5)) {
                    costoUnit = 0;
                    cMercUnit = 0;
                    cMoUnit = 0;
                    cInsUnit = 0;
                } else {
                    costoUnit = resCosto.costo_unitario || 0;
                    cMercUnit = resCosto.c_presentacion || 0;
                    cMoUnit = resCosto.c_tiempo || 0;
                    cInsUnit = resCosto.c_insumos || 0;
                }
                if (resCosto.articulo_id) {
                    artIdResuelto = String(resCosto.articulo_id).trim();
                }
            } catch (errC) {
                console.warn(`⚠️ [FACTURACION-SERVICE] No se pudo calcular costo integrado para item (${item.descripcion}):`, errC.message);
            }
        }

        item.articulo_id = artIdResuelto;
        item.costo_unitario = redondear(costoUnit, 2);
        item.costo_mercaderia_unitario = redondear(cMercUnit, 2);
        item.costo_mano_obra_unitario = redondear(cMoUnit, 2);
        item.costo_insumos_unitario = redondear(cInsUnit, 2);
        item.costo_total = redondear(qty * costoUnit, 2);
        item.costo_mercaderia_total = redondear(qty * cMercUnit, 2);
        item.costo_mano_obra_total = redondear(qty * cMoUnit, 2);
        item.costo_insumos_total = redondear(qty * cInsUnit, 2);
    }
    return itemsProcesados;
}

console.log('🔍 [FACTURACION-SERVICE] Cargando servicio de facturación...');

/**
 * Crear factura en estado BORRADOR
 * Implementa idempotencia por presupuesto_id
 * @param {Object} datos - Datos de la factura
 * @returns {Promise<Object>} Factura creada o existente
 */
const crearBorrador = async (datos) => {
    console.log('📝 [FACTURACION-SERVICE] Creando borrador de factura...');
    console.log(`   - presupuesto_id: ${datos.presupuesto_id}`);
    console.log(`   - precio_modo: ${datos.precio_modo}`);

    try {
        // 1. IDEMPOTENCIA Y CONSOLIDACIÓN DE BORRADORES DE NOTA DE CRÉDITO
        if (datos.presupuesto_id || datos.factura_asociada_id) {
            console.log('🔍 [FACTURACION-SERVICE] Verificando idempotencia / consolidación...');

            const esNotaCredito = Boolean(datos.es_nota_credito) || [3, 8, 13].includes(parseInt(datos.tipo_cbte));

            if (esNotaCredito) {
                // Si es Nota de Crédito y ya existe un BORRADOR para este presupuesto o factura asociada, CONSOLIDAR.
                const queryNcExistente = `
                    SELECT * FROM factura_facturas 
                    WHERE estado = 'BORRADOR' 
                      AND tipo_cbte IN (3, 8, 13)
                      AND (
                          ($1::integer IS NOT NULL AND presupuesto_id = $1)
                          OR
                          ($2::integer IS NOT NULL AND factura_asociada_id = $2)
                      )
                    ORDER BY id DESC
                    LIMIT 1
                `;
                const resNcExistente = await pool.query(queryNcExistente, [
                    datos.presupuesto_id ? parseInt(datos.presupuesto_id) : null,
                    datos.factura_asociada_id ? parseInt(datos.factura_asociada_id) : null
                ]);

                if (resNcExistente.rows.length > 0) {
                    const facturaExistente = resNcExistente.rows[0];
                    console.log(`🔗 [FACTURACION-SERVICE] Borrador de NC existente detectado (#${facturaExistente.id}). Consolidando nuevos ítems...`);

                    await ejecutarTransaccion(async (client) => {
                        // Resolver descuento global ANTES de procesar los ítems para que cada ítem en factura_factura_items
                        // tenga su imp_neto e imp_iva con el descuento aplicado (coherente con trigger recalcular_totales_factura y WSFE)
                        let descDecimal = parseFloat(facturaExistente.descuento) || 0;
                        if (datos.descuento) {
                            const rawD = parseFloat(datos.descuento);
                            descDecimal = rawD > 1 ? rawD / 100 : rawD;
                        }
                        if (descDecimal === 0 && (datos.presupuesto_id || facturaExistente.presupuesto_id)) {
                            const resP = await client.query('SELECT descuento FROM presupuestos WHERE id = $1', [datos.presupuesto_id || facturaExistente.presupuesto_id]);
                            if (resP.rows.length > 0) descDecimal = parseFloat(resP.rows[0].descuento) || 0;
                        }
                        if (descDecimal === 0 && (datos.factura_asociada_id || facturaExistente.factura_asociada_id)) {
                            const resFa = await client.query(
                                'SELECT COALESCE(NULLIF(fa.descuento, 0), p.descuento, 0) as descuento FROM factura_facturas fa LEFT JOIN presupuestos p ON fa.presupuesto_id = p.id WHERE fa.id = $1',
                                [datos.factura_asociada_id || facturaExistente.factura_asociada_id]
                            );
                            if (resFa.rows.length > 0) descDecimal = parseFloat(resFa.rows[0].descuento) || 0;
                        }

                        const nuevosItems = procesarItemsSegunPrecioModo(datos.items, datos.precio_modo, descDecimal);
                        await enriquecerItemsConFotoCostos(client, nuevosItems, facturaExistente.cliente_id || datos.cliente?.cliente_id);

                        let esRetiroConsolidado = datos.stock_descontado === true || datos.mover_stock === false || datos.origen_comprobante === 'MANTENIMIENTO' || datos.origen_comprobante === 'ADMINISTRATIVA_NC';
                        if (!esRetiroConsolidado && (datos.presupuesto_id || facturaExistente.presupuesto_id)) {
                            const resPresRet = await client.query(
                                `SELECT 1 FROM public.presupuestos WHERE id = $1 AND (tipo_comprobante = 'Orden de Retiro' OR estado IN ('Orden de Retiro', 'Administrativa NC')) LIMIT 1`,
                                [datos.presupuesto_id || facturaExistente.presupuesto_id]
                            );
                            if (resPresRet.rows.length > 0) esRetiroConsolidado = true;
                        }
                        if (esRetiroConsolidado) {
                            await client.query('UPDATE factura_facturas SET stock_descontado = TRUE WHERE id = $1', [facturaExistente.id]);
                            console.log(`🛡️ [FACTURACION-SERVICE] Borrador NC existente marcado con stock_descontado = TRUE (Mantenimiento / Retiro / Administrativa NC).`);
                        }

                        const resOrden = await client.query('SELECT COALESCE(MAX(orden), 0) as max_orden FROM factura_factura_items WHERE factura_id = $1', [facturaExistente.id]);
                        let startOrden = parseInt(resOrden.rows[0].max_orden) + 1;

                        const queryItem = `
                            INSERT INTO factura_factura_items (
                                factura_id, descripcion, articulo_id, qty, p_unit, alic_iva_id,
                                imp_neto, imp_iva, orden,
                                costo_unitario, costo_total,
                                costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                                costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                                created_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                        `;

                        for (const item of nuevosItems) {
                            await client.query(queryItem, [
                                facturaExistente.id,
                                item.descripcion,
                                item.articulo_id || item.articulo || null,
                                comaAPunto(item.qty),
                                comaAPunto(item.p_unit_neto),
                                item.alic_iva_id,
                                item.imp_neto,
                                item.imp_iva,
                                startOrden++,
                                item.costo_unitario || 0,
                                item.costo_total || 0,
                                item.costo_mercaderia_unitario || 0,
                                item.costo_mano_obra_unitario || 0,
                                item.costo_insumos_unitario || 0,
                                item.costo_mercaderia_total || 0,
                                item.costo_mano_obra_total || 0,
                                item.costo_insumos_total || 0,
                                paraBD()
                            ]);
                        }

                        // Recalcular totales consolidados con todos los ítems de la factura (ya contienen el descuento en imp_neto / imp_iva)
                        const resTodosItems = await client.query('SELECT * FROM factura_factura_items WHERE factura_id = $1', [facturaExistente.id]);
                        const itemsProcesados = resTodosItems.rows.map(it => ({
                            imp_neto: parseFloat(it.imp_neto) || 0,
                            imp_iva: parseFloat(it.imp_iva) || 0,
                            costo_total: parseFloat(it.costo_total) || 0,
                            costo_mercaderia_total: parseFloat(it.costo_mercaderia_total) || 0,
                            costo_mano_obra_total: parseFloat(it.costo_mano_obra_total) || 0,
                            costo_insumos_total: parseFloat(it.costo_insumos_total) || 0
                        }));

                        const totalesConsolidados = calcularTotales(itemsProcesados);

                        await client.query(`
                            UPDATE factura_facturas 
                            SET imp_neto = $1, imp_iva = $2, imp_total = $3, descuento = $4,
                                costo_estimado_total = $5, costo_mercaderia_total = $6, costo_mano_obra_total = $7, costo_insumos_total = $8,
                                imp_iibb = $9, imp_dif_iva = $10, ganancia_sin_iibb_total = $11, ganancia_real_total = $12,
                                foto_capturada = TRUE, updated_at = $13 
                            WHERE id = $14
                        `, [
                            totalesConsolidados.imp_neto,
                            totalesConsolidados.imp_iva,
                            totalesConsolidados.imp_total,
                            descDecimal,
                            totalesConsolidados.costo_estimado_total,
                            totalesConsolidados.costo_mercaderia_total,
                            totalesConsolidados.costo_mano_obra_total,
                            totalesConsolidados.costo_insumos_total,
                            totalesConsolidados.imp_iibb,
                            totalesConsolidados.imp_dif_iva,
                            totalesConsolidados.ganancia_sin_iibb_total,
                            totalesConsolidados.ganancia_real_total,
                            paraBD(),
                            facturaExistente.id
                        ]);
                    });

                    return {
                        ...facturaExistente,
                        _consolidado: true,
                        _mensaje: `Nuevos ítems anexados y consolidados en el borrador de Nota de Crédito #${facturaExistente.id}`
                    };
                }
            } else {
                const queryExistente = `
                    SELECT * FROM factura_facturas 
                    WHERE presupuesto_id = $1 
                      AND (tipo_cbte NOT IN (3, 8, 13) OR tipo_cbte IS NULL)
                      AND estado IN ('BORRADOR', 'APROBADA', 'APROBADA_LOCAL')
                      AND id NOT IN (
                          SELECT nc.factura_asociada_id 
                          FROM factura_facturas nc
                          JOIN factura_facturas f_orig ON nc.factura_asociada_id = f_orig.id
                          WHERE nc.factura_asociada_id IS NOT NULL 
                            AND nc.estado = 'APROBADA' 
                            AND nc.tipo_cbte IN (3, 8, 13)
                          GROUP BY nc.factura_asociada_id, f_orig.imp_total
                          HAVING SUM(nc.imp_total) >= (f_orig.imp_total - 0.05)
                      )
                    LIMIT 1
                `;

                const resultadoExistente = await pool.query(queryExistente, [datos.presupuesto_id]);

                if (resultadoExistente.rows.length > 0) {
                    const facturaExistente = resultadoExistente.rows[0];
                    return {
                        ...facturaExistente,
                        _idempotente: true,
                        _mensaje: 'Factura ya existe para este presupuesto'
                    };
                }
            }

            console.log('✅ [FACTURACION-SERVICE] No existe comprobante previo en conflicto, continuando...');
        }

        // 2. Validar datos
        const validacion = validarFacturaCompleta(datos);
        if (!validacion.valido) {
            throw new Error(`Validación fallida: ${validacion.errores.join(', ')}`);
        }

        console.log('✅ [FACTURACION-SERVICE] Datos validados');

        // 3. Resolver descuento global de comprobante ANTES de procesar ítems
        let descDecimal = 0;
        if (datos.descuento) {
            const rawD = parseFloat(datos.descuento);
            descDecimal = rawD > 1 ? rawD / 100 : rawD;
        }

        if (descDecimal === 0 && datos.presupuesto_id) {
            const resP = await pool.query('SELECT descuento FROM presupuestos WHERE id = $1', [datos.presupuesto_id]);
            if (resP.rows.length > 0) {
                descDecimal = parseFloat(resP.rows[0].descuento) || 0;
            }
        }

        if (descDecimal === 0 && datos.factura_asociada_id) {
            const resFa = await pool.query(
                'SELECT COALESCE(NULLIF(fa.descuento, 0), p.descuento, 0) as descuento FROM factura_facturas fa LEFT JOIN presupuestos p ON fa.presupuesto_id = p.id WHERE fa.id = $1',
                [datos.factura_asociada_id]
            );
            if (resFa.rows.length > 0) {
                descDecimal = parseFloat(resFa.rows[0].descuento) || 0;
            }
        }

        // 4. Procesar items según precio_modo aplicando el descuento sobre imp_neto e imp_iva de cada ítem
        // (mantiene p_unit como precio de lista sin descuento, idéntico a presupuestoFacturaService.mapearItems)
        const cliente = datos.cliente || {};
        const itemsProcesados = procesarItemsSegunPrecioModo(datos.items, datos.precio_modo, descDecimal);
        await enriquecerItemsConFotoCostos(pool, itemsProcesados, cliente.cliente_id || null);
        console.log(`✅ [FACTURACION-SERVICE] Items procesados y enriquecidos con foto de costos (modo: ${datos.precio_modo}, descuento: ${(descDecimal * 100).toFixed(2)}%)`);

        // 5. Calcular totales desde los ítems ya descontados
        const totales = calcularTotales(itemsProcesados);

        console.log('✅ [FACTURACION-SERVICE] Totales calculados');
        console.log(`   - Neto: ${totales.imp_neto}`);
        console.log(`   - IVA: ${totales.imp_iva}`);
        console.log(`   - Total: ${totales.imp_total}`);

        // 6. Crear factura en transacción
        const factura = await ejecutarTransaccion(async (client) => {
            // Calcular número secuencial para el borrador
            let cbteNro = datos.cbte_nro || null;
            if (!cbteNro && datos.pto_vta && datos.tipo_cbte) {
                const resNum = await client.query(
                    `SELECT COALESCE(MAX(cbte_nro), 0) as max_nro 
                     FROM factura_facturas 
                     WHERE pto_vta = $1 AND tipo_cbte = $2`,
                    [datos.pto_vta, datos.tipo_cbte]
                );
                
                const resAfipNum = await client.query(
                    `SELECT ultimo_cbte_afip 
                     FROM factura_numeracion_afip 
                     WHERE pto_vta = $1 AND tipo_cbte = $2`,
                    [datos.pto_vta, datos.tipo_cbte]
                );
                
                let maxNro = parseInt(resNum.rows[0]?.max_nro || 0);
                let afipNro = parseInt(resAfipNum.rows[0]?.ultimo_cbte_afip || 0);
                
                cbteNro = Math.max(maxNro, afipNro) + 1;
                console.log(`🔢 [FACTURACION-SERVICE] Pre-asignando número secuencial borrador: ${cbteNro}`);
            }

            let stockDescontado = datos.stock_descontado === true || datos.mover_stock === false || datos.origen_comprobante === 'MANTENIMIENTO' || datos.origen_comprobante === 'ADMINISTRATIVA_NC';
            if (!stockDescontado && datos.presupuesto_id) {
                const resPresRetiro = await client.query(
                    `SELECT 1 FROM public.presupuestos WHERE id = $1 AND (tipo_comprobante = 'Orden de Retiro' OR estado IN ('Orden de Retiro', 'Administrativa NC')) LIMIT 1`,
                    [datos.presupuesto_id]
                );
                if (resPresRetiro.rows.length > 0) {
                    stockDescontado = true;
                    console.log(`🛡️ [FACTURACION-SERVICE] Presupuesto #${datos.presupuesto_id} es Orden de Retiro / Administrativa NC -> forzando stock_descontado = TRUE.`);
                }
            }

            // Insertar cabecera (incluyendo descuento decimal y foto contable completa)
            const queryCabecera = `
                INSERT INTO factura_facturas (
                    tipo_cbte, pto_vta, cbte_nro, concepto, fecha_emision,
                    cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                    moneda, mon_cotiz,
                    imp_neto, imp_iva, imp_trib, imp_total,
                    estado, requiere_afip, serie_interna, presupuesto_id,
                    factura_asociada_id, stock_descontado, descuento,
                    costo_estimado_total, alicuota_iibb, imp_iibb, imp_dif_iva,
                    costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                    ganancia_sin_iibb_total, ganancia_real_total, foto_capturada,
                    emitida_en, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18,
                    $19, $20, $21, $22,
                    $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
                    $33, $34, $35
                )
                RETURNING *
            `;

            const resultadoCabecera = await client.query(queryCabecera, [
                datos.tipo_cbte,
                datos.pto_vta,
                cbteNro,
                datos.concepto,
                datos.fecha_emision || fechaActual(),
                cliente.cliente_id || null,
                cliente.doc_tipo || null,
                cliente.doc_nro || null,
                cliente.condicion_iva_id || null,
                datos.moneda || 'PES',
                datos.mon_cotiz || 1,
                totales.imp_neto,
                totales.imp_iva,
                totales.imp_trib,
                totales.imp_total,
                'BORRADOR',
                datos.requiere_afip !== false, // Por defecto true
                datos.serie_interna || null,
                datos.presupuesto_id || null,
                datos.factura_asociada_id || null, // $20
                stockDescontado, // $21
                descDecimal, // $22
                totales.costo_estimado_total, // $23
                totales.alicuota_iibb, // $24
                totales.imp_iibb, // $25
                totales.imp_dif_iva, // $26
                totales.costo_mercaderia_total, // $27
                totales.costo_mano_obra_total, // $28
                totales.costo_insumos_total, // $29
                totales.ganancia_sin_iibb_total, // $30
                totales.ganancia_real_total, // $31
                true, // $32 (foto_capturada)
                paraBD(), // $33
                paraBD(), // $34
                paraBD() // $35
            ]);

            const facturaCreada = resultadoCabecera.rows[0];
            console.log(`✅ [FACTURACION-SERVICE] Cabecera creada - ID: ${facturaCreada.id}`);

            // Insertar items con foto de costos
            const queryItem = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, articulo_id, qty, p_unit, alic_iva_id,
                    imp_neto, imp_iva, orden,
                    costo_unitario, costo_total,
                    costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                    costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            `;

            for (let i = 0; i < itemsProcesados.length; i++) {
                const item = itemsProcesados[i];

                await client.query(queryItem, [
                    facturaCreada.id,
                    item.descripcion,
                    item.articulo_id || item.articulo || null,
                    comaAPunto(item.qty),
                    comaAPunto(item.p_unit_neto), // Precio unitario neto de lista (sin descuento)
                    item.alic_iva_id,
                    item.imp_neto, // Neto con descuento aplicado
                    item.imp_iva,  // IVA sobre el neto con descuento
                    i + 1,
                    item.costo_unitario || 0,
                    item.costo_total || 0,
                    item.costo_mercaderia_unitario || 0,
                    item.costo_mano_obra_unitario || 0,
                    item.costo_insumos_unitario || 0,
                    item.costo_mercaderia_total || 0,
                    item.costo_mano_obra_total || 0,
                    item.costo_insumos_total || 0,
                    paraBD()
                ]);
            }

            console.log(`✅ [FACTURACION-SERVICE] ${itemsProcesados.length} items insertados`);

            return facturaCreada;
        });

        console.log('✅ [FACTURACION-SERVICE] Borrador creado exitosamente');

        return factura;

    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error creando borrador:', error.message);
        throw error;
    }
};

/**
 * Emitir factura (AFIP o interna)
 * @param {number} facturaId - ID de la factura
 * @returns {Promise<Object>} Factura emitida
 */
const emitir = async (facturaId) => {
    console.log(`📤 [FACTURACION-SERVICE] Emitiendo factura ID: ${facturaId}`);

    try {
        // 1. Obtener factura
        const factura = await obtenerPorId(facturaId);

        // 2. Validar que puede emitirse
        const validacion = puedeEmitirse(factura);
        if (!validacion.valido) {
            throw new Error(`No puede emitirse: ${validacion.errores.join(', ')}`);
        }

        console.log('✅ [FACTURACION-SERVICE] Factura puede emitirse');

        // 3. Si es reproceso de RECHAZADA, limpiar datos anteriores
        if (validacion.esReproceso) {
            console.log('🔄 [FACTURACION-SERVICE] Reprocesando factura RECHAZADA - limpiando datos anteriores');
            await pool.query(
                `UPDATE factura_facturas 
                 SET cbte_nro = NULL, cae = NULL, cae_vto = NULL, resultado = NULL, estado = 'BORRADOR', updated_at = $1 
                 WHERE id = $2`,
                [paraBD(), facturaId]
            );
            // Recargar factura con datos limpios
            factura.cbte_nro = null;
            factura.cae = null;
            factura.cae_vto = null;
            factura.resultado = null;
            factura.estado = 'BORRADOR';
            console.log('✅ [FACTURACION-SERVICE] Datos anteriores limpiados, factura lista para reprocesar');
        }

        // 4. Emitir según tipo
        if (factura.requiere_afip) {
            return await emitirAfip(factura);
        } else {
            return await emitirInterna(factura);
        }

    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error emitiendo factura:', error.message);
        throw error;
    }
};

/**
 * Emitir factura con AFIP
 * @param {Object} factura - Factura a emitir
 * @returns {Promise<Object>} Factura emitida
 */
const emitirAfip = async (factura) => {
    console.log(`📤 [FACTURACION-SERVICE] Emitiendo con AFIP - ID: ${factura.id}`);

    try {
        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener siguiente número
            const cbteNro = await nextAfip(factura.pto_vta, factura.tipo_cbte, ENTORNO);
            console.log(`🔢 [FACTURACION-SERVICE] Número asignado: ${cbteNro}`);

            // 2. Solicitar CAE
            const resultadoCAE = await solicitarCAE(factura.id, ENTORNO);
            console.log(`✅ [FACTURACION-SERVICE] CAE obtenido: ${resultadoCAE.cae}`);

            // 3. Usar el número oficial de comprobante de AFIP si fue aprobada
            const cbteNroOficial = resultadoCAE.resultado === 'A' ? resultadoCAE.cbte_nro : cbteNro;
            console.log(`🔢 [FACTURACION-SERVICE] Número final a guardar: ${cbteNroOficial}`);

            // 4. Autocorrección de numeración local
            if (resultadoCAE.resultado === 'A') {
                await client.query(`
                    INSERT INTO factura_numeracion_afip (pto_vta, tipo_cbte, ultimo_cbte_afip, actualizado_en)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (pto_vta, tipo_cbte)
                    DO UPDATE SET ultimo_cbte_afip = EXCLUDED.ultimo_cbte_afip, actualizado_en = NOW()
                `, [factura.pto_vta, factura.tipo_cbte, cbteNroOficial]);
                console.log(`🔄 [FACTURACION-SERVICE] Contador local sincronizado en ${cbteNroOficial}`);
            }

            // 5. Actualizar factura
            const queryUpdate = `
                UPDATE factura_facturas
                SET 
                    cbte_nro = $1,
                    cae = $2,
                    cae_vto = $3,
                    resultado = $4,
                    estado = $5,
                    fecha_emision = CASE WHEN estado = 'PENDIENTE_FACTURACION' THEN CURRENT_DATE ELSE fecha_emision END,
                    updated_at = $6
                WHERE id = $7
                RETURNING *
            `;

            const estado = resultadoCAE.resultado === 'A' ? 'APROBADA' : 'RECHAZADA';

            const resultado = await client.query(queryUpdate, [
                cbteNroOficial,
                resultadoCAE.cae,
                desdeFormatoAFIP(resultadoCAE.cae_vto),
                resultadoCAE.resultado,
                estado,
                paraBD(),
                factura.id
            ]);

            console.log(`✅ [FACTURACION-SERVICE] Factura actualizada - Estado: ${estado}`);

            if (estado === 'APROBADA') {
                await cuentaCorrienteService.registrarFactura(resultado.rows[0], client);
                
                // Si es Nota de Crédito, la factura original conserva su validez fiscal (con CAE) y trazabilidad.
                // El importe queda compensado (parcial o totalmente) en Cuenta Corriente y Stock por la propia NC.
                if (resultado.rows[0].factura_asociada_id) {
                    console.log(`ℹ️ [FACTURACION-SERVICE] Nota de Crédito #${resultado.rows[0].id} emitida para Factura original #${resultado.rows[0].factura_asociada_id}. Ambas conservan su valor fiscal y estado 'APROBADA'.`);
                }

                // Si es del puesto 32 o 90, mover stock SOLO SI no fue descontado previamente
                if ((resultado.rows[0].pto_vta === 32 || resultado.rows[0].pto_vta === 90) && !factura.stock_descontado) {
                    await registrarMovimientosStockFactura(resultado.rows[0], client);
                    await client.query(`UPDATE factura_facturas SET stock_descontado = TRUE WHERE id = $1`, [factura.id]);
                } else if (factura.stock_descontado) {
                    console.log(`ℹ️ [FACTURACION-SERVICE] Stock previamente descontado en Facturación Diferida / NC Administrativa. Se omite duplicación.`);
                }
                
                // Actualizar estado del presupuesto origen solo si es Factura (no Nota de Crédito)
                const esNC = [3, 8, 13].includes(parseInt(resultado.rows[0].tipo_cbte));
                if (resultado.rows[0].presupuesto_id && !esNC) {
                    await client.query(
                        `UPDATE public.presupuestos 
                         SET estado = 'Facturado',
                             origen_facturacion = 'AFIP/ARCA',
                             origen_numero_factura = $2
                         WHERE id = $1`,
                        [resultado.rows[0].presupuesto_id, String(cbteNroOficial)]
                    );
                    console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${resultado.rows[0].presupuesto_id} actualizado a 'Facturado' con comprobante #${cbteNroOficial}`);
                } else if (resultado.rows[0].presupuesto_id && esNC) {
                    await client.query(
                        `UPDATE public.presupuestos 
                         SET estado = 'Conciliado'
                         WHERE id = $1
                           AND (tipo_comprobante = 'Orden de Retiro' OR estado IN ('Orden de Retiro', 'Administrativa NC', 'Enviado a Facturación'))`,
                        [resultado.rows[0].presupuesto_id]
                    );
                    console.log(`🔗 [FACTURACION-SERVICE] Orden de Retiro / Administrativa NC #${resultado.rows[0].presupuesto_id} marcada como 'Conciliado' (Emisión AFIP sin pisar origen_numero_factura)`);
                }
            }

            return resultado.rows[0];
        });

    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error emitiendo con AFIP:', error.message);

        // Marcar como rechazada
        await pool.query(
            'UPDATE factura_facturas SET estado = $1, resultado = $2, updated_at = $3 WHERE id = $4',
            ['RECHAZADA', 'R', paraBD(), factura.id]
        );

        throw error;
    }
};

/**
 * Emitir factura interna (sin AFIP)
 * @param {Object} factura - Factura a emitir
 * @returns {Promise<Object>} Factura emitida
 */
const emitirInterna = async (factura) => {
    console.log(`📤 [FACTURACION-SERVICE] Emitiendo interna - ID: ${factura.id}`);

    try {
        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener siguiente número interno
            const serie = factura.serie_interna || (factura.pto_vta === 90 ? 'X' : 'I');
            const nroInterno = await nextInterno(serie);
            console.log(`🔢 [FACTURACION-SERVICE] Número interno asignado: ${serie}-${nroInterno}`);

            // 2. Actualizar factura
            const queryUpdate = `
                UPDATE factura_facturas
                SET 
                    nro_interno = $1,
                    estado = $2,
                    updated_at = $3,
                    serie_interna = $4
                WHERE id = $5
                RETURNING *
            `;

            const resultado = await client.query(queryUpdate, [
                nroInterno,
                'APROBADA_LOCAL',
                paraBD(),
                serie,
                factura.id
            ]);

            console.log(`✅ [FACTURACION-SERVICE] Factura interna emitida`);

            await cuentaCorrienteService.registrarFactura(resultado.rows[0], client);

            // Si es del puesto 32 o 90, mover stock SOLO SI no fue descontado previamente
            if ((resultado.rows[0].pto_vta === 32 || resultado.rows[0].pto_vta === 90) && !factura.stock_descontado) {
                await registrarMovimientosStockFactura(resultado.rows[0], client);
                await client.query(`UPDATE factura_facturas SET stock_descontado = TRUE WHERE id = $1`, [factura.id]);
            }

            const esNCInterna = [3, 8, 13, 99].includes(parseInt(resultado.rows[0].tipo_cbte));
            if (resultado.rows[0].presupuesto_id && !esNCInterna) {
                // Actualizar estado de presupuesto de origen a 'Facturado' (Solo si NO es Nota de Crédito)
                await client.query(
                    `UPDATE public.presupuestos 
                     SET estado = 'Facturado',
                         origen_facturacion = 'LAMDA INTERNO',
                         origen_numero_factura = $2
                     WHERE id = $1`,
                    [resultado.rows[0].presupuesto_id, `${serie}-${nroInterno}`]
                );
                console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${resultado.rows[0].presupuesto_id} actualizado a 'Facturado' (Emisión Interna)`);
            } else if (resultado.rows[0].presupuesto_id && esNCInterna) {
                await client.query(
                    `UPDATE public.presupuestos 
                     SET estado = 'Conciliado'
                     WHERE id = $1
                       AND (tipo_comprobante = 'Orden de Retiro' OR estado IN ('Orden de Retiro', 'Administrativa NC', 'Enviado a Facturación'))`,
                    [resultado.rows[0].presupuesto_id]
                );
                console.log(`🔗 [FACTURACION-SERVICE] Orden de Retiro / Administrativa NC #${resultado.rows[0].presupuesto_id} marcada como 'Conciliado' (Emisión Interna sin pisar origen_numero_factura)`);
            }

            return resultado.rows[0];
        });

    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error emitiendo interna:', error.message);
        throw error;
    }
};

/**
 * Procesar items según precio_modo
 * @param {Array} items - Items originales
 * @param {string} precioModo - 'NETO' o 'FINAL_CON_IVA'
 * @returns {Array} Items procesados con neto e IVA calculados
 */
const procesarItemsSegunPrecioModo = (items, precioModo, descDecimal = 0) => {
    const factorDesc = descDecimal > 0 ? (1 - descDecimal) : 1;
    console.log(`🔄 [FACTURACION-SERVICE] Procesando items en modo: ${precioModo} (Descuento: ${(descDecimal * 100).toFixed(2)}%)`);

    return items.map((item, index) => {
        const qty = comaAPunto(item.qty);
        const pUnit = comaAPunto(item.p_unit);
        const alicuota = ALICUOTAS_IVA[item.alic_iva_id];

        if (!alicuota) {
            throw new Error(`Alícuota IVA ${item.alic_iva_id} no válida en item ${index}`);
        }

        let p_unit_neto, imp_neto, imp_iva;

        if (precioModo === 'NETO') {
            // Precio unitario YA es neto (se conserva p_unit_neto de lista y se aplica factorDesc a imp_neto)
            p_unit_neto = pUnit;
            imp_neto = redondear(qty * p_unit_neto * factorDesc, 2);
            imp_iva = calcularIVA(imp_neto, alicuota.porcentaje);

            console.log(`   Item ${index}: NETO - p_unit=${pUnit} (desc ${(descDecimal * 100).toFixed(2)}%) → neto=${imp_neto}, iva=${imp_iva}`);

        } else if (precioModo === 'FINAL_CON_IVA') {
            // Precio unitario INCLUYE IVA, hay que desglosar
            const divisor = 1 + (alicuota.porcentaje / 100);
            p_unit_neto = redondear(pUnit / divisor, 2);
            imp_neto = redondear(qty * p_unit_neto * factorDesc, 2);
            imp_iva = redondear((qty * pUnit * factorDesc) - imp_neto, 2);

            console.log(`   Item ${index}: FINAL_CON_IVA - p_unit=${pUnit} (desc ${(descDecimal * 100).toFixed(2)}%) → neto=${imp_neto}, iva=${imp_iva}`);

        } else {
            throw new Error(`precio_modo inválido: ${precioModo}`);
        }

        return {
            ...item,
            p_unit_neto: redondear(p_unit_neto, 2),
            imp_neto: redondear(imp_neto, 2),
            imp_iva: redondear(imp_iva, 2)
        };
    });
};

/**
 * Calcular totales de items (ya procesados y enriquecidos con costos Búnker)
 * @param {Array} items - Items procesados con imp_neto, imp_iva y costos
 * @returns {Object} Totales calculados con foto contable
 */
const calcularTotales = (items, alicuotaIibb = 4.00) => {
    console.log('🧮 [FACTURACION-SERVICE] Calculando totales y foto contable...');

    let imp_neto = 0;
    let imp_iva = 0;
    let imp_trib = 0;
    let costo_estimado_total = 0;
    let costo_mercaderia_total = 0;
    let costo_mano_obra_total = 0;
    let costo_insumos_total = 0;
    let imp_dif_iva_raw = 0;

    items.forEach(item => {
        const netoItem = parseFloat(item.imp_neto) || 0;
        const ivaItem = parseFloat(item.imp_iva) || 0;
        const cTotItem = parseFloat(item.costo_total) || 0;
        const cMercItem = parseFloat(item.costo_mercaderia_total) || 0;
        const cMoItem = parseFloat(item.costo_mano_obra_total) || 0;
        const cInsItem = parseFloat(item.costo_insumos_total) || 0;

        imp_neto += netoItem;
        imp_iva += ivaItem;
        costo_estimado_total += cTotItem;
        costo_mercaderia_total += cMercItem;
        costo_mano_obra_total += cMoItem;
        costo_insumos_total += cInsItem;

        const costoBultoItem = cMercItem + cInsItem;
        const ivaCompraItem = costoBultoItem * 0.21;
        imp_dif_iva_raw += Math.max(0, ivaItem - ivaCompraItem);
    });

    const imp_total = imp_neto + imp_iva + imp_trib;
    const alic_iibb = parseFloat(alicuotaIibb) || 4.00;
    const imp_iibb = redondear(imp_total * (alic_iibb / 100), 2);
    const imp_dif_iva = redondear(imp_dif_iva_raw, 2);
    const ganancia_sin_iibb_total = redondear(imp_neto - costo_estimado_total - imp_iibb, 2);
    const ganancia_real_total = redondear(ganancia_sin_iibb_total - imp_dif_iva, 2);

    return {
        imp_neto: redondear(imp_neto, 2),
        imp_iva: redondear(imp_iva, 2),
        imp_trib: redondear(imp_trib, 2),
        imp_total: redondear(imp_total, 2),
        costo_estimado_total: redondear(costo_estimado_total, 2),
        costo_mercaderia_total: redondear(costo_mercaderia_total, 2),
        costo_mano_obra_total: redondear(costo_mano_obra_total, 2),
        costo_insumos_total: redondear(costo_insumos_total, 2),
        alicuota_iibb: alic_iibb,
        imp_iibb,
        imp_dif_iva,
        ganancia_sin_iibb_total,
        ganancia_real_total
    };
};

/**
 * Obtener factura por ID con datos completos (incluye razón social y descuento del presupuesto)
 * @param {number} id - ID de la factura
 * @returns {Promise<Object>} Factura con datos completos
 */
const obtenerPorId = async (id) => {
    console.log(`🔍 [FACTURACION-SERVICE] Obteniendo factura ID: ${id}`);

    try {
        // Obtener factura con datos del cliente (priorizando Búnker) y descuento del presupuesto
        const queryFactura = `
            SELECT 
                f.*,
                bc.id as bunker_cliente_id,
                COALESCE(NULLIF(TRIM(bc.razon_social), ''), NULLIF(TRIM(bc.cliente_nombre), ''), NULLIF(TRIM(c.apellido), '')) as razon_social,
                COALESCE(NULLIF(TRIM(bc.cuit_cuil), ''), NULLIF(TRIM(c.cuit), ''), NULLIF(TRIM(c.dni), '')) as cliente_cuit,
                COALESCE(NULLIF(TRIM(bc.domicilio_fiscal), ''), NULLIF(TRIM(c.domicilio), '')) as cliente_domicilio,
                COALESCE(NULLIF(TRIM(bc.provincia), ''), NULLIF(TRIM(c.provincia), '')) as cliente_provincia,
                COALESCE(NULLIF(TRIM(bc.condicion_iva), ''), NULLIF(TRIM(c.condicion_iva), '')) as cliente_condicion_iva,
                COALESCE(NULLIF(f.descuento, 0), p.descuento, NULLIF(fa_assoc.descuento, 0), p_assoc.descuento, 0) as descuento,
                COALESCE(bc.whatsapp_facturas, c.celular, c.telefono) as whatsapp_facturas,
                bc.email_facturas as email_facturas,
                COALESCE(bc.canal_envio_preferido, 'whatsapp') as canal_envio_preferido
            FROM factura_facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.cliente_id
            LEFT JOIN bunker_clientes bc ON 
                (CASE 
                    WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer 
                    ELSE NULL 
                END) = f.cliente_id
            LEFT JOIN presupuestos p ON f.presupuesto_id = p.id
            LEFT JOIN factura_facturas fa_assoc ON f.factura_asociada_id = fa_assoc.id
            LEFT JOIN presupuestos p_assoc ON fa_assoc.presupuesto_id = p_assoc.id
            WHERE f.id = $1
        `;

        const resultadoFactura = await pool.query(queryFactura, [id]);

        if (resultadoFactura.rows.length === 0) {
            throw new Error(`Factura ${id} no encontrada`);
        }

        const factura = resultadoFactura.rows[0];

        const queryItems = `
            SELECT 
                i.id, 
                i.factura_id, 
                i.qty, 
                i.p_unit, 
                i.alic_iva_id, 
                i.imp_neto, 
                i.imp_iva, 
                (i.imp_neto + i.imp_iva) as imp_total,
                i.orden, 
                i.articulo_id,
                COALESCE(i.costo_unitario, 0) as costo_unitario,
                COALESCE(i.costo_total, 0) as costo_total,
                COALESCE(i.costo_mercaderia_unitario, 0) as costo_mercaderia_unitario,
                COALESCE(i.costo_mano_obra_unitario, 0) as costo_mano_obra_unitario,
                COALESCE(i.costo_insumos_unitario, 0) as costo_insumos_unitario,
                COALESCE(i.costo_mercaderia_total, 0) as costo_mercaderia_total,
                COALESCE(i.costo_mano_obra_total, 0) as costo_mano_obra_total,
                COALESCE(i.costo_insumos_total, 0) as costo_insumos_total,
                i.created_at,
                COALESCE(
                    a.nombre, 
                    (SELECT nombre FROM public.articulos WHERE codigo_barras = REPLACE(i.descripcion, 'Devolución: ', '') OR numero = REPLACE(i.descripcion, 'Devolución: ', '') LIMIT 1),
                    i.descripcion
                ) as descripcion
            FROM public.factura_factura_items i
            LEFT JOIN public.articulos a ON (a.codigo_barras = i.descripcion OR a.numero = i.descripcion)
            WHERE i.factura_id = $1
            ORDER BY i.orden ASC
        `;

/**
 * Algoritmo de Truncado Inteligente Seguro para AFIP (máximo 80 caracteres).
 * Preserva la identidad del producto y garantiza que el sufijo físico dinámico
 * (medidas, pesos, unidades, empaques) permanezca 100% INTACTO al final.
 */
function truncarDescripcionAFIPSegura(descripcion, maxLen = 80) {
    if (!descripcion || typeof descripcion !== 'string') return '';
    
    const descLimpia = descripcion.trim().replace(/\s+/g, ' ');
    if (descLimpia.length <= maxLen) return descLimpia;

    const regexSufijoFisico = /\s*(\d+\s*x\s*\d+(\.\d+)?[kK]?[gG]?|\s*x\s*\d+(\.\d+)?[kK]?[gG]?|\s*x\s*\d+\s*unidade?s?)$/i;

    let baseText = descLimpia;
    let sufijo = '';

    const match = descLimpia.match(regexSufijoFisico);
    if (match) {
        sufijo = match[0];
        baseText = descLimpia.substring(0, match.index).trim();
    }

    const B = maxLen - sufijo.length;

    if (B <= 15) {
        return (baseText.substring(0, B) + sufijo).substring(0, maxLen);
    }

    let cuerpoTruncado = baseText.substring(0, B).trim();
    const ultimoEspacio = cuerpoTruncado.lastIndexOf(' ');
    if (ultimoEspacio > 15) {
        cuerpoTruncado = cuerpoTruncado.substring(0, ultimoEspacio);
    }

    return (cuerpoTruncado + sufijo).trim();
}

        const resultadoItems = await pool.query(queryItems, [id]);
        factura.items = resultadoItems.rows.map(item => ({
            ...item,
            descripcion_afip: truncarDescripcionAFIPSegura(item.descripcion, 80)
        }));

        // Cargar última observación/error de AFIP si existe
        const queryLogs = `
            SELECT observaciones 
            FROM factura_afip_wsfe_logs 
            WHERE factura_id = $1 
            ORDER BY creado_en DESC 
            LIMIT 1
        `;
        const resultadoLogs = await pool.query(queryLogs, [id]);
        if (resultadoLogs.rows.length > 0 && resultadoLogs.rows[0].observaciones) {
            try {
                const obs = JSON.parse(resultadoLogs.rows[0].observaciones);
                factura.observaciones = Array.isArray(obs) ? obs.join(' | ') : resultadoLogs.rows[0].observaciones;
            } catch (e) {
                factura.observaciones = resultadoLogs.rows[0].observaciones;
            }
        } else {
            factura.observaciones = null;
        }

        console.log('✅ [FACTURACION-SERVICE] Factura obtenida con datos completos');
        console.log(`   - Razón Social: ${factura.razon_social || 'Sin datos'}`);
        console.log(`   - Items: ${factura.items.length}`);
        console.log(`   - Descuento: ${(parseFloat(factura.descuento) * 100).toFixed(2)}%`);

        // Calcular código de barras y URL de código QR si tiene CAE
        if (factura.cae) {
            try {
                const { buildBarcodePayload } = require('../utils/afip-barcode');
                const { generateQrUrl } = require('../utils/afip-qr');

                const caeVtoStr = factura.cae_vto instanceof Date 
                    ? factura.cae_vto.toISOString().split('T')[0].replace(/-/g, '')
                    : String(factura.cae_vto).replace(/-/g, '');

                factura.barcode_value = buildBarcodePayload({
                    cuit11: COMPANY_CONFIG.cuitRaw,
                    cbteTipo3: factura.tipo_cbte,
                    ptoVta5: factura.pto_vta,
                    cae14: factura.cae,
                    caeVto8: caeVtoStr
                });

                const fechaStr = factura.fecha_emision instanceof Date
                    ? factura.fecha_emision.toISOString().split('T')[0]
                    : String(factura.fecha_emision).split('T')[0];

                factura.qr_url = generateQrUrl({
                    ver: 1,
                    fecha: fechaStr,
                    cuit: COMPANY_CONFIG.cuitRaw,
                    ptoVta: factura.pto_vta,
                    tipoCmp: factura.tipo_cbte,
                    nroCmp: factura.cbte_nro,
                    importe: factura.imp_total,
                    moneda: factura.moneda || 'PES',
                    ctz: factura.mon_cotiz || 1,
                    tipoDocRec: factura.doc_tipo,
                    nroDocRec: factura.doc_nro,
                    tipoCodAut: 'E',
                    codAut: factura.cae
                });
                
                console.log('✅ [FACTURACION-SERVICE] barcode_value y qr_url calculados y anexados');
            } catch (err) {
                console.warn('⚠️ [FACTURACION-SERVICE] Error al calcular barcode/qr en obtenerPorId:', err.message);
            }
        }

        return factura;

    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error obteniendo factura:', error.message);
        throw error;
    }
};

/**
 * Registra los movimientos de stock en la base de datos para los ítems de una factura aprobada.
 * Solo aplicable para el puesto de venta 32.
 * @param {Object} factura - La factura aprobada (debe incluir items o se cargarán de la BD).
 * @param {Object} client - Conexión de base de datos activa dentro de la transacción.
 */
const registrarMovimientosStockFactura = async (factura, client) => {
    console.log(`📦 [FACTURACION-SERVICE] Registrando movimientos de stock para factura ID: ${factura.id} (${factura.pto_vta}-${factura.cbte_nro || factura.nro_interno || ''})`);

    const esNotaCredito = [3, 8, 13].includes(parseInt(factura.tipo_cbte));
    const esFactura = [1, 6, 11].includes(parseInt(factura.tipo_cbte));

    // Si la factura tiene stock_descontado = TRUE (o proviene de Mantenimiento), omitimos el movimiento automático de stock
    if (factura.stock_descontado) {
        console.log(`ℹ️ [FACTURACION-SERVICE] Comprobante ID ${factura.id} tiene stock_descontado = TRUE (Mantenimiento / Sin movimiento de depósito). Se omite movimiento automático de stock.`);
        return;
    }

    // Blindaje Micro-Etapa 4: Si es Nota de Crédito asociada a una Orden de Retiro o Administrativa NC (o Mantenimiento),
    // jamás debe sumar stock físico a stock_real_consolidado (Variante B no mueve mercadería y Variante A ingresa a stock_mantenimiento).
    if (esNotaCredito && factura.presupuesto_id) {
        const resPresCheck = await client.query(
            `SELECT tipo_comprobante, estado, estado_logistico,
                    EXISTS(SELECT 1 FROM public.mantenimiento_movimientos mm WHERE mm.id_presupuesto_origen = p.id) AS tiene_mov_mantenimiento
             FROM public.presupuestos p
             WHERE p.id = $1
             LIMIT 1`,
            [factura.presupuesto_id]
        );
        if (resPresCheck.rows.length > 0) {
            const pRow = resPresCheck.rows[0];
            const esOrdenRetiroOAdmin = pRow.tipo_comprobante === 'Orden de Retiro'
                || ['Orden de Retiro', 'Administrativa NC', 'Recibido', 'Conciliado', 'Retirado'].includes(pRow.estado)
                || pRow.estado_logistico === 'OMITIDO'
                || pRow.tiene_mov_mantenimiento === true;
            if (esOrdenRetiroOAdmin) {
                console.log(`🛡️ [FACTURACION-SERVICE] Nota de Crédito ID ${factura.id} proviene de Orden de Retiro / Administrativa NC (#${factura.presupuesto_id}). Se bloquea suma de stock en depósito.`);
                return;
            }
        }
    }

    // Si es Nota de Crédito y no tiene presupuesto_id ni factura_asociada_id (Mantenimiento puro), omitimos el movimiento automático de stock
    if (esNotaCredito && !factura.presupuesto_id && !factura.factura_asociada_id) {
        console.log(`ℹ️ [FACTURACION-SERVICE] Comprobante es Nota de Crédito de Mantenimiento (sin presupuesto_id ni factura_asociada_id). Se omite movimiento automático de stock.`);
        return;
    }

    // Si no es factura ni nota de crédito (con presupuesto_id), no movemos stock
    if (!esFactura && !esNotaCredito) {
        console.log(`ℹ️ [FACTURACION-SERVICE] Comprobante tipo ${factura.tipo_cbte} no requiere movimiento de stock.`);
        return;
    }

    // Cargar ítems si no están ya en el objeto factura
    const items = factura.items || (await client.query(
        `SELECT * FROM factura_factura_items WHERE factura_id = $1 ORDER BY orden ASC`,
        [factura.id]
    )).rows;

    console.log(`🔍 [FACTURACION-SERVICE] Procesando ${items.length} ítems para stock...`);

    const { recalcularStockConsolidado } = require('../../produccion/utils/recalcularStock');

    let letra = 'A';
    if ([6, 7, 8].includes(parseInt(factura.tipo_cbte))) letra = 'B';
    if ([11, 12, 13].includes(parseInt(factura.tipo_cbte))) letra = 'C';
    const nroComprobante = factura.cbte_nro || factura.nro_interno || '';
    const esInterna = !factura.requiere_afip;
    let proveedorCliente = null;

    for (const item of items) {
        if (item.es_saldo_ingrediente === true) {
            console.log(`⚖️ [STOCK-FACTURA] Ítem "${item.descripcion}" proviene de Saldo de Ingrediente (${item.kilos_saldo || 0} kg ya descontados en presupuesto). Se omite descuento de stock de artículo terminado.`);
            continue;
        }

        // Verificar también en el presupuesto origen por si es un borrador anterior a la marca en factura_items
        if (factura.presupuesto_id) {
            const checkSaldoRes = await client.query(`
                SELECT COALESCE(pd.es_saldo_ingrediente, false) as es_saldo_ingrediente, pd.kilos_saldo
                FROM public.presupuestos_detalles pd
                WHERE pd.id_presupuesto = $1
                  AND ABS(COALESCE(pd.cantidad, 0) - $2) < 0.001
                  AND COALESCE(pd.es_saldo_ingrediente, false) = true
                LIMIT 1
            `, [factura.presupuesto_id, parseFloat(item.qty) || 0]);
            if (checkSaldoRes.rows.length > 0) {
                console.log(`⚖️ [STOCK-FACTURA] Ítem "${item.descripcion}" detectado como Saldo de Ingrediente en presupuesto #${factura.presupuesto_id}. Se omite descuento de stock de artículo terminado.`);
                continue;
            }
        }

        let resolvedArt = null;

        // 0. Coincidencia directa por articulo_id si fue guardado en factura_factura_items
        if (item.articulo_id) {
            const artById = await client.query(`
                SELECT numero, nombre, codigo_barras 
                FROM public.articulos 
                WHERE UPPER(TRIM(codigo_barras)) = UPPER(TRIM($1))
                   OR UPPER(TRIM(numero)) = UPPER(TRIM($1))
                LIMIT 1
            `, [String(item.articulo_id)]);
            if (artById.rows.length > 0) {
                resolvedArt = artById.rows[0];
            }
        }

        // 1. Coincidencia exacta por nombre
        if (!resolvedArt && item.descripcion) {
            const artByName = await client.query(`
                SELECT numero, nombre, codigo_barras 
                FROM public.articulos 
                WHERE UPPER(TRIM(nombre)) = UPPER(TRIM($1))
                LIMIT 1
            `, [item.descripcion]);

            if (artByName.rows.length > 0) {
                resolvedArt = artByName.rows[0];
            }
        }

        // 2. Coincidencia a través del presupuesto original
        if (!resolvedArt && factura.presupuesto_id) {
            const budgetRes = await client.query(`
                SELECT pd.articulo as barcode, a.numero as articulo_numero, a.nombre as articulo_nombre, pd.cantidad, pd.valor1
                FROM public.presupuestos_detalles pd
                LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
                WHERE pd.id_presupuesto = $1
            `, [factura.presupuesto_id]);

            // Coincidir por nombre
            let budgetMatch = budgetRes.rows.find(bd => 
                bd.articulo_nombre && 
                bd.articulo_nombre.toUpperCase().trim() === item.descripcion.toUpperCase().trim()
            );

            // Coincidir por precio y cantidad
            if (!budgetMatch) {
                budgetMatch = budgetRes.rows.find(bd => 
                    parseFloat(bd.cantidad) === parseFloat(item.qty) && 
                    parseFloat(bd.valor1) === parseFloat(item.p_unit)
                );
            }

            if (budgetMatch && budgetMatch.articulo_numero) {
                resolvedArt = {
                    numero: budgetMatch.articulo_numero,
                    codigo_barras: budgetMatch.barcode
                };
            }
        }

        const codigoItemCand = item.articulo_id ? String(item.articulo_id).trim() : '';
        const esItemInsumoKit = ['135', '136'].includes(codigoItemCand)
            || /\(Stock Cliente\)|\(Insumo Receta\)/i.test(String(item.descripcion || ''));

        // Si fue resuelto por error como artículo general pero es explícitamente un insumo de kit (135/136 o Stock Cliente), forzar flujo de ingrediente satélite
        if (esItemInsumoKit) {
            resolvedArt = null;
        }

        // 3. Coincidencia parcial por ILIKE en nombre (solo si no es insumo de kit)
        if (!resolvedArt && !esItemInsumoKit && item.descripcion) {
            const artByNameLike = await client.query(`
                SELECT numero, nombre, codigo_barras 
                FROM public.articulos 
                WHERE nombre ILIKE $1 
                   OR nombre ILIKE $2
                LIMIT 1
            `, [item.descripcion, `%${item.descripcion}%`]);

            if (artByNameLike.rows.length > 0) {
                resolvedArt = artByNameLike.rows[0];
            }
        }

        if (!resolvedArt) {
            // Intentar resolver como ingrediente para stock satélite del colaborador (soportando articulo_id 135/136 y prefijos '↳ (Stock Cliente) ' / '🟣 (Stock Cliente) ')
            const descIngLimpia = String(item.descripcion || '')
                .replace(/^[↳🟣\s]*\(Stock Cliente\)\s*/i, '')
                .replace(/^[↳🟣\s]*\(Insumo Receta\)\s*/i, '')
                .replace(/\s*\(Desc\.\s*esp\.\s*[\d.,]+%\)\s*$/i, '')
                .trim();

            const ingRes = await client.query(`
                SELECT i.id, i.nombre 
                FROM public.ingredientes i
                WHERE ($1 <> '' AND (i.id::text = $1 OR TRIM(i.codigo::text) = $1))
                   OR ($2 <> '' AND (UPPER(TRIM(i.nombre)) = UPPER(TRIM($2)) OR i.id::text = $2 OR TRIM(i.codigo::text) = $2))
                ORDER BY ($1 <> '' AND i.id::text = $1) DESC
                LIMIT 1
            `, [codigoItemCand, descIngLimpia]);

            if (ingRes.rows.length > 0) {
                const ingrediente = ingRes.rows[0];
                console.log(`   🥗 [FACTURACION-SERVICE] Detectado ingrediente de kit: "${ingrediente.nombre}" (${ingrediente.id}). Buscando usuario colaborador...`);

                let usuarioId = null;
                if (factura.presupuesto_id || factura.cliente_id) {
                    const userRes = await client.query(`
                        SELECT bc.usuario_id 
                        FROM public.bunker_clientes bc
                        LEFT JOIN public.presupuestos p ON p.id = $1
                        WHERE bc.usuario_id IS NOT NULL
                          AND (
                              (p.id IS NOT NULL AND COALESCE(NULLIF(LTRIM(TRIM(bc.lomas_soft_id::text), '0'), ''), '0') = COALESCE(NULLIF(LTRIM(TRIM(p.id_cliente::text), '0'), ''), '0'))
                              OR ($2::text IS NOT NULL AND $2::text <> '' AND COALESCE(NULLIF(LTRIM(TRIM(bc.lomas_soft_id::text), '0'), ''), '0') = COALESCE(NULLIF(LTRIM(TRIM($2::text), '0'), ''), '0'))
                          )
                        ORDER BY (p.id IS NOT NULL) DESC
                        LIMIT 1
                    `, [
                        factura.presupuesto_id || null,
                        factura.cliente_id ? String(factura.cliente_id) : null
                    ]);

                    if (userRes.rows.length > 0) {
                        usuarioId = userRes.rows[0].usuario_id;
                    }
                }

                if (usuarioId) {
                    const cantIng = parseFloat(item.qty || 1);
                    const deltaIng = esNotaCredito ? cantIng : -cantIng;
                    const tipoMovSat = esNotaCredito ? 'devolucion_venta' : 'egreso_venta';
                    const obsSat = `${esNotaCredito ? 'Devolución' : 'Egreso'} automático por facturación de comprobante #${factura.pto_vta}-${nroComprobante}`;

                    // Evitar doble descuento para el mismo comprobante e ingrediente
                    const dupSatCheck = await client.query(`
                        SELECT id FROM public.colaborador_stock_satelite_movimientos
                        WHERE usuario_id = $1
                          AND ingrediente_id = $2
                          AND tipo = $3
                          AND (($4::int IS NOT NULL AND presupuesto_id = $4::int AND observaciones = $5) OR observaciones = $5)
                        LIMIT 1
                    `, [usuarioId, ingrediente.id, tipoMovSat, factura.presupuesto_id || null, obsSat]);

                    if (dupSatCheck.rowCount === 0) {
                        await client.query(`
                            INSERT INTO public.colaborador_stock_satelite_movimientos (
                                usuario_id, ingrediente_id, kilos, tipo, presupuesto_id, observaciones
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `, [
                            usuarioId,
                            ingrediente.id,
                            deltaIng,
                            tipoMovSat,
                            factura.presupuesto_id || null,
                            obsSat
                        ]);
                        console.log(`   ✅ [FACTURACION-SERVICE] Movimiento de stock satélite registrado para ingrediente ${ingrediente.nombre} (Cliente Usuario ${usuarioId}): ${deltaIng} kg`);
                    } else {
                        console.log(`   ℹ️ [FACTURACION-SERVICE] Movimiento satélite ya existente para ingrediente ${ingrediente.nombre} en comprobante #${factura.pto_vta}-${nroComprobante}, se omite duplicado.`);
                    }
                } else {
                    console.warn(`⚠️ [FACTURACION-SERVICE] No se encontró usuario colaborador asociado para el ingrediente "${ingrediente.nombre}".`);
                }
                continue;
            }

            console.warn(`⚠️ [FACTURACION-SERVICE] No se pudo resolver el artículo ni ingrediente para el ítem: "${item.descripcion}". Se saltará el movimiento de stock para este ítem.`);
            continue;
        }

        const articuloNumero = resolvedArt.numero || resolvedArt.articulo_numero;
        const codigoBarras = resolvedArt.codigo_barras || null;
        const qty = parseFloat(item.qty);
        
        let docDesc = '';
        if (esNotaCredito) {
            docDesc = esInterna ? 'Nota de Crédito Interna' : `Nota de Crédito ${letra}`;
        } else {
            docDesc = esInterna ? 'Factura Interna' : `Factura ${letra}`;
        }
        
        const obs = `${docDesc} #${factura.pto_vta}-${nroComprobante}`;
        const tipoMov = esNotaCredito ? 'ingreso' : 'egreso';
        const qtyDelta = esNotaCredito ? qty : -qty;

        console.log(`   - Resolvió: "${item.descripcion}" -> Código: ${articuloNumero} (${codigoBarras}) | Cantidad: ${qty} | Mov: ${tipoMov}`);

        // Verificar si el artículo resuelto es un pack en public.stock_real_consolidado
        const packConfigRes = await client.query(`
            SELECT es_pack, pack_hijo_codigo, pack_unidades 
            FROM public.stock_real_consolidado 
            WHERE articulo_numero = $1
        `, [articuloNumero]);

        let targetArticuloNumero = articuloNumero;
        let targetCodigoBarras = codigoBarras;
        let targetQty = qty;
        let targetQtyDelta = qtyDelta;
        let targetObs = obs;

        if (packConfigRes.rows.length > 0) {
            const packRow = packConfigRes.rows[0];
            if (packRow.es_pack && packRow.pack_hijo_codigo && parseInt(packRow.pack_unidades, 10) > 0) {
                const packHijoCodigo = packRow.pack_hijo_codigo;
                const packUnidades = parseInt(packRow.pack_unidades, 10);

                // Buscar el artículo hijo en public.articulos
                const childArtRes = await client.query(`
                    SELECT numero, nombre, codigo_barras 
                    FROM public.articulos 
                    WHERE codigo_barras = $1 OR numero = $1
                    LIMIT 1
                `, [packHijoCodigo]);

                if (childArtRes.rows.length > 0) {
                    const childArt = childArtRes.rows[0];
                    targetArticuloNumero = childArt.numero;
                    targetCodigoBarras = childArt.codigo_barras || null;
                    targetQty = qty * packUnidades;
                    targetQtyDelta = esNotaCredito ? targetQty : -targetQty;
                    targetObs = `${obs} (Componente de Pack: ${resolvedArt.nombre || item.descripcion})`;
                    console.log(`   📦 [FACTURACION-SERVICE] Detectado artículo pack. Derivando a artículo hijo: "${childArt.nombre}" (${targetArticuloNumero}) | Cantidad total: ${targetQty}`);
                } else {
                    console.warn(`⚠️ [FACTURACION-SERVICE] El artículo "${articuloNumero}" está marcado como pack pero no se encontró el artículo hijo con código/número "${packHijoCodigo}". Se descontará del pack directamente.`);
                }
            }
        }

        // Insertar en stock_ventas_movimientos
        const insertMovQuery = `
            INSERT INTO public.stock_ventas_movimientos (
                articulo_numero, codigo_barras, kilos, cantidad,
                carro_id, usuario_id, fecha, tipo, observaciones, origen_ingreso
            ) VALUES ($1, $2, 0, $3, NULL, NULL, NOW(), $4, $5, 'facturacion')
        `;
        await client.query(insertMovQuery, [
            targetArticuloNumero,
            targetCodigoBarras,
            targetQty,
            tipoMov,
            targetObs
        ]);

        // Insertar/Actualizar en stock_real_consolidado
        const updateStockQuery = `
            INSERT INTO public.stock_real_consolidado (
                articulo_numero, stock_movimientos, stock_ajustes, es_pack, ultima_actualizacion
            )
            VALUES ($1, $2, 0, FALSE, NOW())
            ON CONFLICT (articulo_numero) 
            DO UPDATE SET 
                stock_movimientos = COALESCE(stock_real_consolidado.stock_movimientos, 0) + $2,
                ultima_actualizacion = NOW()
        `;
        await client.query(updateStockQuery, [
            targetArticuloNumero,
            targetQtyDelta
        ]);

        // Recalcular stock_consolidado
        await recalcularStockConsolidado(client, targetArticuloNumero);
        console.log(`   ✅ Movimiento e incremento/decremento completado para artículo: ${targetArticuloNumero}`);
    }
};

/**
 * Anular factura: crea un borrador de Nota de Crédito espejo
 * @param {number} facturaId - ID de la factura a anular
 * @param {string} usuario - Usuario que realiza la acción
 * @param {boolean} [moverStock=true] - Si es false, la NC nace con stock_descontado=true (no mueve mercadería)
 * @returns {Promise<number>} ID del borrador de la Nota de Crédito creada
 */
const anular = async (facturaId, usuario, moverStock = true) => {
    console.log(`🚫 [FACTURACION-SERVICE] Iniciando anulación para factura ID: ${facturaId} por usuario: ${usuario} (Mover Stock: ${moverStock})`);

    try {
        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener y bloquear la factura original
            const queryFactura = `
                SELECT * FROM factura_facturas 
                WHERE id = $1 
                FOR UPDATE
            `;
            const resFactura = await client.query(queryFactura, [facturaId]);
            if (resFactura.rows.length === 0) {
                throw new Error(`Factura ID ${facturaId} no encontrada.`);
            }

            const facturaOrig = resFactura.rows[0];

            // 2. Validar que la factura original esté en estado APROBADA o APROBADA_LOCAL
            if (facturaOrig.estado !== 'APROBADA' && facturaOrig.estado !== 'APROBADA_LOCAL') {
                throw new Error(`Solo se pueden anular facturas en estado APROBADA o APROBADA_LOCAL. Estado actual: ${facturaOrig.estado}`);
            }

            // 3. Validar que no sea ya una Nota de Crédito
            const tipoCbteInt = parseInt(facturaOrig.tipo_cbte);
            if ([3, 8, 13].includes(tipoCbteInt)) {
                throw new Error(`No se puede anular una Nota de Crédito (Tipo ${facturaOrig.tipo_cbte}).`);
            }

            // 4. Validar que no haya sido anulada anteriormente (que no tenga una NC aprobada o borrador)
            const queryNCExistente = `
                SELECT id, estado, cbte_nro, nro_interno 
                FROM factura_facturas 
                WHERE factura_asociada_id = $1 AND estado != 'RECHAZADA'
                LIMIT 1
            `;
            const resNCExistente = await client.query(queryNCExistente, [facturaId]);
            if (resNCExistente.rows.length > 0) {
                const nc = resNCExistente.rows[0];
                throw new Error(`Esta factura ya tiene un proceso de anulación asociado (NC ID ${nc.id}, Estado: ${nc.estado}).`);
            }

            // 5. Determinar el tipo de Nota de Crédito
            let tipoNC;
            if (tipoCbteInt === 1) { // Factura A
                tipoNC = 3; // Nota de Crédito A
            } else if (tipoCbteInt === 6) { // Factura B
                tipoNC = 8; // Nota de Crédito B
            } else if (tipoCbteInt === 11) { // Factura C
                tipoNC = 13; // Nota de Crédito C
            } else {
                throw new Error(`Tipo de comprobante ${facturaOrig.tipo_cbte} no soportado para anulación automática.`);
            }

            // 6. Obtener ítems de la factura original
            const queryItems = `
                SELECT * FROM factura_factura_items 
                WHERE factura_id = $1 
                ORDER BY orden ASC
            `;
            const resItems = await client.query(queryItems, [facturaId]);
            const items = resItems.rows;

            if (items.length === 0) {
                throw new Error(`La factura original no tiene ítems.`);
            }

            // 7. Crear cabecera de la Nota de Crédito (Borrador)
            // Si moverStock es false (anulación administrativa), marcamos stock_descontado = TRUE para que emitir() no mueva stock
            const stockDescontadoFlag = !moverStock;

            const origNeto = parseFloat(facturaOrig.imp_neto) || 0;
            const origIva = parseFloat(facturaOrig.imp_iva) || 0;
            const origTotal = parseFloat(facturaOrig.imp_total) || 0;
            const origCostoEst = parseFloat(facturaOrig.costo_estimado_total) || 0;
            const origMerc = parseFloat(facturaOrig.costo_mercaderia_total) || 0;
            const origMo = parseFloat(facturaOrig.costo_mano_obra_total) || 0;
            const origIns = parseFloat(facturaOrig.costo_insumos_total) || 0;
            const origAlicIibb = parseFloat(facturaOrig.alicuota_iibb) || 4.00;
            const origIibb = parseFloat(facturaOrig.imp_iibb) || redondear(origTotal * (origAlicIibb / 100), 2);
            const origDifIva = (facturaOrig.imp_dif_iva !== undefined && facturaOrig.imp_dif_iva !== null && parseFloat(facturaOrig.imp_dif_iva) > 0)
                ? parseFloat(facturaOrig.imp_dif_iva)
                : redondear(Math.max(0, origIva - ((origMerc + origIns) * 0.21)), 2);
            const origGanSinIibb = (facturaOrig.ganancia_sin_iibb_total !== undefined && facturaOrig.ganancia_sin_iibb_total !== null && parseFloat(facturaOrig.ganancia_sin_iibb_total) !== 0)
                ? parseFloat(facturaOrig.ganancia_sin_iibb_total)
                : redondear(origNeto - origCostoEst - origIibb, 2);
            const origGanReal = redondear(origGanSinIibb - origDifIva, 2);

            const queryInsertNC = `
                INSERT INTO factura_facturas (
                    tipo_cbte, pto_vta, concepto, fecha_emision,
                    cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                    moneda, mon_cotiz,
                    imp_neto, imp_iva, imp_trib, imp_total,
                    estado, requiere_afip, serie_interna, presupuesto_id,
                    factura_asociada_id, stock_descontado, costo_estimado_total,
                    alicuota_iibb, imp_iibb, imp_dif_iva, costo_mercaderia_total, costo_mano_obra_total,
                    costo_insumos_total, ganancia_sin_iibb_total, ganancia_real_total, foto_capturada,
                    emitida_en, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, 'BORRADOR', $14, $15, $16, $17,
                    $18, $19,
                    $20, $21, $22, $23, $24, $25, $26, $27, $28,
                    NOW(), NOW(), NOW()
                )
                RETURNING id
            `;

            const resInsertNC = await client.query(queryInsertNC, [
                tipoNC,
                facturaOrig.pto_vta,
                facturaOrig.concepto,
                facturaOrig.cliente_id,
                facturaOrig.doc_tipo,
                facturaOrig.doc_nro,
                facturaOrig.condicion_iva_id,
                facturaOrig.moneda,
                facturaOrig.mon_cotiz,
                facturaOrig.imp_neto,
                facturaOrig.imp_iva,
                facturaOrig.imp_trib,
                facturaOrig.imp_total,
                facturaOrig.requiere_afip,
                facturaOrig.serie_interna,
                facturaOrig.presupuesto_id,
                facturaOrig.id, // factura_asociada_id
                stockDescontadoFlag,
                facturaOrig.costo_estimado_total || null,
                origAlicIibb,
                origIibb,
                origDifIva,
                origMerc,
                origMo,
                origIns,
                origGanSinIibb,
                origGanReal,
                facturaOrig.foto_capturada || false
            ]);

            const ncId = resInsertNC.rows[0].id;
            console.log(`✅ [FACTURACION-SERVICE] Cabecera de Nota de Crédito Borrador creada con foto - ID: ${ncId} (stock_descontado: ${stockDescontadoFlag})`);

            // 8. Insertar ítems en la Nota de Crédito preservando costos integrados y desglose
            const queryInsertItem = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, qty, p_unit, alic_iva_id,
                    imp_neto, imp_iva, orden, costo_unitario, costo_total,
                    articulo_id, costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                    costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
            `;

            for (const item of items) {
                await client.query(queryInsertItem, [
                    ncId,
                    item.descripcion,
                    item.qty,
                    item.p_unit,
                    item.alic_iva_id,
                    item.imp_neto,
                    item.imp_iva,
                    item.orden,
                    item.costo_unitario || null,
                    item.costo_total || null,
                    item.articulo_id || null,
                    item.costo_mercaderia_unitario || 0,
                    item.costo_mano_obra_unitario || 0,
                    item.costo_insumos_unitario || 0,
                    item.costo_mercaderia_total || 0,
                    item.costo_mano_obra_total || 0,
                    item.costo_insumos_total || 0
                ]);
            }

            console.log(`✅ [FACTURACION-SERVICE] ${items.length} ítems con foto de costos copiados a la Nota de Crédito ID: ${ncId}`);

            return ncId;
        });
    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error en anular:', error.message);
        throw error;
    }
};

/**
 * Pasar una factura borrador al estado de Facturación Diferida
 * Descuenta stock y debita en CC provisoriamente, postergando la obtención de CAE.
 * @param {number} facturaId - ID de la factura borrador
 * @param {string} usuario - Usuario operador
 * @returns {Promise<Object>} Factura actualizada
 */
const diferir = async (facturaId, usuario = 'SISTEMA') => {
    console.log(`⏳ [FACTURACION-SERVICE] Pasando a Facturación Diferida - ID: ${facturaId}`);

    const factura = await obtenerPorId(facturaId);

    if (factura.estado !== 'BORRADOR') {
        throw new Error(`Solo se pueden diferir facturas en estado BORRADOR (estado actual: ${factura.estado})`);
    }

    return await ejecutarTransaccion(async (client) => {
        // 1. Mover stock si es puesto 32 o 90 y aún no fue descontado
        if ((factura.pto_vta === 32 || factura.pto_vta === 90) && !factura.stock_descontado) {
            await registrarMovimientosStockFactura(factura, client);
        }

        // 2. Registrar débito provisorio en Cuenta Corriente
        await cuentaCorrienteService.registrarEntregaDiferida(factura, client);

        // 3. Actualizar factura a estado PENDIENTE_FACTURACION
        const queryUpdate = `
            UPDATE factura_facturas
            SET 
                estado = 'PENDIENTE_FACTURACION',
                stock_descontado = TRUE,
                diferida_en = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const res = await client.query(queryUpdate, [factura.id]);

        // 4. Si tiene presupuesto asociado, actualizar origen_facturacion a DIFERIDO
        if (factura.presupuesto_id) {
            await client.query(`
                UPDATE public.presupuestos 
                SET origen_facturacion = 'DIFERIDO' 
                WHERE id = $1
            `, [factura.presupuesto_id]);
            console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${factura.presupuesto_id} marcado con origen_facturacion = 'DIFERIDO'`);
        }

        console.log(`✅ [FACTURACION-SERVICE] Factura ID ${factura.id} pasada exitosamente a Facturación Diferida`);
        return res.rows[0];
    });
};

/**
 * Revertir una factura diferida a estado BORRADOR (devolviendo stock y anulando débito provisorio en CC)
 * @param {number} facturaId - ID de la factura
 * @returns {Promise<Object>} Factura actualizada
 */
const revertirDiferida = async (facturaId) => {
    console.log(`↩️ [FACTURACION-SERVICE] Revirtiendo Facturación Diferida - ID: ${facturaId}`);

    const factura = await obtenerPorId(facturaId);

    if (factura.estado !== 'PENDIENTE_FACTURACION') {
        throw new Error(`Solo se pueden revertir facturas en estado PENDIENTE_FACTURACION (estado actual: ${factura.estado})`);
    }

    return await ejecutarTransaccion(async (client) => {
        // 1. Revertir movimientos de stock si fueron descontados
        if (factura.stock_descontado) {
            // Emulamos tipo comprobante Nota de Crédito para registrar el ingreso y revertir
            const facturaReversion = { ...factura, tipo_cbte: 3 };
            await registrarMovimientosStockFactura(facturaReversion, client);
        }

        // 2. Revertir movimiento en Cuenta Corriente
        await cuentaCorrienteService.revertirEntregaDiferida(factura, client);

        // 3. Volver factura a BORRADOR
        const queryUpdate = `
            UPDATE factura_facturas
            SET 
                estado = 'BORRADOR',
                stock_descontado = FALSE,
                diferida_en = NULL,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        const res = await client.query(queryUpdate, [factura.id]);

        // 4. Si tiene presupuesto asociado, volver a PENDIENTE
        if (factura.presupuesto_id) {
            await client.query(`
                UPDATE public.presupuestos 
                SET origen_facturacion = 'PENDIENTE' 
                WHERE id = $1
            `, [factura.presupuesto_id]);
        }

        console.log(`✅ [FACTURACION-SERVICE] Factura ID ${factura.id} revertida a BORRADOR exitosamente`);
        return res.rows[0];
    });
};

console.log('✅ [FACTURACION-SERVICE] Servicio de facturación cargado');

module.exports = {
    crearBorrador,
    emitir,
    diferir,
    revertirDiferida,
    obtenerPorId,
    calcularTotales,
    registrarMovimientosStockFactura,
    anular
};
