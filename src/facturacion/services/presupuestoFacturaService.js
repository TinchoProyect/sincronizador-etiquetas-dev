/**
 * Servicio de Conversión: Presupuesto → Factura BORRADOR
 * Mapea datos de presupuestos a facturas listas para AFIP
 */

const { pool } = require('../config/database');
const { fechaActual } = require('../config/timezone');
const { porcentajeToCodigoAfip, calcularIva } = require('../utils/iva-helper');
const { PTO_VTA } = require('../config/afip');

console.log('🔍 [PRESUPUESTO-FACTURA] Cargando servicio de conversión...');
console.log(`🔍 [PRESUPUESTO-FACTURA] Punto de Venta configurado: ${PTO_VTA}`);

/**
 * Mapeo de Condición IVA a Tipo de Comprobante
 */
const MAPEO_TIPO_CBTE = {
    'Responsable Inscripto': 1,      // Factura A
    'Monotributo': 6,                 // Factura B
    'Consumidor Final': 6,            // Factura B
    'Exento': 6,                      // Factura B
    'No Responsable': 6,              // Factura B
    'IVA Liberado': 6                 // Factura B
};

/**
 * Mapeo de Condición IVA a Código AFIP
 */
const MAPEO_CONDICION_IVA = {
    'Responsable Inscripto': 1,
    'Monotributo': 6,
    'Consumidor Final': 5,
    'Exento': 4,
    'No Responsable': 3,
    'IVA Liberado': 10
};

/**
 * Mapeo de Condición IVA a Tipo de Documento
 */
const MAPEO_DOC_TIPO = {
    'Responsable Inscripto': 80,     // CUIT
    'Monotributo': 80,                // CUIT
    'Consumidor Final': 99,           // Sin identificar
    'Exento': 80,                     // CUIT
    'No Responsable': 96,             // DNI
    'IVA Liberado': 80                // CUIT
};


/**
 * Obtener datos completos del presupuesto
 */
async function obtenerDatosPresupuesto(presupuestoId) {
    console.log(`🔍 [PRESUPUESTO-FACTURA] Obteniendo datos del presupuesto ${presupuestoId}...`);

    try {
        // Obtener presupuesto
        const presupuestoQuery = `
            SELECT * FROM presupuestos
            WHERE id = $1
        `;
        const presupuestoResult = await pool.query(presupuestoQuery, [presupuestoId]);

        if (presupuestoResult.rows.length === 0) {
            throw new Error(`Presupuesto ${presupuestoId} no encontrado`);
        }

        const presupuesto = presupuestoResult.rows[0];
        console.log(`✅ [PRESUPUESTO-FACTURA] Presupuesto encontrado: ${presupuesto.id_presupuesto_ext}`);

        // Obtener cliente
        const clienteQuery = `
            SELECT * FROM clientes
            WHERE cliente_id = $1
        `;
        const clienteResult = await pool.query(clienteQuery, [presupuesto.id_cliente]);

        if (clienteResult.rows.length === 0) {
            throw new Error(`Cliente ${presupuesto.id_cliente} no encontrado`);
        }

        const cliente = clienteResult.rows[0];
        console.log(`✅ [PRESUPUESTO-FACTURA] Cliente encontrado: ${cliente.nombre || 'Sin nombre'}`);

        // Obtener detalles con nombre del artículo
        const detallesQuery = `
            SELECT 
                pd.*,
                COALESCE(a.nombre, pd.articulo) as descripcion_articulo
            FROM presupuestos_detalles pd
            LEFT JOIN articulos a ON a.codigo_barras = pd.articulo
            WHERE pd.id_presupuesto = $1
            ORDER BY pd.id
        `;
        const detallesResult = await pool.query(detallesQuery, [presupuestoId]);

        const detalles = detallesResult.rows;
        console.log(`✅ [PRESUPUESTO-FACTURA] ${detalles.length} items encontrados`);

        if (detalles.length === 0) {
            throw new Error('El presupuesto no tiene items');
        }

        return {
            presupuesto,
            cliente,
            detalles
        };

    } catch (error) {
        console.error(`❌ [PRESUPUESTO-FACTURA] Error obteniendo datos:`, error.message);
        throw error;
    }
}

/**
 * Determinar tipo de comprobante según condición IVA
 */
function determinarTipoComprobante(condicionIva) {
    const tipo = MAPEO_TIPO_CBTE[condicionIva] || 6; // Default: Factura B
    console.log(`📋 [PRESUPUESTO-FACTURA] Condición IVA "${condicionIva}" → Tipo Cbte: ${tipo}`);
    return tipo;
}

