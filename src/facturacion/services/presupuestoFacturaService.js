/**
 * Servicio de Conversión: Presupuesto → Factura BORRADOR
 * Mapea datos de presupuestos a facturas listas para AFIP
 */

const { pool } = require('../config/database');
const { fechaActual } = require('../config/timezone');
const { porcentajeToCodigoAfip, calcularIva } = require('../utils/iva-helper');
const { PTO_VTA } = require('../config/afip');
const { calcularCostoIntegradoArticulo } = require('./costoIntegradoService');

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

        // Obtener cliente (priorizando datos fiscales de bunker_clientes)
        const clienteQuery = `
            SELECT 
                c.id,
                c.cliente_id,
                c.lista_precios,
                c.zona,
                c.vendedor,
                c.telefono,
                c.telefono_2,
                c.celular,
                c.email,
                c.limite_cta,
                c.nacimiento,
                c.pais,
                c.dni,
                c.created_at,
                c.updated_at,
                c.modalidad_default,
                c.dia_preferido_reparto,
                CASE 
                    WHEN bc.id IS NOT NULL THEN NULL 
                    ELSE c.nombre 
                END as nombre,
                COALESCE(bc.razon_social, bc.cliente_nombre, c.apellido) as apellido,
                COALESCE(bc.cuit_cuil, c.cuit) as cuit,
                COALESCE(bc.condicion_iva, c.condicion_iva) as condicion_iva,
                COALESCE(bc.domicilio_fiscal, c.domicilio) as domicilio,
                COALESCE(bc.provincia, c.provincia) as provincia
            FROM clientes c
            LEFT JOIN bunker_clientes bc ON 
                (CASE 
                    WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer 
                    ELSE NULL 
                END) = c.cliente_id
            WHERE c.cliente_id = $1
        `;
        const clienteResult = await pool.query(clienteQuery, [presupuesto.id_cliente]);

        if (clienteResult.rows.length === 0) {
            throw new Error(`Cliente ${presupuesto.id_cliente} no encontrado`);
        }

        const cliente = clienteResult.rows[0];
        console.log(`✅ [PRESUPUESTO-FACTURA] Cliente encontrado: ${cliente.apellido || cliente.nombre || 'Sin nombre'}`);

        // Obtener detalles con nombre del artículo (incluyendo ingredientes de kit y costo base)
        const detallesQuery = `
            SELECT 
                pd.*,
                COALESCE(
                    NULLIF(TRIM(ba.descripcion_generada), ''),
                    NULLIF(TRIM(ba.descripcion), ''),
                    NULLIF(TRIM(a.nombre), ''),
                    NULLIF(TRIM(ing.nombre), ''),
                    pd.articulo
                ) as descripcion_articulo,
                CASE WHEN ing.id IS NOT NULL THEN true ELSE false END as es_ingrediente,
                COALESCE(ba.costo_base, ing.costo_patron, 0) as costo_unitario_base
            FROM presupuestos_detalles pd
            LEFT JOIN public.ingredientes ing ON (ing.id::text = pd.articulo OR ing.codigo::text = pd.articulo)
            LEFT JOIN public.articulos a ON (a.numero = pd.articulo OR a.codigo_barras = pd.articulo)
            LEFT JOIN public.bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
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
function mapearCabecera(presupuesto, cliente, requiereAfip = true) {
    console.log(`📋 [PRESUPUESTO-FACTURA] Mapeando cabecera...`);

    const condicionIva = cliente.condicion_iva || 'Consumidor Final';
    let tipoCbte = determinarTipoComprobante(condicionIva);

    // Si el presupuesto es una Orden de Retiro, mapeamos a Nota de Crédito
    const esRetiro = presupuesto && (presupuesto.tipo_comprobante === 'Orden de Retiro' || presupuesto.estado === 'Orden de Retiro' || presupuesto.estado === 'Administrativa NC');
    if (esRetiro) {
        if (tipoCbte === 1) tipoCbte = 3;      // Factura A -> NC A
        else if (tipoCbte === 6) tipoCbte = 8; // Factura B -> NC B
        else if (tipoCbte === 11) tipoCbte = 13; // Factura C -> NC C
        console.log(`📋 [PRESUPUESTO-FACTURA] Presupuesto es Orden de Retiro. Convertido a Nota de Crédito tipo: ${tipoCbte}`);
    }

    const condicionIvaId = determinarCondicionIvaAfip(condicionIva);
    let { docTipo, docNro } = determinarDocumento(cliente);

    // Si no requiere AFIP, flexibilizar o dar fallbacks seguros
    if (!requiereAfip) {
        if (!docTipo || !docNro || docNro === '0') {
            docTipo = 99; // Consumidor Final
            docNro = '0';
        }
    } else {
        // Validar datos obligatorios del receptor
        if (!docTipo || !docNro || docNro === '0') {
            throw new Error(`Cliente sin documento válido. CUIT/CUIL/DNI requerido para facturación AFIP`);
        }

        if (!condicionIvaId) {
            throw new Error(`Condición IVA inválida para el cliente`);
        }
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
    let fechaEmision = fechaActual();
    if (presupuesto && (presupuesto.tipo_comprobante === 'Orden de Retiro' || presupuesto.estado === 'Orden de Retiro' || presupuesto.estado === 'Administrativa NC') && presupuesto.fecha) {
        const dateObj = new Date(presupuesto.fecha);
        if (!isNaN(dateObj.getTime())) {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            fechaEmision = `${year}-${month}-${day}`;
        }
    }

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
        requiere_afip: requiereAfip,
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
 * Mapear items de factura con descuento aplicado y cálculo de costo integrado Búnker
 * @param {object} db - Cliente o Pool de PostgreSQL
 * @param {Array} detalles - Detalles del presupuesto
 * @param {number} descuentoFraccional - Descuento como fracción (ej. 0.05 = 5%)
 * @param {number} clienteListaId - Lista de precios del cliente (default 1)
 */
async function mapearItems(db, detalles, descuentoFraccional = 0, clienteListaId = 1) {
    console.log(`📋 [PRESUPUESTO-FACTURA] Mapeando ${detalles.length} items (Lista Precios: ${clienteListaId})...`);
    console.log(`   Descuento a aplicar: ${(descuentoFraccional * 100).toFixed(2)}%`);

    const items = [];
    for (let index = 0; index < detalles.length; index++) {
        const detalle = detalles[index];
        const qty = parseFloat(detalle.cantidad) || 0;
        const pUnit = parseFloat(detalle.valor1) || 0; // valor1 = precio sin IVA
        const ivaFactor = parseFloat(detalle.camp2) || 0; // camp2 = factor IVA (0.210, 0.105, 0.000)

        // Convertir factor a porcentaje para mapeo (0.210 → 21.00)
        const ivaPorcentaje = ivaFactor * 100;
        const alicIvaId = mapearAlicuotaIva(ivaPorcentaje);

        // Calcular base sin descuento
        const baseImponibleSinDescuento = qty * pUnit;

        // Descuento adicional por línea (aditivo al descuento general)
        const descExtra = parseFloat(detalle.descuento_adicional) || 0;
        const descTotalFraccional = Math.min(1, ((descuentoFraccional * 100) + descExtra) / 100);

        // Aplicar descuento total aditivo sobre la base imponible (ANTES del IVA)
        const impNeto = Math.round(baseImponibleSinDescuento * (1 - descTotalFraccional) * 100) / 100;

        // Calcular IVA sobre el neto ya con descuento
        const impIva = calcularIva(impNeto, alicIvaId);

        let descLimpia = detalle.descripcion_articulo || detalle.articulo || 'Sin descripción';
        if (detalle.es_ingrediente) {
            descLimpia = `↳ (Stock Cliente) ${descLimpia}`;
        }
        if (descExtra > 0) {
            descLimpia = `${descLimpia} (Desc. esp. ${descExtra}%)`;
        }

        // Calcular costo integrado unitario real del Búnker
        // Calcular costo integrado unitario real del Búnker con desglose completo
        let costoUnit = 0;
        let cMercaderiaUnit = 0;
        let cManoObraUnit = 0;
        let cInsumosUnit = 0;
        let artIdResuelto = detalle.articulo ? String(detalle.articulo).trim() : null;

        try {
            const resCosto = await calcularCostoIntegradoArticulo(db, detalle.articulo, clienteListaId);
            costoUnit = resCosto.costo_unitario;
            cMercaderiaUnit = resCosto.c_presentacion;
            cManoObraUnit = resCosto.c_tiempo;
            cInsumosUnit = resCosto.c_insumos;
            if (resCosto.articulo_id) {
                artIdResuelto = String(resCosto.articulo_id).trim();
            }
        } catch (errCosto) {
            console.error(`⚠️ [PRESUPUESTO-FACTURA] Error calculando costo integrado para item ${detalle.articulo}:`, errCosto.message);
            costoUnit = parseFloat(detalle.costo_unitario_base) || 0;
            cMercaderiaUnit = costoUnit;
        }

        const costoTot = Math.round(qty * costoUnit * 100) / 100;
        const cMercaderiaTot = Math.round(qty * cMercaderiaUnit * 100) / 100;
        const cManoObraTot = Math.round(qty * cManoObraUnit * 100) / 100;
        const cInsumosTot = Math.round(qty * cInsumosUnit * 100) / 100;

        console.log(`   Item ${index + 1}: Base=${baseImponibleSinDescuento.toFixed(2)}, Neto=${impNeto.toFixed(2)}, CostoUnit=$${costoUnit.toFixed(2)} (Merc=$${cMercaderiaUnit.toFixed(2)}, MO=$${cManoObraUnit.toFixed(2)}, Ins=$${cInsumosUnit.toFixed(2)})`);

        items.push({
            descripcion: descLimpia,
            articulo_id: artIdResuelto,
            qty: qty,
            p_unit: pUnit, // Guardamos el precio unitario SIN descuento (el descuento se aplica al total)
            alic_iva_id: alicIvaId,
            imp_neto: impNeto,
            imp_iva: impIva,
            costo_unitario: costoUnit,
            costo_total: costoTot,
            costo_mercaderia_unitario: cMercaderiaUnit,
            costo_mano_obra_unitario: cManoObraUnit,
            costo_insumos_unitario: cInsumosUnit,
            costo_mercaderia_total: cMercaderiaTot,
            costo_mano_obra_total: cManoObraTot,
            costo_insumos_total: cInsumosTot,
            es_saldo_ingrediente: detalle.es_saldo_ingrediente === true,
            ingrediente_id_saldo: detalle.ingrediente_id_saldo || null,
            kilos_saldo: detalle.kilos_saldo || null,
            orden: index + 1
        });
    }

    console.log(`✅ [PRESUPUESTO-FACTURA] ${items.length} items mapeados con foto de costo integrado y descuento aplicado`);

    return items;
}

/**
 * Calcular totales de la factura congelando la foto contable (unificada con Presupuestos y Artículos Búnker)
 */
function calcularTotales(items, alicuotaIibb = 4.00) {
    console.log(`🧮 [PRESUPUESTO-FACTURA] Calculando totales y foto contable...`);

    const impNeto = items.reduce((sum, item) => sum + item.imp_neto, 0);
    const impIva = items.reduce((sum, item) => sum + item.imp_iva, 0);
    const costoEstimadoTotal = items.reduce((sum, item) => sum + (item.costo_total || 0), 0);
    const costoMercaderiaTotal = items.reduce((sum, item) => sum + (item.costo_mercaderia_total || 0), 0);
    const costoManoObraTotal = items.reduce((sum, item) => sum + (item.costo_mano_obra_total || 0), 0);
    const costoInsumosTotal = items.reduce((sum, item) => sum + (item.costo_insumos_total || 0), 0);
    const impTrib = 0; // Por ahora sin otros tributos
    const impTotal = impNeto + impIva + impTrib;

    const alicIibb = parseFloat(alicuotaIibb) || 4.00;
    const impIibb = Math.round(impTotal * (alicIibb / 100) * 100) / 100;

    // Diferencia de IVA línea por línea: Máx(0, IVA Venta - IVA Compra al 21% sobre Costo Bulto s/Mano de Obra)
    const impDifIvaRaw = items.reduce((sum, item) => {
        const ivaVentaItem = parseFloat(item.imp_iva) || 0;
        const costoBultoItem = (parseFloat(item.costo_mercaderia_total) || 0) + (parseFloat(item.costo_insumos_total) || 0);
        const ivaCompraItem = costoBultoItem * 0.21;
        return sum + Math.max(0, ivaVentaItem - ivaCompraItem);
    }, 0);
    const impDifIva = Math.round(impDifIvaRaw * 100) / 100;

    // Ganancia s/IIBB (Neto - Costo Operativo - IIBB)
    const gananciaSinIibbTotal = Math.round((impNeto - costoEstimadoTotal - impIibb) * 100) / 100;
    // Ganancia Real unificada con Presupuestos, Pizarra y Artículos Búnker (descontando Diferencia de IVA)
    const gananciaRealTotal = Math.round((gananciaSinIibbTotal - impDifIva) * 100) / 100;

    console.log(`✅ [PRESUPUESTO-FACTURA] Foto Contable: Neto=${impNeto.toFixed(2)}, IVA=${impIva.toFixed(2)}, Total=${impTotal.toFixed(2)} | Merc=${costoMercaderiaTotal.toFixed(2)}, MO=${costoManoObraTotal.toFixed(2)}, Ins=${costoInsumosTotal.toFixed(2)}, IIBB(${alicIibb}%)=${impIibb.toFixed(2)}, DifIVA=${impDifIva.toFixed(2)}, Ganancia s/IIBB=${gananciaSinIibbTotal.toFixed(2)}, Ganancia Real=${gananciaRealTotal.toFixed(2)}`);

    return {
        imp_neto: impNeto,
        imp_iva: impIva,
        imp_trib: impTrib,
        imp_total: impTotal,
        costo_estimado_total: costoEstimadoTotal,
        costo_mercaderia_total: costoMercaderiaTotal,
        costo_mano_obra_total: costoManoObraTotal,
        costo_insumos_total: costoInsumosTotal,
        alicuota_iibb: alicIibb,
        imp_iibb: impIibb,
        imp_dif_iva: impDifIva,
        ganancia_sin_iibb_total: gananciaSinIibbTotal,
        ganancia_real_total: gananciaRealTotal
    };
}

/**
 * Facturar presupuesto (crear factura lista para CAE o local)
 */
async function facturarPresupuesto(presupuestoId, ptoVta = null, requiereAfip = null) {
    console.log(`🔄 [PRESUPUESTO-FACTURA] Iniciando facturación del presupuesto ${presupuestoId}...`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        console.log('🔄 [PRESUPUESTO-FACTURA] Transacción iniciada');

        // 1. Obtener datos del presupuesto
        const { presupuesto, cliente, detalles } = await obtenerDatosPresupuesto(presupuestoId);

        // 2. Verificar si ya existe factura activa para este presupuesto (ignorando anuladas y notas de crédito)
        const existeQuery = `
            SELECT id FROM factura_facturas
            WHERE presupuesto_id = $1
              AND estado NOT IN ('ANULADA', 'RECHAZADA')
              AND tipo_cbte NOT IN (3, 8, 13)
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
        `;
        const existeResult = await client.query(existeQuery, [presupuestoId]);

        if (existeResult.rows.length > 0) {
            throw new Error(`Ya existe una factura activa para el presupuesto ${presupuestoId} (ID: ${existeResult.rows[0].id})`);
        }

        // 3. Mapear cabecera (valida datos obligatorios si requiereAfip es true)
        const cabecera = mapearCabecera(presupuesto, cliente, requiereAfip !== false);

        if (ptoVta !== null) {
            cabecera.pto_vta = ptoVta;
        }
        if (requiereAfip !== null) {
            cabecera.requiere_afip = requiereAfip;
        }

        // 4. Obtener descuento del presupuesto (fracción decimal, ej. 0.05 = 5%)
        const rawDesc = parseFloat(presupuesto.descuento) || 0;
        const descuentoFraccional = rawDesc > 1 ? rawDesc / 100 : rawDesc;
        console.log(`💰 [PRESUPUESTO-FACTURA] Descuento del presupuesto: ${(descuentoFraccional * 100).toFixed(2)}%`);

        // 5. Mapear items aplicando el descuento y calculando costo integrado Búnker
        const clienteListaId = cliente.lista_precios ? parseInt(cliente.lista_precios) : 1;
        const items = await mapearItems(client, detalles, descuentoFraccional, clienteListaId);

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

        // 8. Trazabilidad: Buscar Factura Asociada si es una Orden de Retiro
        let facturaAsociadaId = null;
        const esRetiro = presupuesto && (presupuesto.tipo_comprobante === 'Orden de Retiro' || presupuesto.estado === 'Orden de Retiro' || presupuesto.estado === 'Administrativa NC');
        if (esRetiro && presupuesto.origen_numero_factura) {
            const origVal = presupuesto.origen_numero_factura.trim();
            if (/^\d+$/.test(origVal)) {
                const origBudgetId = parseInt(origVal);
                const origFactRes = await client.query(
                    `SELECT id FROM factura_facturas WHERE (presupuesto_id = $1 OR cbte_nro = $2) AND estado = 'APROBADA' LIMIT 1`,
                    [origBudgetId, origBudgetId]
                );
                if (origFactRes.rows.length > 0) {
                    facturaAsociadaId = origFactRes.rows[0].id;
                    console.log(`📋 [PRESUPUESTO-FACTURA] Factura asociada encontrada por ID/Nro: ${facturaAsociadaId}`);
                }
            } else if (origVal.includes('-')) {
                const parts = origVal.split('-');
                const ptoVta = parseInt(parts[0]);
                const cbteNro = parseInt(parts[1]);
                if (!isNaN(ptoVta) && !isNaN(cbteNro)) {
                    const origFactRes = await client.query(
                        `SELECT id FROM factura_facturas WHERE pto_vta = $1 AND cbte_nro = $2 AND estado = 'APROBADA' LIMIT 1`,
                        [ptoVta, cbteNro]
                    );
                    if (origFactRes.rows.length > 0) {
                        facturaAsociadaId = origFactRes.rows[0].id;
                        console.log(`📋 [PRESUPUESTO-FACTURA] Factura asociada encontrada por PuntoVta-Numero: ${facturaAsociadaId}`);
                    }
                }
            }
        }

        // 8.5. Insertar factura lista para CAE (SIN número todavía)
        console.log(`📝 [PRESUPUESTO-FACTURA] Creando factura BORRADOR...`);

        const insertFacturaQuery = `
            INSERT INTO factura_facturas (
                tipo_cbte, pto_vta, concepto, fecha_emision,
                cliente_id, doc_tipo, doc_nro, condicion_iva_id,
                moneda, mon_cotiz, imp_neto, imp_iva, imp_trib, imp_total,
                requiere_afip, presupuesto_id, estado,
                fch_serv_desde, fch_serv_hasta, fch_vto_pago,
                descuento, factura_asociada_id, costo_estimado_total,
                alicuota_iibb, imp_iibb, imp_dif_iva, costo_mercaderia_total, costo_mano_obra_total,
                costo_insumos_total, ganancia_sin_iibb_total, ganancia_real_total, foto_capturada,
                created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15,
                $16, $17, $18,
                $19, $20, $21,
                $22, $23,
                $24, $25, $26, $27, $28,
                $29, $30, $31, $32,
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
            descuentoFraccional,       // $21
            facturaAsociadaId,         // $22
            totales.costo_estimado_total, // $23
            totales.alicuota_iibb,     // $24
            totales.imp_iibb,          // $25
            totales.imp_dif_iva,       // $26
            totales.costo_mercaderia_total, // $27
            totales.costo_mano_obra_total,  // $28
            totales.costo_insumos_total,    // $29
            totales.ganancia_sin_iibb_total,// $30
            totales.ganancia_real_total,    // $31
            true                       // $32 (foto_capturada)
        ]);

        const facturaId = facturaResult.rows[0].id;
        console.log(`✅ [PRESUPUESTO-FACTURA] Factura BORRADOR creada con ID: ${facturaId}`);
        console.log(`   - Tipo/PV: ${cabecera.tipo_cbte}/${cabecera.pto_vta}`);
        console.log(`   - Total: $${totales.imp_total.toFixed(2)}`);

        // 9. Insertar items
        for (const item of items) {
            const insertItemQuery = `
                INSERT INTO factura_factura_items (
                    factura_id, descripcion, qty, p_unit,
                    alic_iva_id, imp_neto, imp_iva, orden,
                    costo_unitario, costo_total,
                    articulo_id, costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                    costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                    es_saldo_ingrediente, ingrediente_id_saldo, kilos_saldo,
                    created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17,
                    $18, $19, $20,
                    NOW()
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
                item.orden,
                item.costo_unitario || 0,
                item.costo_total || 0,
                item.articulo_id || null,
                item.costo_mercaderia_unitario || 0,
                item.costo_mano_obra_unitario || 0,
                item.costo_insumos_unitario || 0,
                item.costo_mercaderia_total || 0,
                item.costo_mano_obra_total || 0,
                item.costo_insumos_total || 0,
                Boolean(item.es_saldo_ingrediente),
                item.ingrediente_id_saldo || null,
                item.kilos_saldo || null
            ]);
        }

        console.log(`✅ [PRESUPUESTO-FACTURA] ${items.length} items insertados`);

        // 10. VINCULAR BIDIRECCIONAL: Actualizar presupuesto con factura_id y estado correspondiente
        console.log(`🔗 [PRESUPUESTO-FACTURA] Actualizando presupuestos.factura_id = ${facturaId}...`);

        let updatePresupuestoQuery = '';
        let queryParams = [];

        // Para cualquier puesto (incluyendo 90), al crear el borrador solo marcamos "Enviado a Facturación"
        // El estado final de entrega del Puesto 90 se aplicará atómicamente al EMITIR la factura.
        updatePresupuestoQuery = `
            UPDATE presupuestos
            SET factura_id = $1, estado = 'Enviado a Facturación'
            WHERE id = $2
        `;
        queryParams = [facturaId, presupuestoId];

        await client.query(updatePresupuestoQuery, queryParams);
        console.log(`✅ [PRESUPUESTO-FACTURA] Vinculación bidireccional y actualización de estado completada`);

        await client.query('COMMIT');
        console.log('✅ [PRESUPUESTO-FACTURA] Transacción confirmada');

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

        // 2. Verificar si existe factura borrador activa para este presupuesto
        const existeQuery = `
            SELECT id, estado FROM factura_facturas
            WHERE presupuesto_id = $1 AND estado = 'BORRADOR'
            LIMIT 1
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
        const rawDesc = parseFloat(presupuesto.descuento) || 0;
        const descuentoFraccional = rawDesc > 1 ? rawDesc / 100 : rawDesc;
        console.log(`💰 [PRESUPUESTO-FACTURA] Descuento a aplicar en sincronización: ${(descuentoFraccional * 100).toFixed(2)}%`);

        // 5. Mapear nuevos items aplicando el descuento y calculando costo integrado Búnker
        const clienteListaId = cliente.lista_precios ? parseInt(cliente.lista_precios) : 1;
        const items = await mapearItems(client, detalles, descuentoFraccional, clienteListaId);

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
                descuento = $17, costo_estimado_total = $18,
                alicuota_iibb = $19, imp_iibb = $20, imp_dif_iva = $21, costo_mercaderia_total = $22,
                costo_mano_obra_total = $23, costo_insumos_total = $24,
                ganancia_sin_iibb_total = $25, ganancia_real_total = $26, foto_capturada = $27,
                updated_at = NOW()
            WHERE id = $28
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
            totales.costo_estimado_total, // $18
            totales.alicuota_iibb,     // $19
            totales.imp_iibb,          // $20
            totales.imp_dif_iva,       // $21
            totales.costo_mercaderia_total, // $22
            totales.costo_mano_obra_total,  // $23
            totales.costo_insumos_total,    // $24
            totales.ganancia_sin_iibb_total,// $25
            totales.ganancia_real_total,    // $26
            true,                      // $27
            facturaId                  // $28
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
                    costo_unitario, costo_total,
                    articulo_id, costo_mercaderia_unitario, costo_mano_obra_unitario, costo_insumos_unitario,
                    costo_mercaderia_total, costo_mano_obra_total, costo_insumos_total,
                    es_saldo_ingrediente, ingrediente_id_saldo, kilos_saldo,
                    created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17,
                    $18, $19, $20,
                    NOW()
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
                item.orden,
                item.costo_unitario || 0,
                item.costo_total || 0,
                item.articulo_id || null,
                item.costo_mercaderia_unitario || 0,
                item.costo_mano_obra_unitario || 0,
                item.costo_insumos_unitario || 0,
                item.costo_mercaderia_total || 0,
                item.costo_mano_obra_total || 0,
                item.costo_insumos_total || 0,
                Boolean(item.es_saldo_ingrediente),
                item.ingrediente_id_saldo || null,
                item.kilos_saldo || null
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
