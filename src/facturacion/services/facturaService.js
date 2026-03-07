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
            // Insertar cabecera
            const queryCabecera = `
                INSERT INTO factura_facturas (
                    tipo_cbte, pto_vta, concepto, fecha_emision,
                    cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                    moneda, mon_cotiz,
                    imp_neto, imp_iva, imp_trib, imp_total,
                    estado, requiere_afip, serie_interna, presupuesto_id,
                    factura_asociada_id,
                    emitida_en, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18,
                    $19, $20, $21, $22
                )
                RETURNING *
            `;

            const resultadoCabecera = await client.query(queryCabecera, [
                datos.tipo_cbte,
                datos.pto_vta,
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
                datos.factura_asociada_id || null, // $19
                paraBD(), // $20
                paraBD(), // $21
                paraBD() // $22
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

            // 3. Actualizar factura
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
                cbteNro,
                resultadoCAE.cae,
                desdeFormatoAFIP(resultadoCAE.cae_vto),
                resultadoCAE.resultado,
                estado,
                paraBD(),
                factura.id
            ]);

            console.log(`✅ [FACTURACION-SERVICE] Factura actualizada - Estado: ${estado}`);

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
            const nroInterno = await nextInterno(factura.serie_interna);
            console.log(`🔢 [FACTURACION-SERVICE] Número interno asignado: ${factura.serie_interna}-${nroInterno}`);

            // 2. Actualizar factura
            const queryUpdate = `
                UPDATE factura_facturas
                SET 
                    nro_interno = $1,
                    estado = $2,
                    updated_at = $3
                WHERE id = $4
                RETURNING *
            `;

            const resultado = await client.query(queryUpdate, [
                nroInterno,
                'APROBADA_LOCAL',
                paraBD(),
                factura.id
            ]);

            console.log(`✅ [FACTURACION-SERVICE] Factura interna emitida`);

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
        // Obtener factura con datos del cliente (apellido = razón social) y descuento del presupuesto
        const queryFactura = `
            SELECT 
                f.*,
                c.apellido as razon_social,
                COALESCE(p.descuento, 0) as descuento
            FROM factura_facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.cliente_id
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
                i.*,
                COALESCE(a.nombre, i.descripcion) as descripcion
            FROM factura_factura_items i
            LEFT JOIN articulos a ON a.codigo_barras = i.descripcion
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

        return factura;

    } catch (error) {
        console.error('❌ [FACTURACION-SERVICE] Error obteniendo factura:', error.message);
        throw error;
    }
};

console.log('✅ [FACTURACION-SERVICE] Servicio de facturación cargado');

module.exports = {
    crearBorrador,
    emitir,
    obtenerPorId,
    calcularTotales
};