/**
 * Determinar código de condición IVA para AFIP
 */
function determinarCondicionIvaAfip(condicionIva) {
    const codigo = MAPEO_CONDICION_IVA[condicionIva] || 5; // Default: Consumidor Final
    console.log(`📋 [PRESUPUESTO-FACTURA] Condición IVA "${condicionIva}" → Código AFIP: ${codigo}`);
    return codigo;
}

/**
 * Determinar tipo y número de documento
 */
function determinarDocumento(cliente) {
    console.log(`🔍 [PRESUPUESTO-FACTURA] Determinando documento para cliente:`, {
        cliente_id: cliente.cliente_id,
        nombre: cliente.nombre,
        condicion_iva: cliente.condicion_iva,
        cuit: cliente.cuit,
        dni: cliente.dni
    });

    // Prioridad: CUIT > CUIL > DNI > Consumidor Final
    let docTipo = 99; // Default: Consumidor Final
    let docNro = '0';
    let motivo = 'Cliente sin documento válido';

    // 1. Si tiene CUIT (Responsable Inscripto, Monotributo, Exento)
    if (cliente.cuit && cliente.cuit.trim()) {
        const cuitLimpio = cliente.cuit.replace(/[-\s]/g, '');
        if (cuitLimpio.length === 11 && /^\d+$/.test(cuitLimpio)) {
            docTipo = 80; // CUIT
            docNro = cuitLimpio;
            motivo = 'CUIT válido encontrado';
        }
    }

    // 2. Si tiene CUIL (menos común, pero posible)
    if (docTipo === 99 && cliente.cuil && cliente.cuil.trim()) {
        const cuilLimpio = cliente.cuil.replace(/[-\s]/g, '');
        if (cuilLimpio.length === 11 && /^\d+$/.test(cuilLimpio)) {
            docTipo = 86; // CUIL
            docNro = cuilLimpio;
            motivo = 'CUIL válido encontrado';
        }
    }

    // 3. Si tiene DNI (No Responsable)
    if (docTipo === 99 && cliente.dni && cliente.dni.trim()) {
        const dniLimpio = cliente.dni.replace(/[-\s]/g, '');
        if (dniLimpio.length >= 7 && dniLimpio.length <= 8 && /^\d+$/.test(dniLimpio)) {
            docTipo = 96; // DNI
            docNro = dniLimpio;
            motivo = 'DNI válido encontrado';
        }
    }

    // 4. Solo usar 99 si realmente no hay documento
    if (docTipo === 99) {
        motivo = 'Cliente sin CUIT/CUIL/DNI válido - Consumidor Final';
    }

    console.log(`📋 [PRESUPUESTO-FACTURA] Documento determinado: Tipo ${docTipo}, Nro "${docNro}", Motivo: ${motivo}`);

    return { docTipo, docNro };
}

/**
 * Mapear alícuota de IVA usando helper centralizado
 */
function mapearAlicuotaIva(ivaPresupuesto) {
    // Convertir a número
    const ivaNum = parseFloat(ivaPresupuesto) || 0;

    // Usar helper centralizado para obtener código AFIP correcto
    const alicuotaId = porcentajeToCodigoAfip(ivaNum);

    console.log(`📋 [PRESUPUESTO-FACTURA] IVA ${ivaNum}% → Código AFIP: ${alicuotaId}`);

    return alicuotaId;
}

/**
 * Mapear cabecera de factura con todos los campos obligatorios para AFIP
 */
