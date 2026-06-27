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
        // 1. IDEMPOTENCIA: Verificar si ya existe factura para este presupuesto
        if (datos.presupuesto_id) {
            console.log('🔍 [FACTURACION-SERVICE] Verificando idempotencia por presupuesto_id...');

            const queryExistente = `
                SELECT * FROM factura_facturas 
                WHERE presupuesto_id = $1 
                AND estado IN ('BORRADOR', 'APROBADA', 'APROBADA_LOCAL')
                LIMIT 1
            `;

            const resultadoExistente = await pool.query(queryExistente, [datos.presupuesto_id]);

            if (resultadoExistente.rows.length > 0) {
                const facturaExistente = resultadoExistente.rows[0];
                console.log(`⚠️ [FACTURACION-SERVICE] Factura ya existe para presupuesto ${datos.presupuesto_id}`);
                console.log(`   - factura_id: ${facturaExistente.id}`);
                console.log(`   - estado: ${facturaExistente.estado}`);

                // Retornar con flag de idempotencia
                return {
                    ...facturaExistente,
                    _idempotente: true,
                    _mensaje: 'Factura ya existe para este presupuesto'
                };
            }

            console.log('✅ [FACTURACION-SERVICE] No existe factura previa, continuando...');
        }

        // 2. Validar datos
        const validacion = validarFacturaCompleta(datos);
        if (!validacion.valido) {
            throw new Error(`Validación fallida: ${validacion.errores.join(', ')}`);
        }

        console.log('✅ [FACTURACION-SERVICE] Datos validados');

        // 3. Procesar items según precio_modo
        const itemsProcesados = procesarItemsSegunPrecioModo(datos.items, datos.precio_modo);
        console.log(`✅ [FACTURACION-SERVICE] Items procesados (modo: ${datos.precio_modo})`);

        // 4. Calcular totales
        const totales = calcularTotales(itemsProcesados);
        console.log('✅ [FACTURACION-SERVICE] Totales calculados');
        console.log(`   - Neto: ${totales.imp_neto}`);
        console.log(`   - IVA: ${totales.imp_iva}`);
        console.log(`   - Total: ${totales.imp_total}`);

        // 5. Extraer datos de cliente
        const cliente = datos.cliente || {};

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

            // Insertar cabecera
            const queryCabecera = `
                INSERT INTO factura_facturas (
                    tipo_cbte, pto_vta, cbte_nro, concepto, fecha_emision,
                    cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                    moneda, mon_cotiz,
                    imp_neto, imp_iva, imp_trib, imp_total,
                    estado, requiere_afip, serie_interna, presupuesto_id,
                    factura_asociada_id,
                    emitida_en, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18,
                    $19, $20, $21, $22, $23
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
                paraBD(), // $21
                paraBD(), // $22
                paraBD() // $23
            ]);

            const facturaCreada = resultadoCabecera.rows[0];
            console.log(`✅ [FACTURACION-SERVICE] Cabecera creada - ID: ${facturaCreada.id}`);

            // Insertar items
            const queryItem = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, qty, p_unit, alic_iva_id,
                    imp_neto, imp_iva, orden, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;

            for (let i = 0; i < itemsProcesados.length; i++) {
                const item = itemsProcesados[i];

                await client.query(queryItem, [
                    facturaCreada.id,
                    item.descripcion,
                    comaAPunto(item.qty),
                    comaAPunto(item.p_unit_neto), // Usar precio neto ya calculado
                    item.alic_iva_id,
                    item.imp_neto,
                    item.imp_iva,
                    i + 1,
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
                
                // Si es del puesto 32 o 90, mover stock
                if (resultado.rows[0].pto_vta === 32 || resultado.rows[0].pto_vta === 90) {
                    await registrarMovimientosStockFactura(resultado.rows[0], client);
                }
                
                const isNotaCredito = [3, 8, 13].includes(parseInt(resultado.rows[0].tipo_cbte));

                if (isNotaCredito && resultado.rows[0].factura_asociada_id) {
                    // 1. Marcar la factura asociada como ANULADA
                    await client.query(
                        `UPDATE factura_facturas SET estado = 'ANULADA', updated_at = NOW() WHERE id = $1`,
                        [resultado.rows[0].factura_asociada_id]
                    );
                    console.log(`❌ [FACTURACION-SERVICE] Factura original ID ${resultado.rows[0].factura_asociada_id} marcada como ANULADA`);

                    // 2. Desvincular el presupuesto de origen y volver a poner en estado 'Presupuesto/Orden'
                    if (resultado.rows[0].presupuesto_id) {
                        await client.query(
                            `UPDATE public.presupuestos SET factura_id = NULL, estado = 'Presupuesto/Orden' WHERE id = $1`,
                            [resultado.rows[0].presupuesto_id]
                        );
                        console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${resultado.rows[0].presupuesto_id} desvinculado de factura y restaurado a 'Presupuesto/Orden'`);
                    }
                } else if (resultado.rows[0].presupuesto_id) {
                    // Actualizar estado de presupuesto de origen a 'Facturado'
                    await client.query(
                        `UPDATE public.presupuestos SET estado = 'Facturado' WHERE id = $1`,
                        [resultado.rows[0].presupuesto_id]
                    );
                    console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${resultado.rows[0].presupuesto_id} actualizado a 'Facturado'`);
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

            // Si es del puesto 32 o 90, mover stock
            if (resultado.rows[0].pto_vta === 32 || resultado.rows[0].pto_vta === 90) {
                await registrarMovimientosStockFactura(resultado.rows[0], client);
            }

            // Si es Nota de Crédito, anular la factura asociada y desvincular presupuesto
            const isNotaCredito = [3, 8, 13].includes(parseInt(resultado.rows[0].tipo_cbte));

            if (isNotaCredito && resultado.rows[0].factura_asociada_id) {
                // 1. Marcar la factura asociada como ANULADA
                await client.query(
                    `UPDATE factura_facturas SET estado = 'ANULADA', updated_at = NOW() WHERE id = $1`,
                    [resultado.rows[0].factura_asociada_id]
                );
                console.log(`❌ [FACTURACION-SERVICE] Factura original ID ${resultado.rows[0].factura_asociada_id} marcada como ANULADA (Emisión Interna)`);

                // 2. Desvincular el presupuesto de origen y volver a poner en estado 'Presupuesto/Orden'
                if (resultado.rows[0].presupuesto_id) {
                    await client.query(
                        `UPDATE public.presupuestos SET factura_id = NULL, estado = 'Presupuesto/Orden' WHERE id = $1`,
                        [resultado.rows[0].presupuesto_id]
                    );
                    console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${resultado.rows[0].presupuesto_id} desvinculado de factura y restaurado a 'Presupuesto/Orden' (Emisión Interna)`);
                }
            } else if (resultado.rows[0].presupuesto_id) {
                // Actualizar estado de presupuesto de origen a 'Facturado' (incluso para Puesto 90, la entrega se controla de forma manual en el depósito)
                await client.query(
                    `UPDATE public.presupuestos SET estado = 'Facturado' WHERE id = $1`,
                    [resultado.rows[0].presupuesto_id]
                );
                console.log(`🔗 [FACTURACION-SERVICE] Presupuesto ${resultado.rows[0].presupuesto_id} actualizado a 'Facturado' (Emisión Interna)`);
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
const procesarItemsSegunPrecioModo = (items, precioModo) => {
    console.log(`🔄 [FACTURACION-SERVICE] Procesando items en modo: ${precioModo}`);

    return items.map((item, index) => {
        const qty = comaAPunto(item.qty);
        const pUnit = comaAPunto(item.p_unit);
        const alicuota = ALICUOTAS_IVA[item.alic_iva_id];

        if (!alicuota) {
            throw new Error(`Alícuota IVA ${item.alic_iva_id} no válida en item ${index}`);
        }

        let p_unit_neto, imp_neto, imp_iva;

        if (precioModo === 'NETO') {
            // Precio unitario YA es neto
            p_unit_neto = pUnit;
            imp_neto = redondear(qty * p_unit_neto, 2);
            imp_iva = calcularIVA(imp_neto, alicuota.porcentaje);

            console.log(`   Item ${index}: NETO - p_unit=${pUnit} → neto=${imp_neto}, iva=${imp_iva}`);

        } else if (precioModo === 'FINAL_CON_IVA') {
            // Precio unitario INCLUYE IVA, hay que desglosar
            const divisor = 1 + (alicuota.porcentaje / 100);
            p_unit_neto = redondear(pUnit / divisor, 2);
            imp_neto = redondear(qty * p_unit_neto, 2);
            imp_iva = redondear((qty * pUnit) - imp_neto, 2);

            console.log(`   Item ${index}: FINAL_CON_IVA - p_unit=${pUnit} → neto=${imp_neto}, iva=${imp_iva}`);

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
 * Calcular totales de items (ya procesados)
 * @param {Array} items - Items procesados con imp_neto e imp_iva
 * @returns {Object} Totales calculados
 */
const calcularTotales = (items) => {
    console.log('🧮 [FACTURACION-SERVICE] Calculando totales...');

    let imp_neto = 0;
    let imp_iva = 0;
    let imp_trib = 0;

    items.forEach(item => {
        imp_neto += item.imp_neto;
        imp_iva += item.imp_iva;
    });

    const imp_total = imp_neto + imp_iva + imp_trib;

    return {
        imp_neto: redondear(imp_neto, 2),
        imp_iva: redondear(imp_iva, 2),
        imp_trib: redondear(imp_trib, 2),
        imp_total: redondear(imp_total, 2)
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
                COALESCE(p.descuento, 0) as descuento,
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
            WHERE f.id = $1
        `;

        const resultadoFactura = await pool.query(queryFactura, [id]);

        if (resultadoFactura.rows.length === 0) {
            throw new Error(`Factura ${id} no encontrada`);
        }

        const factura = resultadoFactura.rows[0];

        // Obtener items de la factura con nombre del artículo
        const queryItems = `
            SELECT 
                i.id, 
                i.factura_id, 
                i.qty, 
                i.p_unit, 
                i.alic_iva_id, 
                i.imp_neto, 
                i.imp_iva, 
                i.orden, 
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

        const resultadoItems = await pool.query(queryItems, [id]);
        factura.items = resultadoItems.rows;

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

    // Si no es factura ni nota de crédito, no movemos stock
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

    for (const item of items) {
        let resolvedArt = null;

        // 1. Coincidencia exacta por nombre
        const artByName = await client.query(`
            SELECT numero, nombre, codigo_barras 
            FROM public.articulos 
            WHERE UPPER(TRIM(nombre)) = UPPER(TRIM($1))
            LIMIT 1
        `, [item.descripcion]);

        if (artByName.rows.length > 0) {
            resolvedArt = artByName.rows[0];
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

        // 3. Coincidencia parcial por ILIKE en nombre
        if (!resolvedArt) {
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
            console.warn(`⚠️ [FACTURACION-SERVICE] No se pudo resolver el artículo para el ítem: "${item.descripcion}". Se saltará el movimiento de stock para este ítem.`);
            continue;
        }

        const articuloNumero = resolvedArt.numero || resolvedArt.articulo_numero;
        const codigoBarras = resolvedArt.codigo_barras || null;
        const qty = parseFloat(item.qty);

        // Formatear observaciones descriptivas
        let letra = 'A';
        if ([6, 7, 8].includes(parseInt(factura.tipo_cbte))) letra = 'B';
        if ([11, 12, 13].includes(parseInt(factura.tipo_cbte))) letra = 'C';

        const nroComprobante = factura.cbte_nro || factura.nro_interno || '';
        const esInterna = !factura.requiere_afip;
        
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
 * @returns {Promise<number>} ID del borrador de la Nota de Crédito creada
 */
const anular = async (facturaId, usuario) => {
    console.log(`🚫 [FACTURACION-SERVICE] Iniciando anulación para factura ID: ${facturaId} por usuario: ${usuario}`);

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
            const queryInsertNC = `
                INSERT INTO factura_facturas (
                    tipo_cbte, pto_vta, concepto, fecha_emision,
                    cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                    moneda, mon_cotiz,
                    imp_neto, imp_iva, imp_trib, imp_total,
                    estado, requiere_afip, serie_interna, presupuesto_id,
                    factura_asociada_id,
                    emitida_en, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, 'BORRADOR', $14, $15, $16, $17,
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
                facturaOrig.id // factura_asociada_id
            ]);

            const ncId = resInsertNC.rows[0].id;
            console.log(`✅ [FACTURACION-SERVICE] Cabecera de Nota de Crédito Borrador creada - ID: ${ncId}`);

            // 8. Insertar ítems en la Nota de Crédito
            const queryInsertItem = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, qty, p_unit, alic_iva_id,
                    imp_neto, imp_iva, orden, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
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
                    item.orden
                ]);
            }

            console.log(`✅ [FACTURACION-SERVICE] ${items.length} ítems copiados a la Nota de Crédito ID: ${ncId}`);

            return ncId;
        });
    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error en anular:', error.message);
        throw error;
    }
};

console.log('✅ [FACTURACION-SERVICE] Servicio de facturación cargado');

module.exports = {
    crearBorrador,
    emitir,
    obtenerPorId,
    calcularTotales,
    registrarMovimientosStockFactura,
    anular
};