function mapearCabecera(presupuesto, cliente) {
    console.log(`📋 [PRESUPUESTO-FACTURA] Mapeando cabecera...`);

    const condicionIva = cliente.condicion_iva || 'Consumidor Final';
    const tipoCbte = determinarTipoComprobante(condicionIva);
    const condicionIvaId = determinarCondicionIvaAfip(condicionIva);
    const { docTipo, docNro } = determinarDocumento(cliente);

    // Validar datos obligatorios del receptor
    if (!docTipo || !docNro || docNro === '0') {
        throw new Error(`Cliente sin documento válido. CUIT/CUIL/DNI requerido para facturación AFIP`);
    }

    if (!condicionIvaId) {
        throw new Error(`Condición IVA inválida para el cliente`);
    }

    // Construir razón social desde nombre y apellido
    let razonSocial = '';
    if (cliente.nombre && cliente.apellido) {
        razonSocial = `${cliente.nombre} ${cliente.apellido}`.trim();
    } else if (cliente.apellido) {
        razonSocial = cliente.apellido.trim();
    } else if (cliente.nombre) {
        razonSocial = cliente.nombre.trim();
    } else if (cliente.otros) {
        razonSocial = cliente.otros.trim();
    } else {
        razonSocial = 'Cliente';
    }

    console.log(`📋 [PRESUPUESTO-FACTURA] Razón social construida: "${razonSocial}"`);

    // Concepto: 1=Productos (default para presupuestos)
    const concepto = 1;

    // Fecha de emisión válida (formato YYYY-MM-DD)
    const fechaEmision = fechaActual();

    // Fechas de servicio: solo si concepto es 2 o 3
    let fchServDesde = null;
    let fchServHasta = null;
    let fchVtoPago = null;

    if (concepto === 2 || concepto === 3) {
        // Si es servicio, calcular fechas válidas
        const hoy = new Date();
        fchServDesde = fechaActual(); // Inicio del mes actual
        fchServHasta = fechaActual(); // Fin del mes actual
        fchVtoPago = fechaActual(); // Mismo día de emisión por defecto

        console.log(`📅 [PRESUPUESTO-FACTURA] Fechas de servicio: ${fchServDesde} al ${fchServHasta}, Vto pago: ${fchVtoPago}`);
    }

    const cabecera = {
        tipo_cbte: tipoCbte,
        pto_vta: PTO_VTA,
        concepto: concepto,
        fecha_emision: fechaEmision,
        cliente_id: parseInt(cliente.cliente_id) || null,
        doc_tipo: docTipo,
        doc_nro: docNro,
        condicion_iva_id: condicionIvaId,
        moneda: 'PES',
        mon_cotiz: 1.0000, // Siempre 1 para pesos
        requiere_afip: true,
        presupuesto_id: presupuesto.id,
        estado: 'BORRADOR',
        fch_serv_desde: fchServDesde,
        fch_serv_hasta: fchServHasta,
        fch_vto_pago: fchVtoPago
    };

    console.log(`✅ [PRESUPUESTO-FACTURA] Cabecera mapeada`);
    console.log(`   - Tipo Cbte: ${tipoCbte}, PV: ${PTO_VTA}, Concepto: ${concepto}`);
    console.log(`   - Doc: Tipo ${docTipo}, Nro "${docNro}"`);
    console.log(`   - Moneda: ${cabecera.moneda}, Cotiz: ${cabecera.mon_cotiz}`);

    return cabecera;
}

/**
 * Mapear items de factura con descuento aplicado
 * @param {Array} detalles - Detalles del presupuesto
 * @param {number} descuentoFraccional - Descuento como fracción (ej. 0.05 = 5%)
 */
function mapearItems(detalles, descuentoFraccional = 0) {
    console.log(`📋 [PRESUPUESTO-FACTURA] Mapeando ${detalles.length} items...`);
    console.log(`   Descuento a aplicar: ${(descuentoFraccional * 100).toFixed(2)}%`);

    const items = detalles.map((detalle, index) => {
        const qty = parseFloat(detalle.cantidad) || 0;
        const pUnit = parseFloat(detalle.valor1) || 0; // valor1 = precio sin IVA
        const ivaFactor = parseFloat(detalle.camp2) || 0; // camp2 = factor IVA (0.210, 0.105, 0.000)

        // Convertir factor a porcentaje para mapeo (0.210 → 21.00)
        const ivaPorcentaje = ivaFactor * 100;
        const alicIvaId = mapearAlicuotaIva(ivaPorcentaje);

        // Calcular base sin descuento
        const baseImponibleSinDescuento = qty * pUnit;

        // Aplicar descuento sobre la base imponible (ANTES del IVA)
        const impNeto = Math.round(baseImponibleSinDescuento * (1 - descuentoFraccional) * 100) / 100;

        // Calcular IVA sobre el neto ya con descuento
        const impIva = calcularIva(impNeto, alicIvaId);

        console.log(`   Item ${index + 1}: Base=${baseImponibleSinDescuento.toFixed(2)}, Desc=${(descuentoFraccional * 100).toFixed(1)}%, Neto=${impNeto.toFixed(2)}, IVA=${impIva.toFixed(2)}`);

        return {
            descripcion: detalle.descripcion_articulo || detalle.articulo || 'Sin descripción',
            qty: qty,
            p_unit: pUnit, // Guardamos el precio unitario SIN descuento (el descuento se aplica al total)
            alic_iva_id: alicIvaId,
            imp_neto: impNeto,
            imp_iva: impIva,
            orden: index + 1
        };
    });

    console.log(`✅ [PRESUPUESTO-FACTURA] ${items.length} items mapeados con descuento aplicado`);

    return items;
}

/**
 * Calcular totales de la factura
 */
function calcularTotales(items) {
    console.log(`🧮 [PRESUPUESTO-FACTURA] Calculando totales...`);

    const impNeto = items.reduce((sum, item) => sum + item.imp_neto, 0);
    const impIva = items.reduce((sum, item) => sum + item.imp_iva, 0);
    const impTrib = 0; // Por ahora sin tributos
    const impTotal = impNeto + impIva + impTrib;

    console.log(`✅ [PRESUPUESTO-FACTURA] Totales: Neto=${impNeto.toFixed(2)}, IVA=${impIva.toFixed(2)}, Total=${impTotal.toFixed(2)}`);

    return {
        imp_neto: impNeto,
        imp_iva: impIva,
        imp_trib: impTrib,
        imp_total: impTotal
    };
}

/**
 * Facturar presupuesto (crear factura lista para CAE)
 */
async function facturarPresupuesto(presupuestoId) {
    console.log(`🔄 [PRESUPUESTO-FACTURA] Iniciando facturación del presupuesto ${presupuestoId}...`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        console.log('🔄 [PRESUPUESTO-FACTURA] Transacción iniciada');

        // 1. Obtener datos del presupuesto
        const { presupuesto, cliente, detalles } = await obtenerDatosPresupuesto(presupuestoId);

        // 2. Verificar si ya existe factura para este presupuesto
        const existeQuery = `
            SELECT id FROM factura_facturas
            WHERE presupuesto_id = $1
        `;
        const existeResult = await client.query(existeQuery, [presupuestoId]);

        if (existeResult.rows.length > 0) {
            throw new Error(`Ya existe una factura para el presupuesto ${presupuestoId} (ID: ${existeResult.rows[0].id})`);
        }

        // 3. Mapear cabecera (valida datos obligatorios)
        const cabecera = mapearCabecera(presupuesto, cliente);

        // 4. Obtener descuento del presupuesto (fracción decimal, ej. 0.05 = 5%)
        const descuentoFraccional = parseFloat(presupuesto.descuento) || 0;
        console.log(`💰 [PRESUPUESTO-FACTURA] Descuento del presupuesto: ${(descuentoFraccional * 100).toFixed(2)}%`);

        // 5. Mapear items aplicando el descuento
        const items = mapearItems(detalles, descuentoFraccional);

        // 6. Calcular totales
        const totales = calcularTotales(items);

        // 7. Validar totales coherentes
        if (totales.imp_total <= 0) {
            throw new Error('El importe total debe ser mayor a cero');
        }

        if (Math.abs((totales.imp_neto + totales.imp_iva + totales.imp_trib) - totales.imp_total) > 0.01) {
            throw new Error('Los totales no son coherentes (neto + IVA + tributos != total)');
        }

        console.log(`💰 [PRESUPUESTO-FACTURA] Totales validados - Total: $${totales.imp_total.toFixed(2)}`);

        // 8. Insertar factura lista para CAE (SIN número todavía)
        console.log(`📝 [PRESUPUESTO-FACTURA] Creando factura BORRADOR (número se asignará al obtener CAE)...`);

        const insertFacturaQuery = `
            INSERT INTO factura_facturas (
                tipo_cbte, pto_vta, concepto, fecha_emision,
                cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                moneda, mon_cotiz, imp_neto, imp_iva, imp_trib, imp_total,
                requiere_afip, presupuesto_id, estado,
                fch_serv_desde, fch_serv_hasta, fch_vto_pago,
                descuento, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15,
                $16, $17, $18,
                $19, $20, $21,
                NOW(), NOW()
            ) RETURNING id
        `;

        const facturaResult = await client.query(insertFacturaQuery, [
            cabecera.tipo_cbte,        // $1
            cabecera.pto_vta,          // $2
            cabecera.concepto,         // $3
            cabecera.fecha_emision,    // $4
            cabecera.cliente_id,       // $5
            cabecera.doc_tipo,         // $6
            cabecera.doc_nro,          // $7
            cabecera.condicion_iva_id, // $8
            cabecera.moneda,           // $9
            cabecera.mon_cotiz,        // $10
            totales.imp_neto,          // $11
            totales.imp_iva,           // $12
            totales.imp_trib,          // $13
            totales.imp_total,         // $14
            cabecera.requiere_afip,    // $15
            cabecera.presupuesto_id,   // $16
            cabecera.estado,           // $17
            cabecera.fch_serv_desde,   // $18
            cabecera.fch_serv_hasta,   // $19
            cabecera.fch_vto_pago,     // $20
            descuentoFraccional        // $21
            // Total: 21 parámetros para 21 columnas
        ]);

        const facturaId = facturaResult.rows[0].id;
        console.log(`✅ [PRESUPUESTO-FACTURA] Factura BORRADOR creada con ID: ${facturaId}`);
        console.log(`   - Tipo/PV: ${cabecera.tipo_cbte}/${cabecera.pto_vta}`);
        console.log(`   - Número: Se asignará al obtener CAE`);
        console.log(`   - Total: $${totales.imp_total.toFixed(2)}`);

        // 9. Insertar items
        for (const item of items) {
            const insertItemQuery = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, qty, p_unit,
                    alic_iva_id, imp_neto, imp_iva, orden,
                    created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, NOW()
                )
            `;

            await client.query(insertItemQuery, [
                facturaId,
                item.descripcion,
                item.qty,
                item.p_unit,
                item.alic_iva_id,
                item.imp_neto,
                item.imp_iva,
                item.orden
            ]);
        }

        console.log(`✅ [PRESUPUESTO-FACTURA] ${items.length} items insertados`);

        // 10. VINCULAR BIDIRECCIONAL: Actualizar presupuesto con factura_id
        console.log(`🔗 [PRESUPUESTO-FACTURA] Actualizando presupuestos.factura_id = ${facturaId}...`);

        const updatePresupuestoQuery = `
            UPDATE presupuestos
            SET factura_id = $1
            WHERE id = $2
        `;

        await client.query(updatePresupuestoQuery, [facturaId, presupuestoId]);
        console.log(`✅ [PRESUPUESTO-FACTURA] Vinculación bidireccional completada`);
        console.log(`   - presupuestos.factura_id → ${facturaId}`);
        console.log(`   - factura_facturas.presupuesto_id → ${presupuestoId}`);

        await client.query('COMMIT');
        console.log('✅ [PRESUPUESTO-FACTURA] Transacción confirmada');
        console.log('🎯 [PRESUPUESTO-FACTURA] Factura BORRADOR lista para solicitar CAE');
        console.log('💡 [PRESUPUESTO-FACTURA] El número se asignará automáticamente al obtener CAE');

        return {
            facturaId,
            presupuestoId,
            ptoVta: cabecera.pto_vta,
            tipoCbte: cabecera.tipo_cbte,
            totales,
            itemsCount: items.length
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ [PRESUPUESTO-FACTURA] Error en facturación:`, error.message);
        console.error(`❌ [PRESUPUESTO-FACTURA] Stack:`, error.stack);
        throw error;
    } finally {
        client.release();
        console.log('🔓 [PRESUPUESTO-FACTURA] Cliente liberado');
    }
}

/**
 * Sincronizar un borrador existente con su presupuesto original
 */
async function sincronizarBorrador(presupuestoId) {
    console.log(`🔄 [PRESUPUESTO-FACTURA] Iniciando sincronización de borrador para presupuesto ${presupuestoId}...`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        console.log('🔄 [PRESUPUESTO-FACTURA] Transacción de sincronización iniciada');

        // 1. Obtener datos actuales del presupuesto
        const { presupuesto, cliente, detalles } = await obtenerDatosPresupuesto(presupuestoId);

        // 2. Verificar si existe factura borrador para este presupuesto
        const existeQuery = `
            SELECT id, estado FROM factura_facturas
            WHERE presupuesto_id = $1
            ORDER BY id DESC LIMIT 1
        `;
        const existeResult = await client.query(existeQuery, [presupuestoId]);

        if (existeResult.rows.length === 0) {
            throw new Error(`No se encontró ninguna factura para el presupuesto ${presupuestoId}`);
        }

        const factura = existeResult.rows[0];

        if (factura.estado !== 'BORRADOR') {
            throw new Error(`La factura ${factura.id} no está en estado BORRADOR (estado actual: ${factura.estado}). No se puede sincronizar.`);
        }

        const facturaId = factura.id;
        console.log(`✅ [PRESUPUESTO-FACTURA] Factura BORRADOR encontrada: ${facturaId}`);

        // 3. Mapear nueva cabecera (valida datos obligatorios)
        const cabecera = mapearCabecera(presupuesto, cliente);

        // 4. Obtener descuento del presupuesto
        const descuentoFraccional = parseFloat(presupuesto.descuento) || 0;
        console.log(`💰 [PRESUPUESTO-FACTURA] Descuento a aplicar en sincronización: ${(descuentoFraccional * 100).toFixed(2)}%`);

        // 5. Mapear nuevos items aplicando el descuento
        const items = mapearItems(detalles, descuentoFraccional);

        // 6. Calcular nuevos totales
        const totales = calcularTotales(items);

        // 7. Validar totales coherentes
        if (totales.imp_total <= 0) {
            throw new Error('El importe total debe ser mayor a cero');
        }

        if (Math.abs((totales.imp_neto + totales.imp_iva + totales.imp_trib) - totales.imp_total) > 0.01) {
            throw new Error('Los totales no son coherentes (neto + IVA + tributos != total)');
        }

        console.log(`💰 [PRESUPUESTO-FACTURA] Totales recalculados validados - Total: $${totales.imp_total.toFixed(2)}`);

        // 8. Actualizar Factura (Cabecera)
        console.log(`📝 [PRESUPUESTO-FACTURA] Actualizando factura BORRADOR...`);

        const updateFacturaQuery = `
            UPDATE factura_facturas SET 
                tipo_cbte = $1, pto_vta = $2, concepto = $3, fecha_emision = $4,
                cliente_id = $5, doc_tipo = $6, doc_nro = $7, condicion_iva_id = $8,
                imp_neto = $9, imp_iva = $10, imp_trib = $11, imp_total = $12,
                requiere_afip = $13,
                fch_serv_desde = $14, fch_serv_hasta = $15, fch_vto_pago = $16,
                descuento = $17, updated_at = NOW()
            WHERE id = $18
        `;

        await client.query(updateFacturaQuery, [
            cabecera.tipo_cbte,        // $1
            cabecera.pto_vta,          // $2
            cabecera.concepto,         // $3
            cabecera.fecha_emision,    // $4
            cabecera.cliente_id,       // $5
            cabecera.doc_tipo,         // $6
            cabecera.doc_nro,          // $7
            cabecera.condicion_iva_id, // $8
            totales.imp_neto,          // $9
            totales.imp_iva,           // $10
            totales.imp_trib,          // $11
            totales.imp_total,         // $12
            cabecera.requiere_afip,    // $13
            cabecera.fch_serv_desde,   // $14
            cabecera.fch_serv_hasta,   // $15
            cabecera.fch_vto_pago,     // $16
            descuentoFraccional,       // $17
            facturaId                  // $18
        ]);

        console.log(`✅ [PRESUPUESTO-FACTURA] Cabecera de borrador actualizada.`);

        // 9. Recrear items (Borrar y volver a insertar)
        console.log(`📝 [PRESUPUESTO-FACTURA] Recreando items del borrador...`);

        await client.query(`DELETE FROM factura_factura_items WHERE factura_id = $1`, [facturaId]);

        for (const item of items) {
            const insertItemQuery = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, qty, p_unit,
                    alic_iva_id, imp_neto, imp_iva, orden,
                    created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, NOW()
                )
            `;

            await client.query(insertItemQuery, [
                facturaId,
                item.descripcion,
                item.qty,
                item.p_unit,
                item.alic_iva_id,
                item.imp_neto,
                item.imp_iva,
                item.orden
            ]);
        }

        console.log(`✅ [PRESUPUESTO-FACTURA] ${items.length} items reemplazados`);

        await client.query('COMMIT');
        console.log('✅ [PRESUPUESTO-FACTURA] Sincronización de borrador confirmada');

        return {
            facturaId,
            presupuestoId,
            totales,
            itemsCount: items.length
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ [PRESUPUESTO-FACTURA] Error en sincronización:`, error.message);
        console.error(`❌ [PRESUPUESTO-FACTURA] Stack:`, error.stack);
        throw error;
    } finally {
        client.release();
    }
}

console.log('✅ [PRESUPUESTO-FACTURA] Servicio de conversión cargado');

module.exports = {
    facturarPresupuesto,
    sincronizarBorrador,
    obtenerDatosPresupuesto,
    mapearCabecera,
    mapearItems,
    calcularTotales,
    determinarTipoComprobante,
    determinarDocumento
};
