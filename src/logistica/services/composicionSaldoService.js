/**
 * Servicio de Composición de Saldo y Envejecimiento FIFO (Factor Tiempo)
 * Módulo: Logística / Cuentas Corrientes Búnker
 * 
 * Determina con precisión matemática de centavos:
 * 1. Qué comprobantes componen la deuda activa del cliente.
 * 2. Qué monto y porcentaje permanece impago en cada uno.
 * 3. El "Punto Cero" de cada factura: día y hora exacta en que se entregó (reparto) o retiró (depósito).
 * 4. La antigüedad exacta (días y horas) y la clasificación comercial (para políticas de descuentos).
 */

const { pool } = require('../config/database');

/**
 * Resuelve el "Punto Cero" (marca de tiempo inicial real) para un movimiento de débito.
 * Jerarquía determinista:
 *  1. Confirmación de entrega por chofer / QR (entregas_eventos.fecha_entrega)
 *  2. Fecha de entrega real registrada en logística (presupuestos.fecha_entrega_real)
 *  3. Retiro por depósito central (presupuestos.fecha_actualizacion cuando estado_logistico = ENTREGADO_DEPOSITO)
 *  4. Emisión electrónica autorizada con hora (factura_facturas.emitida_en)
 *  5. Fecha de comprobante / movimiento (factura_cuenta_corriente_movimientos.fecha_movimiento)
 * 
 * @param {Object} m - Movimiento de cuenta corriente
 * @param {Object} db - Cliente o pool de PostgreSQL
 * @returns {Promise<Object>} Información de punto cero
 */
async function resolverPuntoCero(m, db = pool) {
  // Ajustes de apertura o movimientos sin comprobante formal
  if (!m.comprobante_id && !m.presupuesto_id) {
    return {
      punto_cero: new Date(m.fecha_movimiento),
      tipo_punto_cero: m.es_apertura ? 'APERTURA' : 'FECHA_MOVIMIENTO',
      canal_logistico: 'Administrativo',
      icono: '🔑',
      detalles: m.es_apertura ? 'Saldo Inicial de Cuenta' : 'Ajuste Interno'
    };
  }

  // 1. Obtener datos de la factura si existe
  let f = null;
  if (m.comprobante_id) {
    const fRes = await db.query(
      `SELECT id, pto_vta, cbte_nro, tipo_cbte, fecha_emision, emitida_en, presupuesto_id, factura_asociada_id 
       FROM public.factura_facturas 
       WHERE id = $1`,
      [m.comprobante_id]
    );
    if (fRes.rows.length > 0) f = fRes.rows[0];
  }

  const presupuestoId = m.presupuesto_id || (f ? f.presupuesto_id : null);
  let p = null;
  let ee = null;

  // 2. Buscar datos en presupuestos y eventos logísticos
  if (presupuestoId) {
    const pRes = await db.query(
      `SELECT id, punto_entrega, estado_logistico, fecha_entrega_real, fecha_actualizacion, secuencia 
       FROM public.presupuestos 
       WHERE id = $1`,
      [presupuestoId]
    );
    if (pRes.rows.length > 0) p = pRes.rows[0];

    const eeRes = await db.query(
      `SELECT fecha_entrega, tipo_evento, receptor_nombre, dni_receptor, receptor_vinculo 
       FROM public.entregas_eventos 
       WHERE id_presupuesto = $1 
       ORDER BY id DESC LIMIT 1`,
      [presupuestoId]
    );
    if (eeRes.rows.length > 0) ee = eeRes.rows[0];
  } else if (m.comprobante_id) {
    // Si la factura no tenía presupuesto_id explícito, buscar presupuesto por factura_id
    const pRes = await db.query(
      `SELECT id, punto_entrega, estado_logistico, fecha_entrega_real, fecha_actualizacion, secuencia 
       FROM public.presupuestos 
       WHERE factura_id = $1 LIMIT 1`,
      [m.comprobante_id]
    );
    if (pRes.rows.length > 0) {
      p = pRes.rows[0];
      const eeRes = await db.query(
        `SELECT fecha_entrega, tipo_evento, receptor_nombre, dni_receptor, receptor_vinculo 
         FROM public.entregas_eventos 
         WHERE id_presupuesto = $1 
         ORDER BY id DESC LIMIT 1`,
        [p.id]
      );
      if (eeRes.rows.length > 0) ee = eeRes.rows[0];
    }
  }

  // 3. Evaluar jerarquía determinista de Punto Cero
  if (ee && ee.fecha_entrega) {
    const receptor = ee.receptor_nombre ? `${ee.receptor_nombre}${ee.receptor_vinculo ? ` (${ee.receptor_vinculo})` : ''}` : 'Chofer QR';
    return {
      punto_cero: new Date(ee.fecha_entrega),
      tipo_punto_cero: 'REPARTO_CONFIRMADO',
      canal_logistico: 'Reparto a Domicilio',
      icono: '🚚',
      detalles: `Entregado en destino (${receptor})`
    };
  }

  if (p && p.fecha_entrega_real) {
    const esDeposito = p.estado_logistico === 'ENTREGADO_DEPOSITO' || p.secuencia === 'Retira_Deposito';
    return {
      punto_cero: new Date(p.fecha_entrega_real),
      tipo_punto_cero: esDeposito ? 'RETIRO_DEPOSITO' : 'REPARTO_REAL',
      canal_logistico: esDeposito ? 'Retiro por Depósito' : 'Reparto Logístico',
      icono: esDeposito ? '🏬' : '🚚',
      detalles: esDeposito ? 'Retirado por Depósito Central' : `Entregado (${p.punto_entrega || 'S/D'})`
    };
  }

  if (p && (p.estado_logistico === 'ENTREGADO_DEPOSITO' || p.secuencia === 'Retira_Deposito') && p.fecha_actualizacion) {
    return {
      punto_cero: new Date(p.fecha_actualizacion),
      tipo_punto_cero: 'RETIRO_DEPOSITO',
      canal_logistico: 'Retiro por Depósito',
      icono: '🏬',
      detalles: 'Retirado por Depósito Central'
    };
  }

  if (f && f.emitida_en) {
    return {
      punto_cero: new Date(f.emitida_en),
      tipo_punto_cero: 'EMISION_ELECTRONICA',
      canal_logistico: 'Facturación ARCA',
      icono: '🧾',
      detalles: 'Autorización electrónica de comprobante'
    };
  }

  return {
    punto_cero: new Date(m.fecha_movimiento),
    tipo_punto_cero: 'FECHA_COMPROBANTE',
    canal_logistico: 'Comprobante Administrativo',
    icono: '📅',
    detalles: 'Fecha administrativa del comprobante'
  };
}

/**
 * Resuelve de forma ligera los parámetros de financiación aplicables a un cliente para el motor FIFO
 */
async function obtenerReglasFinanciacionFIFO(codigoBunkerCliente, db = pool) {
  let cfg = {
    dias_ventana_estandar: 7,
    dias_gracia_natural: 3,
    dias_ventana_cortesia: 7,
    cupo_cortesias_anual: 3,
    tasa_servicio_financiero: 3.0,
    iva_porcentaje: 21.0
  };
  try {
    const resCfg = await db.query(
      `SELECT dias_ventana_estandar, dias_gracia_estandar, dias_ventana_cortesia,
              cupo_cortesias_anual, tasa_servicio_financiero, tasa_efectiva_mensual_base
       FROM public.bunker_financiacion_config
       WHERE activo = TRUE ORDER BY id ASC LIMIT 1`
    );
    if (resCfg.rows.length > 0) {
      const r = resCfg.rows[0];
      cfg.dias_ventana_estandar = parseInt(r.dias_ventana_estandar) || 7;
      cfg.dias_gracia_natural = parseInt(r.dias_gracia_estandar) || 3;
      cfg.dias_ventana_cortesia = parseInt(r.dias_ventana_cortesia) || 7;
      cfg.cupo_cortesias_anual = parseInt(r.cupo_cortesias_anual) || 3;
      cfg.tasa_servicio_financiero = parseFloat(r.tasa_servicio_financiero || r.tasa_efectiva_mensual_base) || 3.0;
    }

    const resCli = await db.query(
      `SELECT c.salvavidas_modo, c.salvavidas_tasa_tem, c.salvavidas_dias_estandar,
              c.salvavidas_dias_cortesia, c.salvavidas_dias_gracia,
              COALESCE(c.salvavidas_cupo_cortesias_anual, $2) as cupo_cortesias_anual,
              lp.salvavidas_habilitado as lista_salvavidas_habilitado,
              lp.salvavidas_tasa_tem as lista_salvavidas_tasa_tem,
              lp.salvavidas_dias_estandar as lista_salvavidas_dias_estandar,
              lp.salvavidas_dias_cortesia as lista_salvavidas_dias_cortesia
       FROM public.bunker_clientes c
       LEFT JOIN public.bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = c.id
       LEFT JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
       WHERE c.codigo_bunker_cliente = $1
       LIMIT 1`,
      [codigoBunkerCliente, cfg.cupo_cortesias_anual]
    );

    if (resCli.rows.length > 0) {
      const c = resCli.rows[0];
      if (c.salvavidas_modo === 'EXCLUIDO' || (c.salvavidas_modo === 'HEREDAR_LISTA' && c.lista_salvavidas_habilitado === false)) {
        return {
          habilitado: false,
          dias_ventana_estandar: cfg.dias_ventana_estandar,
          dias_gracia_natural: cfg.dias_gracia_natural,
          dias_tope_sin_comodin: cfg.dias_ventana_estandar + cfg.dias_gracia_natural,
          dias_total_cortesia: cfg.dias_ventana_estandar + cfg.dias_ventana_cortesia,
          cupo_cortesias_anual: parseInt(c.cupo_cortesias_anual) || 3,
          tasa_servicio_financiero: 0,
          tasa_diaria: 0,
          iva_porcentaje: 21.0
        };
      }
      const vEst = (c.salvavidas_dias_estandar !== null && !isNaN(parseInt(c.salvavidas_dias_estandar)))
        ? parseInt(c.salvavidas_dias_estandar)
        : ((c.lista_salvavidas_dias_estandar !== null && !isNaN(parseInt(c.lista_salvavidas_dias_estandar)))
          ? parseInt(c.lista_salvavidas_dias_estandar)
          : cfg.dias_ventana_estandar);
      const vGracia = (c.salvavidas_dias_gracia !== null && !isNaN(parseInt(c.salvavidas_dias_gracia)))
        ? parseInt(c.salvavidas_dias_gracia)
        : cfg.dias_gracia_natural;
      const vCort = (c.salvavidas_dias_cortesia !== null && !isNaN(parseInt(c.salvavidas_dias_cortesia)))
        ? parseInt(c.salvavidas_dias_cortesia)
        : ((c.lista_salvavidas_dias_cortesia !== null && !isNaN(parseInt(c.lista_salvavidas_dias_cortesia)))
          ? parseInt(c.lista_salvavidas_dias_cortesia)
          : cfg.dias_ventana_cortesia);
      const tasa = (c.salvavidas_tasa_tem !== null && !isNaN(parseFloat(c.salvavidas_tasa_tem)))
        ? parseFloat(c.salvavidas_tasa_tem)
        : ((c.lista_salvavidas_tasa_tem !== null && !isNaN(parseFloat(c.lista_salvavidas_tasa_tem)))
          ? parseFloat(c.lista_salvavidas_tasa_tem)
          : cfg.tasa_servicio_financiero);

      return {
        habilitado: true,
        dias_ventana_estandar: vEst,
        dias_gracia_natural: vGracia,
        dias_tope_sin_comodin: vEst + vGracia,
        dias_total_cortesia: vEst + vCort,
        cupo_cortesias_anual: parseInt(c.cupo_cortesias_anual) || 3,
        tasa_servicio_financiero: tasa,
        tasa_diaria: parseFloat((tasa / 30 / 100).toFixed(6)),
        iva_porcentaje: 21.0
      };
    }
  } catch (err) {
    console.warn('⚠️ [COMPOSICION-SALDO] Fallback de reglas financiación FIFO:', err.message);
  }
  return {
    habilitado: true,
    dias_ventana_estandar: cfg.dias_ventana_estandar,
    dias_gracia_natural: cfg.dias_gracia_natural,
    dias_tope_sin_comodin: cfg.dias_ventana_estandar + cfg.dias_gracia_natural,
    dias_total_cortesia: cfg.dias_ventana_estandar + cfg.dias_ventana_cortesia,
    cupo_cortesias_anual: cfg.cupo_cortesias_anual,
    tasa_servicio_financiero: cfg.tasa_servicio_financiero,
    tasa_diaria: parseFloat((cfg.tasa_servicio_financiero / 30 / 100).toFixed(6)),
    iva_porcentaje: 21.0
  };
}

/**
 * Calcula la composición de saldo y el envejecimiento de deuda mediante FIFO determinista
 * con Imputación Proporcional de Capital + Financiación (con IVA) cuando un pago se aplica
 * a comprobantes que han superado el período de cortesía/comodín (Etapa 4: Día 15+).
 * 
 * @param {number} cuentaId - ID de la cuenta corriente
 * @param {Object} db - Cliente o pool de PostgreSQL (opcional)
 * @returns {Promise<Object>} Composición completa de deuda, capas, pagos imputados y métricas comerciales
 */
async function calcularComposicionSaldo(cuentaId, db = pool) {
  // 1. Obtener la cuenta corriente
  const ccRes = await db.query(
    `SELECT cc.*, bc.cliente_nombre, bc.lomas_soft_id, bc.whatsapp_facturas
     FROM public.factura_cuentas_corrientes cc 
     LEFT JOIN public.bunker_clientes bc ON bc.codigo_bunker_cliente = cc.codigo_bunker_cliente 
     WHERE cc.id = $1`,
    [cuentaId]
  );

  if (ccRes.rows.length === 0) return null;
  const cc = ccRes.rows[0];
  const saldoContableTabla = parseFloat(cc.saldo) || 0;
  const reglasFin = await obtenerReglasFinanciacionFIFO(cc.codigo_bunker_cliente, db);

  // 2. Obtener movimientos cronológicos únicos (incluyendo metadatos)
  const movsRes = await db.query(
    `SELECT id, cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante, 
            tipo_comprobante, comprobante_id, presupuesto_id, descripcion, fecha_movimiento, creado_en, metadatos
     FROM public.factura_cuenta_corriente_movimientos
     WHERE cuenta_corriente_id = $1
     ORDER BY fecha_movimiento ASC, id ASC`,
    [cuentaId]
  );

  let movs = movsRes.rows;

  // 3. Inyectar fila virtual para Saldo de Apertura si existe y es distinta de cero
  const saldoApertura = parseFloat(cc.saldo_apertura) || 0;
  if (saldoApertura !== 0) {
    let fechaApertura = cc.creada_en ? new Date(cc.creada_en) : new Date();
    if (movs.length > 0) {
      const minFecha = new Date(movs[0].fecha_movimiento);
      if (minFecha <= fechaApertura) {
        fechaApertura = new Date(minFecha.getTime() - 1000);
      }
    }
    movs.unshift({
      id: `apertura-${cuentaId}`,
      tipo_movimiento: saldoApertura > 0 ? 'DEBITO' : 'CREDITO',
      monto: Math.abs(saldoApertura),
      saldo_resultante: saldoApertura,
      tipo_comprobante: 'AJUSTE_APERTURA',
      comprobante_id: null,
      presupuesto_id: null,
      descripcion: 'Saldo Inicial / Apertura de Cuenta',
      fecha_movimiento: fechaApertura,
      creado_en: fechaApertura,
      es_apertura: true,
      metadatos: null
    });
  }

  // Helper para calcular días calendario exactos en huso horario Argentina (UTC-3)
  const aFechaCalendarioAR = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    const str = dt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); // YYYY-MM-DD
    const [y, m, day] = str.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const sumarDiasIso = (d, dias) => {
    const dt = new Date(d instanceof Date ? d.getTime() : new Date(d).getTime());
    dt.setTime(dt.getTime() + dias * 24 * 60 * 60 * 1000);
    return dt.toISOString();
  };

  // Pre-escanear débitos que corresponden a facturas de financiación emitidas por pagos parciales
  const cargosFinanciacionPorPago = {};
  for (const m of movs) {
    if (m.tipo_movimiento === 'DEBITO' && m.metadatos) {
      const meta = typeof m.metadatos === 'string' ? JSON.parse(m.metadatos) : m.metadatos;
      if (meta && meta.es_cargo_financiacion && (meta.pago_origen_id || meta.codigo_sobre)) {
        const infoCargo = {
          mov_id: m.id,
          comprobante_id: m.comprobante_id,
          tipo_comprobante: m.tipo_comprobante,
          monto: parseFloat(m.monto) || 0,
          descripcion: m.descripcion,
          modo_facturacion: meta.modo_facturacion || 'INTERNA',
          fecha_movimiento: m.fecha_movimiento
        };
        if (meta.pago_origen_id) {
          cargosFinanciacionPorPago[String(meta.pago_origen_id)] = infoCargo;
        }
        if (meta.codigo_sobre) {
          cargosFinanciacionPorPago[`sobre:${meta.codigo_sobre}`] = infoCargo;
        }
      }
    }
  }

  // --- MOTOR FIFO DETERMINISTA CON IMPUTACIÓN PROPORCIONAL CAPITAL + FINANCIACIÓN ---
  const debitosAbiertos = [];
  const pagosConFinanciacion = [];
  const pagosConFinanciacionBonificada = [];
  const imputacionesPorMovimiento = {};
  const comodinesUsadosPorAnio = {};
  let creditoAcumuladoRemanente = 0;
  let ultimaFechaCredito = null;

  const diasEst = reglasFin.dias_ventana_estandar || 7;
  const diasTopeSinComodin = reglasFin.dias_tope_sin_comodin || 10;
  const diasTopeComodin = reglasFin.dias_total_cortesia || 14;

  for (const m of movs) {
    const monto = parseFloat(m.monto) || 0;
    const meta = m.metadatos ? (typeof m.metadatos === 'string' ? JSON.parse(m.metadatos) : m.metadatos) : {};

    if (m.tipo_movimiento === 'DEBITO') {
      // Si es el comprobante (Interno, En Aprobación o ARCA) de la financiación ya cobrada dentro de un pago,
      // no se apila como nueva factura de mercadería (ya fue cancelado por el propio pago origen).
      if (meta && meta.es_cargo_financiacion && (meta.pago_origen_id || meta.codigo_sobre)) {
        continue;
      }

      const puntoCeroInfo = await resolverPuntoCero(m, db);
      let debitoPendiente = monto;
      let capitalPagado = 0;
      let fechaCancelacion = null;

      // Si existía crédito acumulado previo sin asignar, absorberlo
      if (creditoAcumuladoRemanente > 0.005) {
        const absorb = Math.min(creditoAcumuladoRemanente, debitoPendiente);
        debitoPendiente = Math.round((debitoPendiente - absorb) * 100) / 100;
        capitalPagado = Math.round((capitalPagado + absorb) * 100) / 100;
        creditoAcumuladoRemanente = Math.round((creditoAcumuladoRemanente - absorb) * 100) / 100;
        if (debitoPendiente <= 0.005) {
          debitoPendiente = 0;
          fechaCancelacion = ultimaFechaCredito || new Date(m.fecha_movimiento);
        }
      }

      debitosAbiertos.push({
        mov_id: m.id,
        tipo_comprobante: m.tipo_comprobante,
        descripcion: m.descripcion,
        monto_original: monto,
        monto_pendiente: debitoPendiente,
        capital_pagado: capitalPagado,
        financiacion_pagada_neta: 0,
        financiacion_pagada_iva: 0,
        financiacion_pagada_con_iva: 0,
        pagos_aplicados: [],
        punto_cero: puntoCeroInfo.punto_cero,
        tipo_punto_cero: puntoCeroInfo.tipo_punto_cero,
        canal_logistico: puntoCeroInfo.canal_logistico,
        icono: puntoCeroInfo.icono,
        detalles_punto_cero: puntoCeroInfo.detalles,
        comprobante_id: m.comprobante_id,
        fecha_cancelacion: fechaCancelacion
      });

    } else if (m.tipo_movimiento === 'CREDITO') {
      let creditoRestante = monto;
      const fechaCred = new Date(m.fecha_movimiento || m.creado_en);
      ultimaFechaCredito = fechaCred;

      // CASO ESPECIAL 1: Movimiento de crédito separado que cancela específicamente el Interés de Financiación
      if (meta && meta.es_pago_financiacion) {
        const cargoFacturado = cargosFinanciacionPorPago[String(m.id)]
          || (meta.pago_capital_mov_id ? cargosFinanciacionPorPago[String(meta.pago_capital_mov_id)] : null)
          || (meta.codigo_sobre ? cargosFinanciacionPorPago[`sobre:${meta.codigo_sobre}`] : null)
          || null;
        const desgloseInteres = {
          pago_mov_id: m.id,
          pago_descripcion: m.descripcion,
          tipo_comprobante: m.tipo_comprobante,
          codigo_sobre: meta.codigo_sobre || null,
          fecha_pago: fechaCred.toISOString(),
          es_pago_financiacion: true,
          es_desglose_separado_en_cc: true,
          pago_capital_mov_id: meta.pago_capital_mov_id || null,
          pago_interes_mov_id: m.id,
          monto_pago_total: Math.round((parseFloat(meta.monto_total_sobre) || monto) * 100) / 100,
          capital_cancelado_total: Math.round((parseFloat(meta.capital_cancelado_sobre) || 0) * 100) / 100,
          financiacion_neta_cancelada: Math.round((parseFloat(meta.financiacion_neta_sobre) || 0) * 100) / 100,
          financiacion_iva_cancelada: Math.round((parseFloat(meta.financiacion_iva_sobre) || 0) * 100) / 100,
          financiacion_con_iva_cancelada: Math.round((parseFloat(meta.financiacion_con_iva_sobre) || monto) * 100) / 100,
          tiene_financiacion_imputada: true,
          financiacion_facturada: Boolean(cargoFacturado || meta.financiacion_facturada_id),
          factura_financiacion_id: cargoFacturado?.comprobante_id || meta.financiacion_facturada_id || null,
          factura_financiacion_mov_id: cargoFacturado?.mov_id || meta.financiacion_facturada_mov_id || null,
          factura_financiacion_descripcion: cargoFacturado?.descripcion || meta.financiacion_facturada_nro || null,
          modo_facturacion: cargoFacturado?.modo_facturacion || meta.financiacion_facturada_modo || 'INTERNA',
          detalles_comprobantes: Array.isArray(meta.detalles_comprobantes) ? meta.detalles_comprobantes : []
        };
        imputacionesPorMovimiento[String(m.id)] = desgloseInteres;
        continue;
      }

      // CASO ESPECIAL 2: Movimiento de crédito separado que cancela exclusivamente Capital ya facturado
      if (meta && meta.es_pago_capital_separado) {
        const finNetaSobre = Math.round((parseFloat(meta.financiacion_neta_sobre) || 0) * 100) / 100;
        const finIvaSobre = Math.round((parseFloat(meta.financiacion_iva_sobre) || 0) * 100) / 100;
        const finConIvaSobre = Math.round((parseFloat(meta.financiacion_con_iva_sobre) || 0) * 100) / 100;
        const montoTotalSobre = Math.round((parseFloat(meta.monto_total_sobre) || (monto + finConIvaSobre)) * 100) / 100;
        const detallesGuardados = Array.isArray(meta.detalles_comprobantes) ? meta.detalles_comprobantes : [];

        const desgloseCapitalSeparado = {
          pago_mov_id: m.id,
          pago_descripcion: m.descripcion,
          tipo_comprobante: m.tipo_comprobante,
          codigo_sobre: meta.codigo_sobre || null,
          fecha_pago: fechaCred.toISOString(),
          es_pago_capital_separado: true,
          es_desglose_separado_en_cc: true,
          pago_capital_mov_id: m.id,
          pago_interes_mov_id: meta.pago_interes_mov_id || null,
          monto_pago_total: montoTotalSobre,
          capital_cancelado_total: 0,
          financiacion_neta_cancelada: finNetaSobre,
          financiacion_iva_cancelada: finIvaSobre,
          financiacion_con_iva_cancelada: finConIvaSobre,
          tiene_financiacion_imputada: finConIvaSobre > 0,
          detalles_comprobantes: []
        };

        let finAsignadaPrimeraCapa = false;
        for (const d of debitosAbiertos) {
          if (creditoRestante <= 0.005) break;
          if (d.monto_pendiente <= 0.005) continue;

          const diasAlPago = Math.max(0, Math.round((aFechaCalendarioAR(fechaCred) - aFechaCalendarioAR(d.punto_cero)) / (1000 * 60 * 60 * 24)));
          const aplicar = Math.min(d.monto_pendiente, creditoRestante);
          d.monto_pendiente = Math.round((d.monto_pendiente - aplicar) * 100) / 100;
          d.capital_pagado = Math.round(((d.capital_pagado || 0) + aplicar) * 100) / 100;
          creditoRestante = Math.round((creditoRestante - aplicar) * 100) / 100;
          desgloseCapitalSeparado.capital_cancelado_total = Math.round((desgloseCapitalSeparado.capital_cancelado_total + aplicar) * 100) / 100;

          if (d.monto_pendiente <= 0.005) {
            d.monto_pendiente = 0;
            d.fecha_cancelacion = fechaCred;
          }

          const detGuardado = detallesGuardados.find(x => String(x.debito_mov_id) === String(d.mov_id) || (d.comprobante_id && String(x.comprobante_id) === String(d.comprobante_id)));
          const fNet = detGuardado ? (parseFloat(detGuardado.financiacion_neta_cancelada) || 0) : (!finAsignadaPrimeraCapa ? finNetaSobre : 0);
          const fIva = detGuardado ? (parseFloat(detGuardado.financiacion_iva_cancelada) || 0) : (!finAsignadaPrimeraCapa ? finIvaSobre : 0);
          const fConIva = detGuardado ? (parseFloat(detGuardado.financiacion_con_iva_cancelada) || 0) : (!finAsignadaPrimeraCapa ? finConIvaSobre : 0);
          finAsignadaPrimeraCapa = true;

          d.financiacion_pagada_neta = Math.round(((d.financiacion_pagada_neta || 0) + fNet) * 100) / 100;
          d.financiacion_pagada_iva = Math.round(((d.financiacion_pagada_iva || 0) + fIva) * 100) / 100;
          d.financiacion_pagada_con_iva = Math.round(((d.financiacion_pagada_con_iva || 0) + fConIva) * 100) / 100;

          const detItem = {
            debito_mov_id: d.mov_id,
            comprobante_id: d.comprobante_id,
            comprobante_descripcion: d.descripcion,
            dias_al_pago: detGuardado?.dias_al_pago || diasAlPago,
            tasa_tem: detGuardado?.tasa_tem || reglasFin.tasa_servicio_financiero,
            tasa_neta_pct: detGuardado?.tasa_neta_pct || Math.round((reglasFin.tasa_diaria * Math.max(1, diasAlPago)) * 10000) / 100,
            con_financiacion: fConIva > 0,
            monto_total_aplicado: Math.round((aplicar + fConIva) * 100) / 100,
            capital_cancelado: Math.round(aplicar * 100) / 100,
            financiacion_neta_cancelada: fNet,
            financiacion_iva_cancelada: fIva,
            financiacion_con_iva_cancelada: fConIva,
            capital_remanente_comprobante: d.monto_pendiente
          };
          d.pagos_aplicados.push({ ...detItem, pago_mov_id: m.id, fecha_pago: fechaCred.toISOString(), codigo_sobre: meta?.codigo_sobre || null });
          desgloseCapitalSeparado.detalles_comprobantes.push(detItem);
        }

        if (creditoRestante > 0.005) {
          creditoAcumuladoRemanente = Math.round((creditoAcumuladoRemanente + creditoRestante) * 100) / 100;
        }

        const cargoFacturado = cargosFinanciacionPorPago[String(m.id)]
          || (meta.pago_interes_mov_id ? cargosFinanciacionPorPago[String(meta.pago_interes_mov_id)] : null)
          || (meta.codigo_sobre ? cargosFinanciacionPorPago[`sobre:${meta.codigo_sobre}`] : null)
          || null;
        desgloseCapitalSeparado.financiacion_facturada = Boolean(cargoFacturado || meta?.financiacion_facturada_id);
        desgloseCapitalSeparado.factura_financiacion_id = cargoFacturado?.comprobante_id || meta?.financiacion_facturada_id || null;
        desgloseCapitalSeparado.factura_financiacion_mov_id = cargoFacturado?.mov_id || meta?.financiacion_facturada_mov_id || null;
        desgloseCapitalSeparado.factura_financiacion_descripcion = cargoFacturado?.descripcion || meta?.financiacion_facturada_nro || null;
        desgloseCapitalSeparado.modo_facturacion = cargoFacturado?.modo_facturacion || meta?.financiacion_facturada_modo || (desgloseCapitalSeparado.financiacion_facturada ? 'INTERNA' : 'PENDIENTE');

        imputacionesPorMovimiento[String(m.id)] = desgloseCapitalSeparado;
        if (meta.pago_interes_mov_id && imputacionesPorMovimiento[String(meta.pago_interes_mov_id)]) {
          imputacionesPorMovimiento[String(meta.pago_interes_mov_id)].detalles_comprobantes = desgloseCapitalSeparado.detalles_comprobantes;
          imputacionesPorMovimiento[String(meta.pago_interes_mov_id)].financiacion_facturada = desgloseCapitalSeparado.financiacion_facturada;
          imputacionesPorMovimiento[String(meta.pago_interes_mov_id)].factura_financiacion_id = desgloseCapitalSeparado.factura_financiacion_id;
          imputacionesPorMovimiento[String(meta.pago_interes_mov_id)].factura_financiacion_mov_id = desgloseCapitalSeparado.factura_financiacion_mov_id;
          imputacionesPorMovimiento[String(meta.pago_interes_mov_id)].factura_financiacion_descripcion = desgloseCapitalSeparado.factura_financiacion_descripcion;
          imputacionesPorMovimiento[String(meta.pago_interes_mov_id)].modo_facturacion = desgloseCapitalSeparado.modo_facturacion;
        }
        if (desgloseCapitalSeparado.tiene_financiacion_imputada) {
          pagosConFinanciacion.push(desgloseCapitalSeparado);
        }
        continue;
      }

      const esNotaCreditoOAjuste = ['NOTA_CREDITO', 'AJUSTE_REDONDEO', 'AJUSTE_AUTOMATICO', 'AJUSTE_MANUAL', 'AJUSTE_APERTURA'].includes(m.tipo_comprobante);

      // A) Si es Nota de Crédito con factura asociada directa, imputar prioritariamente a esa factura (100% capital)
      let facturaAsociadaId = null;
      if (m.comprobante_id) {
        const ncRes = await db.query(
          `SELECT factura_asociada_id FROM public.factura_facturas WHERE id = $1`,
          [m.comprobante_id]
        );
        if (ncRes.rows.length > 0) facturaAsociadaId = ncRes.rows[0].factura_asociada_id;
      }

      const tieneCargoFinanciacionExplicito = Boolean(
        cargosFinanciacionPorPago[String(m.id)] ||
        meta?.financiacion_facturada_id ||
        meta?.imputar_con_financiacion === true
      );

      const desgloseEstePago = {
        pago_mov_id: m.id,
        pago_descripcion: m.descripcion,
        tipo_comprobante: m.tipo_comprobante,
        codigo_sobre: meta?.codigo_sobre || null,
        fecha_pago: fechaCred.toISOString(),
        monto_pago_total: Math.round(monto * 100) / 100,
        capital_cancelado_total: 0,
        financiacion_neta_cancelada: 0,
        financiacion_iva_cancelada: 0,
        financiacion_con_iva_cancelada: 0,
        tiene_financiacion_imputada: false,
        financiacion_bonificada_neta: 0,
        financiacion_bonificada_iva: 0,
        financiacion_bonificada_con_iva: 0,
        tiene_financiacion_bonificada: false,
        detalles_comprobantes: []
      };

      if (facturaAsociadaId) {
        const debitoAsociado = debitosAbiertos.find(d => String(d.comprobante_id) === String(facturaAsociadaId) && d.monto_pendiente > 0.005);
        if (debitoAsociado) {
          const aplicar = Math.min(debitoAsociado.monto_pendiente, creditoRestante);
          debitoAsociado.monto_pendiente = Math.round((debitoAsociado.monto_pendiente - aplicar) * 100) / 100;
          debitoAsociado.capital_pagado = Math.round(((debitoAsociado.capital_pagado || 0) + aplicar) * 100) / 100;
          creditoRestante = Math.round((creditoRestante - aplicar) * 100) / 100;
          desgloseEstePago.capital_cancelado_total = Math.round((desgloseEstePago.capital_cancelado_total + aplicar) * 100) / 100;
          if (debitoAsociado.monto_pendiente <= 0.005) {
            debitoAsociado.monto_pendiente = 0;
            debitoAsociado.fecha_cancelacion = fechaCred;
          }
        }
      }

      // B) Imputar crédito restante por orden cronológico estricto (FIFO) a la deuda más antigua
      for (const d of debitosAbiertos) {
        if (creditoRestante <= 0.005) break;
        if (d.monto_pendiente <= 0.005) continue;

        const diasAlPago = Math.max(0, Math.round((aFechaCalendarioAR(fechaCred) - aFechaCalendarioAR(d.punto_cero)) / (1000 * 60 * 60 * 24)));
        const anioPago = fechaCred.getFullYear();
        const usadosEnAnio = comodinesUsadosPorAnio[anioPago] || 0;
        const comodinesDispAlPago = Math.max(0, (reglasFin.cupo_cortesias_anual || 3) - usadosEnAnio);
        const esFacturaComercial = ['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'PENDIENTE_FACTURACION'].includes(d.tipo_comprobante);

        // Si el pago ocurre en Etapa 4 (superados los 14 días, o >10 días sin comodines disponibles),
        // se evalúa la financiación devengada durante esos días.
        const aplicaFinanciacion = Boolean(
          !esNotaCreditoOAjuste &&
          reglasFin.habilitado &&
          esFacturaComercial &&
          (diasAlPago > diasTopeComodin || (diasAlPago > diasTopeSinComodin && comodinesDispAlPago <= 0))
        );

        if (!aplicaFinanciacion || !tieneCargoFinanciacionExplicito) {
          // Pagos en término, con comodín, o pagos históricos / bonificados que imputaron 100% a Capital en el libro contable
          const aplicar = Math.min(d.monto_pendiente, creditoRestante);
          d.monto_pendiente = Math.round((d.monto_pendiente - aplicar) * 100) / 100;
          d.capital_pagado = Math.round(((d.capital_pagado || 0) + aplicar) * 100) / 100;
          creditoRestante = Math.round((creditoRestante - aplicar) * 100) / 100;
          desgloseEstePago.capital_cancelado_total = Math.round((desgloseEstePago.capital_cancelado_total + aplicar) * 100) / 100;

          if (d.monto_pendiente <= 0.005) {
            d.monto_pendiente = 0;
            d.fecha_cancelacion = fechaCred;
            if (esFacturaComercial && diasAlPago > diasTopeSinComodin && diasAlPago <= diasTopeComodin) {
              comodinesUsadosPorAnio[anioPago] = usadosEnAnio + 1;
            }
          }

          let finBonifNeta = 0;
          let finBonifIva = 0;
          let finBonifConIva = 0;
          if (aplicaFinanciacion && aplicar > 0.005) {
            const diasFin = Math.max(1, diasAlPago);
            const tasaNeta = reglasFin.tasa_diaria * diasFin;
            finBonifNeta = Math.round(aplicar * tasaNeta * 100) / 100;
            finBonifIva = Math.round(finBonifNeta * 0.21 * 100) / 100;
            finBonifConIva = Math.round((finBonifNeta + finBonifIva) * 100) / 100;

            d.financiacion_bonificada_neta = Math.round(((d.financiacion_bonificada_neta || 0) + finBonifNeta) * 100) / 100;
            d.financiacion_bonificada_iva = Math.round(((d.financiacion_bonificada_iva || 0) + finBonifIva) * 100) / 100;
            d.financiacion_bonificada_con_iva = Math.round(((d.financiacion_bonificada_con_iva || 0) + finBonifConIva) * 100) / 100;

            desgloseEstePago.tiene_financiacion_bonificada = true;
            desgloseEstePago.financiacion_bonificada_neta = Math.round((desgloseEstePago.financiacion_bonificada_neta + finBonifNeta) * 100) / 100;
            desgloseEstePago.financiacion_bonificada_iva = Math.round((desgloseEstePago.financiacion_bonificada_iva + finBonifIva) * 100) / 100;
            desgloseEstePago.financiacion_bonificada_con_iva = Math.round((desgloseEstePago.financiacion_bonificada_con_iva + finBonifConIva) * 100) / 100;
          }

          const detItem = {
            debito_mov_id: d.mov_id,
            comprobante_id: d.comprobante_id,
            comprobante_descripcion: d.descripcion,
            dias_al_pago: diasAlPago,
            con_financiacion: false,
            con_financiacion_bonificada: finBonifConIva > 0,
            monto_total_aplicado: Math.round(aplicar * 100) / 100,
            capital_cancelado: Math.round(aplicar * 100) / 100,
            financiacion_neta_cancelada: 0,
            financiacion_iva_cancelada: 0,
            financiacion_con_iva_cancelada: 0,
            financiacion_bonificada_neta: finBonifNeta,
            financiacion_bonificada_iva: finBonifIva,
            financiacion_bonificada_con_iva: finBonifConIva,
            capital_remanente_comprobante: d.monto_pendiente
          };
          d.pagos_aplicados.push({ ...detItem, pago_mov_id: m.id, fecha_pago: fechaCred.toISOString(), codigo_sobre: meta?.codigo_sobre || null });
          desgloseEstePago.detalles_comprobantes.push(detItem);
        } else {
          // IMPUTACIÓN PROPORCIONAL: Capital + Financiación (16 días al 0,1%/d + 21% IVA) contenidos dentro del pago
          const diasFin = Math.max(1, diasAlPago);
          const tasaNeta = reglasFin.tasa_diaria * diasFin; // ej: 0.001 * 16 = 0.016 (1,6%)
          const factorIva = 1 + ((reglasFin.iva_porcentaje || 21) / 100); // 1.21
          const tasaConIva = tasaNeta * factorIva; // ej: 0.01936 (1,936%)

          const intNetoTotalCapa = Math.round(d.monto_pendiente * tasaNeta * 100) / 100;
          const ivaIntTotalCapa = Math.round(intNetoTotalCapa * 0.21 * 100) / 100;
          const intConIvaTotalCapa = Math.round((intNetoTotalCapa + ivaIntTotalCapa) * 100) / 100;
          const totalExigibleCapa = Math.round((d.monto_pendiente + intConIvaTotalCapa) * 100) / 100;

          let montoAplicado = 0;
          let capitalCancelado = 0;
          let intNetoCancelado = 0;
          let ivaIntCancelado = 0;
          let intConIvaCancelado = 0;

          if (creditoRestante < totalExigibleCapa - 0.01) {
            // Pago parcial sobre el comprobante financiado
            montoAplicado = Math.round(creditoRestante * 100) / 100;
            capitalCancelado = Math.round((montoAplicado / (1 + tasaConIva)) * 100) / 100;
            intConIvaCancelado = Math.round((montoAplicado - capitalCancelado) * 100) / 100;
            intNetoCancelado = Math.round(capitalCancelado * tasaNeta * 100) / 100;
            ivaIntCancelado = Math.round((intConIvaCancelado - intNetoCancelado) * 100) / 100;

            d.monto_pendiente = Math.round((d.monto_pendiente - capitalCancelado) * 100) / 100;
            creditoRestante = 0;
          } else {
            // Pago que cubre el 100% del comprobante (Capital + Financiación c/IVA)
            capitalCancelado = Math.round(d.monto_pendiente * 100) / 100;
            intNetoCancelado = intNetoTotalCapa;
            ivaIntCancelado = ivaIntTotalCapa;
            intConIvaCancelado = intConIvaTotalCapa;
            montoAplicado = totalExigibleCapa;

            d.monto_pendiente = 0;
            d.fecha_cancelacion = fechaCred;
            creditoRestante = Math.round(Math.max(0, creditoRestante - montoAplicado) * 100) / 100;
          }

          d.capital_pagado = Math.round(((d.capital_pagado || 0) + capitalCancelado) * 100) / 100;
          d.financiacion_pagada_neta = Math.round(((d.financiacion_pagada_neta || 0) + intNetoCancelado) * 100) / 100;
          d.financiacion_pagada_iva = Math.round(((d.financiacion_pagada_iva || 0) + ivaIntCancelado) * 100) / 100;
          d.financiacion_pagada_con_iva = Math.round(((d.financiacion_pagada_con_iva || 0) + intConIvaCancelado) * 100) / 100;

          desgloseEstePago.tiene_financiacion_imputada = true;
          desgloseEstePago.capital_cancelado_total = Math.round((desgloseEstePago.capital_cancelado_total + capitalCancelado) * 100) / 100;
          desgloseEstePago.financiacion_neta_cancelada = Math.round((desgloseEstePago.financiacion_neta_cancelada + intNetoCancelado) * 100) / 100;
          desgloseEstePago.financiacion_iva_cancelada = Math.round((desgloseEstePago.financiacion_iva_cancelada + ivaIntCancelado) * 100) / 100;
          desgloseEstePago.financiacion_con_iva_cancelada = Math.round((desgloseEstePago.financiacion_con_iva_cancelada + intConIvaCancelado) * 100) / 100;

          const detItem = {
            debito_mov_id: d.mov_id,
            comprobante_id: d.comprobante_id,
            comprobante_descripcion: d.descripcion,
            dias_al_pago: diasFin,
            tasa_tem: reglasFin.tasa_servicio_financiero,
            tasa_neta_pct: Math.round(tasaNeta * 10000) / 100,
            con_financiacion: true,
            monto_total_aplicado: montoAplicado,
            capital_cancelado: capitalCancelado,
            financiacion_neta_cancelada: intNetoCancelado,
            financiacion_iva_cancelada: ivaIntCancelado,
            financiacion_con_iva_cancelada: intConIvaCancelado,
            capital_remanente_comprobante: d.monto_pendiente
          };
          d.pagos_aplicados.push({ ...detItem, pago_mov_id: m.id, fecha_pago: fechaCred.toISOString(), codigo_sobre: meta?.codigo_sobre || null });
          desgloseEstePago.detalles_comprobantes.push(detItem);
        }
      }

      // C) Si aún queda crédito tras cubrir todos los débitos previos, acumular para futuros débitos
      if (creditoRestante > 0.005) {
        creditoAcumuladoRemanente = Math.round((creditoAcumuladoRemanente + creditoRestante) * 100) / 100;
      }

      // Vincular información de facturación del interés cobrado (si ya fue facturado internamente o por ARCA)
      const cargoFacturado = cargosFinanciacionPorPago[String(m.id)] || null;
      desgloseEstePago.financiacion_facturada = Boolean(cargoFacturado || meta?.financiacion_facturada_id);
      desgloseEstePago.factura_financiacion_id = cargoFacturado?.comprobante_id || meta?.financiacion_facturada_id || null;
      desgloseEstePago.factura_financiacion_mov_id = cargoFacturado?.mov_id || meta?.financiacion_facturada_mov_id || null;
      desgloseEstePago.factura_financiacion_descripcion = cargoFacturado?.descripcion || meta?.financiacion_facturada_nro || null;
      desgloseEstePago.modo_facturacion = cargoFacturado?.modo_facturacion || meta?.financiacion_facturada_modo || (desgloseEstePago.financiacion_facturada ? 'INTERNA' : 'PENDIENTE');

      imputacionesPorMovimiento[String(m.id)] = desgloseEstePago;
      if (desgloseEstePago.tiene_financiacion_imputada) {
        pagosConFinanciacion.push(desgloseEstePago);
      }
      if (desgloseEstePago.tiene_financiacion_bonificada) {
        pagosConFinanciacionBonificada.push(desgloseEstePago);
      }
    }
  }

  // Construir traza histórica de comprobantes ya cancelados (para diagnóstico de uso de comodines y gracia natural)
  const comprobantesCancelados = debitosAbiertos
    .filter(d => d.monto_pendiente <= 0.005 && d.tipo_comprobante === 'FACTURA')
    .map(d => {
      const fCan = d.fecha_cancelacion || new Date();
      const diasCalendario = Math.max(0, Math.round((aFechaCalendarioAR(fCan) - aFechaCalendarioAR(d.punto_cero)) / (1000 * 60 * 60 * 24)));
      let tramoCancelacion = 'PLAZO_HABITUAL'; // 1 a 7 días
      if (diasCalendario > diasTopeComodin) {
        tramoCancelacion = 'SALVAVIDAS_FINANCIADO';
      } else if (diasCalendario > diasTopeSinComodin) {
        tramoCancelacion = 'COMODIN_USADO'; // 11 a 14 días
      } else if (diasCalendario > diasEst) {
        tramoCancelacion = 'GRACIA_NATURAL'; // 8 a 10 días (+3 días de gracia naturales sin comodín)
      }
      return {
        mov_id: d.mov_id,
        comprobante_id: d.comprobante_id,
        tipo_comprobante: d.tipo_comprobante,
        descripcion: d.descripcion,
        monto_original: Math.round(d.monto_original * 100) / 100,
        capital_pagado: Math.round((d.capital_pagado || d.monto_original) * 100) / 100,
        financiacion_pagada_neta: Math.round((d.financiacion_pagada_neta || 0) * 100) / 100,
        financiacion_pagada_iva: Math.round((d.financiacion_pagada_iva || 0) * 100) / 100,
        financiacion_pagada_con_iva: Math.round((d.financiacion_pagada_con_iva || 0) * 100) / 100,
        financiacion_bonificada_neta: Math.round((d.financiacion_bonificada_neta || 0) * 100) / 100,
        financiacion_bonificada_iva: Math.round((d.financiacion_bonificada_iva || 0) * 100) / 100,
        financiacion_bonificada_con_iva: Math.round((d.financiacion_bonificada_con_iva || 0) * 100) / 100,
        punto_cero: d.punto_cero.toISOString(),
        fecha_vto_compromiso: sumarDiasIso(d.punto_cero, diasEst),
        fecha_vto_gracia_natural: sumarDiasIso(d.punto_cero, diasTopeSinComodin),
        fecha_vto_comodin: sumarDiasIso(d.punto_cero, diasTopeComodin),
        fecha_cancelacion: fCan.toISOString(),
        dias_hasta_cancelacion: diasCalendario,
        dias_al_cancelar: diasCalendario,
        tramo_cancelacion: tramoCancelacion,
        uso_comodin: tramoCancelacion === 'COMODIN_USADO',
        en_gracia_natural: tramoCancelacion === 'GRACIA_NATURAL'
      };
    });

  // Filtrar capas efectivamente impagas
  const ahora = new Date();
  const capasPendientes = debitosAbiertos
    .filter(d => d.monto_pendiente > 0.005)
    .map(d => {
      const msDiff = Math.max(0, ahora.getTime() - d.punto_cero.getTime());
      const horasTotal = Math.floor(msDiff / (1000 * 60 * 60));
      const diasCalendarioAR = Math.max(0, Math.round((aFechaCalendarioAR(ahora) - aFechaCalendarioAR(d.punto_cero)) / (1000 * 60 * 60 * 24)));
      const dias = Math.max(Math.floor(horasTotal / 24), diasCalendarioAR);
      const horas = horasTotal % 24;

      let antiguedadTexto = '';
      if (dias === 0) {
        antiguedadTexto = `Hace ${horas} hs`;
      } else if (dias === 1) {
        antiguedadTexto = `Hace 1 día y ${horas} hs`;
      } else {
        antiguedadTexto = `Hace ${dias} días y ${horas} hs`;
      }

      // Semáforo individual de factura
      let estadoSemaforo = 'OPTIMO'; // 0-7 días
      if (dias > diasTopeComodin) {
        estadoSemaforo = 'VENCIDO';
      } else if (dias > diasEst) {
        estadoSemaforo = 'ALERTA';
      }

      return {
        mov_id: d.mov_id,
        comprobante_id: d.comprobante_id,
        tipo_comprobante: d.tipo_comprobante,
        descripcion: d.descripcion,
        monto_original: Math.round(d.monto_original * 100) / 100,
        capital_pagado: Math.round((d.capital_pagado || 0) * 100) / 100,
        financiacion_pagada_neta: Math.round((d.financiacion_pagada_neta || 0) * 100) / 100,
        financiacion_pagada_iva: Math.round((d.financiacion_pagada_iva || 0) * 100) / 100,
        financiacion_pagada_con_iva: Math.round((d.financiacion_pagada_con_iva || 0) * 100) / 100,
        pagos_aplicados: d.pagos_aplicados || [],
        monto_pendiente: Math.round(d.monto_pendiente * 100) / 100,
        porcentaje_impago: Math.round((d.monto_pendiente / d.monto_original) * 1000) / 10,
        punto_cero: d.punto_cero.toISOString(),
        fecha_vto_compromiso: sumarDiasIso(d.punto_cero, diasEst),
        fecha_vto_gracia_natural: sumarDiasIso(d.punto_cero, diasTopeSinComodin),
        fecha_vto_comodin: sumarDiasIso(d.punto_cero, diasTopeComodin),
        tipo_punto_cero: d.tipo_punto_cero,
        canal_logistico: d.canal_logistico,
        icono: d.icono,
        detalles_punto_cero: d.detalles_punto_cero,
        antiguedad_dias: dias,
        antiguedad_horas: horas,
        antiguedad_texto: antiguedadTexto,
        estado_semaforo: estadoSemaforo
      };
    });

  const sumaPendiente = Math.round(capasPendientes.reduce((acc, c) => acc + c.monto_pendiente, 0) * 100) / 100;
  const financiacionCobradaPendienteFacturar = Math.round(
    pagosConFinanciacion
      .filter(p => !p.financiacion_facturada)
      .reduce((acc, p) => acc + p.financiacion_con_iva_cancelada, 0) * 100
  ) / 100;

  const financiacionHistoricaBonificadaNeta = Math.round(
    pagosConFinanciacionBonificada.reduce((acc, p) => acc + (p.financiacion_bonificada_neta || 0), 0) * 100
  ) / 100;
  const financiacionHistoricaBonificadaIva = Math.round(
    pagosConFinanciacionBonificada.reduce((acc, p) => acc + (p.financiacion_bonificada_iva || 0), 0) * 100
  ) / 100;
  const financiacionHistoricaBonificadaTotal = Math.round(
    pagosConFinanciacionBonificada.reduce((acc, p) => acc + (p.financiacion_bonificada_con_iva || 0), 0) * 100
  ) / 100;

  // El saldo de capital real pendiente es sumaPendiente (si no hay saldo a favor)
  const saldoFinal = capasPendientes.length > 0 ? sumaPendiente : saldoContableTabla;

  // Si la cuenta no tiene deuda (está al día o tiene saldo a favor)
  if (saldoFinal <= 0.005 && capasPendientes.length === 0) {
    return {
      cuenta_id: cc.id,
      codigo: cc.codigo_bunker_cliente,
      cliente: cc.cliente_nombre,
      saldo_actual: saldoFinal,
      saldo_contable_tabla: saldoContableTabla,
      financiacion_cobrada_pendiente_facturar: financiacionCobradaPendienteFacturar,
      pagos_con_financiacion: pagosConFinanciacion,
      pagos_con_financiacion_bonificada: pagosConFinanciacionBonificada,
      financiacion_historica_bonificada_neta: financiacionHistoricaBonificadaNeta,
      financiacion_historica_bonificada_iva: financiacionHistoricaBonificadaIva,
      financiacion_historica_bonificada_total: financiacionHistoricaBonificadaTotal,
      imputaciones_por_movimiento: imputacionesPorMovimiento,
      estado_cuenta: saldoFinal < -0.005 ? 'SALDO_A_FAVOR' : 'AL_DIA',
      estado_texto: saldoFinal < -0.005 ? 'Saldo a favor del cliente' : 'Cuenta al día / Sin deuda',
      cantidad_comprobantes_abiertos: 0,
      antiguedad_maxima_dias: 0,
      antiguedad_promedio_dias: 0,
      condicion_comercial: 'AL_DIA_OPTIMO',
      capas: [],
      comprobantes_cancelados: comprobantesCancelados,
      texto_whatsapp_composicion: ''
    };
  }

  // Métricas agregadas de antigüedad
  const antiguedadMaximaDias = capasPendientes.length > 0 
    ? Math.max(...capasPendientes.map(c => c.antiguedad_dias)) 
    : 0;

  const ponderacionTotal = capasPendientes.reduce((acc, c) => acc + (c.monto_pendiente * c.antiguedad_dias), 0);
  const antiguedadPromedioDias = sumaPendiente > 0 ? Math.round((ponderacionTotal / sumaPendiente) * 10) / 10 : 0;

  // Clasificación comercial para políticas de descuento
  let condicionComercial = 'AL_DIA_OPTIMO';
  let condicionComercialTexto = 'Al día / Descuentos Habilitados';
  if (antiguedadMaximaDias > diasTopeComodin) {
    condicionComercial = 'MORA_ATRASO';
    condicionComercialTexto = 'Atrasado (+15 días) / Descuentos Suspendidos';
  } else if (antiguedadMaximaDias > diasEst) {
    condicionComercial = 'REGULAR_ALERTA';
    condicionComercialTexto = 'Regular (8-14 días) / Condición en Alerta';
  }

  // Redacción del texto enriquecido para WhatsApp
  let textoWhatsapp = '';
  if (capasPendientes.length > 0) {
    const cantTexto = capasPendientes.length === 1 ? '1 comprobante pendiente' : `${capasPendientes.length} comprobantes pendientes`;
    textoWhatsapp += `\n📋 *Composición de Saldo (${cantTexto}):*\n`;
    
    capasPendientes.forEach(c => {
      const fechaObj = new Date(c.punto_cero);
      const fechaFormateada = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      const horaFormateada = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      
      const partsPend = c.monto_pendiente.toFixed(2).split('.');
      const fmtPend = `$${partsPend[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${partsPend[1]}`;

      if (c.porcentaje_impago >= 99.9) {
        textoWhatsapp += `• ${c.descripcion}: *${fmtPend}* (100%)\n`;
      } else {
        const partsOrig = c.monto_original.toFixed(2).split('.');
        const fmtOrig = `$${partsOrig[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${partsOrig[1]}`;
        textoWhatsapp += `• ${c.descripcion}: *${fmtPend}* (saldo de ${fmtOrig})\n`;
      }
      textoWhatsapp += `  ${c.icono} ${c.canal_logistico}: ${fechaFormateada} ${horaFormateada} hs (${c.antiguedad_texto})\n`;
    });

    if (antiguedadMaximaDias > 7) {
      textoWhatsapp += `\n⚠️ *Antigüedad máxima de deuda:* ${antiguedadMaximaDias} días.\n`;
    }
  }

  return {
    cuenta_id: cc.id,
    codigo: cc.codigo_bunker_cliente,
    cliente: cc.cliente_nombre,
    saldo_actual: saldoFinal,
    saldo_contable_tabla: saldoContableTabla,
    suma_capas_pendientes: sumaPendiente,
    financiacion_cobrada_pendiente_facturar: financiacionCobradaPendienteFacturar,
    pagos_con_financiacion: pagosConFinanciacion,
    pagos_con_financiacion_bonificada: pagosConFinanciacionBonificada,
    financiacion_historica_bonificada_neta: financiacionHistoricaBonificadaNeta,
    financiacion_historica_bonificada_iva: financiacionHistoricaBonificadaIva,
    financiacion_historica_bonificada_total: financiacionHistoricaBonificadaTotal,
    imputaciones_por_movimiento: imputacionesPorMovimiento,
    discrepancia_matematica: Math.abs(Math.round((saldoContableTabla + financiacionCobradaPendienteFacturar - sumaPendiente) * 100) / 100),
    cantidad_comprobantes_abiertos: capasPendientes.length,
    antiguedad_maxima_dias: antiguedadMaximaDias,
    antiguedad_promedio_dias: antiguedadPromedioDias,
    condicion_comercial: condicionComercial,
    condicion_comercial_texto: condicionComercialTexto,
    capas: capasPendientes,
    comprobantes_cancelados: comprobantesCancelados,
    texto_whatsapp_composicion: textoWhatsapp
  };
}

/**
 * Simula la imputación exacta de un monto de pago entrante (ej. Sobre en efectivo o Transferencia Bancaria)
 * contra las capas de deuda abiertas de la cuenta corriente, separando Capital vs. Interés de Financiación.
 */
async function simularImputacionPago(cuentaId, montoPago, db = pool) {
  const comp = await calcularComposicionSaldo(cuentaId, db);
  if (!comp) return null;

  const reglasFin = await obtenerReglasFinanciacionFIFO(comp.codigo, db);
  const diasTopeSinComodin = reglasFin.dias_tope_sin_comodin || 10;
  const diasTopeComodin = reglasFin.dias_total_cortesia || 14;
  const anioActual = new Date().getFullYear();
  const comodinesUsados = (comp.comprobantes_cancelados || []).filter(cc => cc.uso_comodin && (!cc.fecha_cancelacion || new Date(cc.fecha_cancelacion).getFullYear() === anioActual)).length;
  const comodinesDisp = Math.max(0, (reglasFin.cupo_cortesias_anual || 3) - comodinesUsados);

  let creditoRestante = Math.round((parseFloat(montoPago) || 0) * 100) / 100;
  let capitalCanceladoTotal = 0;
  let financiacionNetaCancelada = 0;
  let financiacionIvaCancelada = 0;
  let financiacionConIvaCancelada = 0;
  let financiacionActivaTotalNeta = 0;
  let financiacionActivaTotalIva = 0;
  let financiacionActivaTotalConIva = 0;
  const detallesComprobantes = [];

  for (const capa of (comp.capas || [])) {
    let pendiente = Math.round((parseFloat(capa.monto_pendiente) || 0) * 100) / 100;
    if (pendiente <= 0.005) continue;

    const diasAlPago = Math.max(0, parseInt(capa.antiguedad_dias) || 0);
    const esFacturaComercial = ['FACTURA', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'PENDIENTE_FACTURACION'].includes(capa.tipo_comprobante);
    const aplicaFinanciacion = Boolean(
      reglasFin.habilitado &&
      esFacturaComercial &&
      (diasAlPago > diasTopeComodin || (diasAlPago > diasTopeSinComodin && comodinesDisp <= 0))
    );

    if (aplicaFinanciacion) {
      const diasFinCapa = Math.max(1, diasAlPago);
      const tasaNetaCapa = reglasFin.tasa_diaria * diasFinCapa;
      const intNetoCapa = Math.round(pendiente * tasaNetaCapa * 100) / 100;
      const ivaIntCapa = Math.round(intNetoCapa * 0.21 * 100) / 100;
      const intConIvaCapa = Math.round((intNetoCapa + ivaIntCapa) * 100) / 100;
      financiacionActivaTotalNeta = Math.round((financiacionActivaTotalNeta + intNetoCapa) * 100) / 100;
      financiacionActivaTotalIva = Math.round((financiacionActivaTotalIva + ivaIntCapa) * 100) / 100;
      financiacionActivaTotalConIva = Math.round((financiacionActivaTotalConIva + intConIvaCapa) * 100) / 100;
    }

    if (creditoRestante <= 0.005) continue;

    if (!aplicaFinanciacion) {
      const aplicar = Math.min(pendiente, creditoRestante);
      pendiente = Math.round((pendiente - aplicar) * 100) / 100;
      creditoRestante = Math.round((creditoRestante - aplicar) * 100) / 100;
      capitalCanceladoTotal = Math.round((capitalCanceladoTotal + aplicar) * 100) / 100;

      detallesComprobantes.push({
        debito_mov_id: capa.mov_id,
        comprobante_id: capa.comprobante_id,
        comprobante_descripcion: capa.descripcion,
        dias_al_pago: diasAlPago,
        con_financiacion: false,
        monto_total_aplicado: Math.round(aplicar * 100) / 100,
        capital_cancelado: Math.round(aplicar * 100) / 100,
        financiacion_neta_cancelada: 0,
        financiacion_iva_cancelada: 0,
        financiacion_con_iva_cancelada: 0,
        capital_remanente_comprobante: pendiente
      });
    } else {
      const diasFin = Math.max(1, diasAlPago);
      const tasaNeta = reglasFin.tasa_diaria * diasFin;
      const factorIva = 1 + ((reglasFin.iva_porcentaje || 21) / 100);
      const tasaConIva = tasaNeta * factorIva;

      const intNetoTotalCapa = Math.round(pendiente * tasaNeta * 100) / 100;
      const ivaIntTotalCapa = Math.round(intNetoTotalCapa * 0.21 * 100) / 100;
      const intConIvaTotalCapa = Math.round((intNetoTotalCapa + ivaIntTotalCapa) * 100) / 100;
      const totalExigibleCapa = Math.round((pendiente + intConIvaTotalCapa) * 100) / 100;

      let montoAplicado = 0;
      let capitalCancelado = 0;
      let intNetoCancelado = 0;
      let ivaIntCancelado = 0;
      let intConIvaCancelado = 0;

      if (creditoRestante < totalExigibleCapa - 0.01) {
        montoAplicado = Math.round(creditoRestante * 100) / 100;
        capitalCancelado = Math.round((montoAplicado / (1 + tasaConIva)) * 100) / 100;
        intConIvaCancelado = Math.round((montoAplicado - capitalCancelado) * 100) / 100;
        intNetoCancelado = Math.round(capitalCancelado * tasaNeta * 100) / 100;
        ivaIntCancelado = Math.round((intConIvaCancelado - intNetoCancelado) * 100) / 100;
        pendiente = Math.round((pendiente - capitalCancelado) * 100) / 100;
        creditoRestante = 0;
      } else {
        capitalCancelado = pendiente;
        intNetoCancelado = intNetoTotalCapa;
        ivaIntCancelado = ivaIntTotalCapa;
        intConIvaCancelado = intConIvaTotalCapa;
        montoAplicado = totalExigibleCapa;
        pendiente = 0;
        creditoRestante = Math.round(Math.max(0, creditoRestante - montoAplicado) * 100) / 100;
      }

      capitalCanceladoTotal = Math.round((capitalCanceladoTotal + capitalCancelado) * 100) / 100;
      financiacionNetaCancelada = Math.round((financiacionNetaCancelada + intNetoCancelado) * 100) / 100;
      financiacionIvaCancelada = Math.round((financiacionIvaCancelada + ivaIntCancelado) * 100) / 100;
      financiacionConIvaCancelada = Math.round((financiacionConIvaCancelada + intConIvaCancelado) * 100) / 100;

      detallesComprobantes.push({
        debito_mov_id: capa.mov_id,
        comprobante_id: capa.comprobante_id,
        comprobante_descripcion: capa.descripcion,
        dias_al_pago: diasFin,
        tasa_tem: reglasFin.tasa_servicio_financiero,
        tasa_neta_pct: Math.round(tasaNeta * 10000) / 100,
        con_financiacion: true,
        monto_total_aplicado: montoAplicado,
        capital_cancelado: capitalCancelado,
        financiacion_neta_cancelada: intNetoCancelado,
        financiacion_iva_cancelada: ivaIntCancelado,
        financiacion_con_iva_cancelada: intConIvaCancelado,
        financiacion_total_capa_con_iva: intConIvaTotalCapa,
        financiacion_total_capa_neta: intNetoTotalCapa,
        financiacion_total_capa_iva: ivaIntTotalCapa,
        capital_remanente_comprobante: pendiente
      });
    }
  }

  // Si aún queda crédito a favor tras cancelar toda la deuda, suma a capital/saldo a favor
  if (creditoRestante > 0.005) {
    capitalCanceladoTotal = Math.round((capitalCanceladoTotal + creditoRestante) * 100) / 100;
  }

  const saldoCapitalActual = Math.round((parseFloat(comp.saldo_actual) || 0) * 100) / 100;
  const montoNum = Math.round((parseFloat(montoPago) || 0) * 100) / 100;

  return {
    cuenta_id: comp.cuenta_id,
    codigo_cliente: comp.codigo,
    cliente: comp.cliente,
    saldo_capital_actual: saldoCapitalActual,
    financiacion_activa_neta: financiacionActivaTotalNeta,
    financiacion_activa_iva: financiacionActivaTotalIva,
    financiacion_activa_con_iva: financiacionActivaTotalConIva,
    saldo_total_con_financiacion_actual: Math.round((saldoCapitalActual + financiacionActivaTotalConIva) * 100) / 100,
    financiacion_historica_bonificada_total: comp.financiacion_historica_bonificada_total || 0,
    queda_en_cero_bonificando_financiacion: Boolean(financiacionActivaTotalConIva > 0 && Math.abs(montoNum - saldoCapitalActual) <= 5),
    monto_pago_total: montoNum,
    capital_cancelado_total: capitalCanceladoTotal,
    financiacion_neta_cancelada: financiacionNetaCancelada,
    financiacion_iva_cancelada: financiacionIvaCancelada,
    financiacion_con_iva_cancelada: financiacionConIvaCancelada,
    tiene_financiacion_imputada: financiacionConIvaCancelada > 0,
    detalles_comprobantes: detallesComprobantes
  };
}

module.exports = {
  calcularComposicionSaldo,
  simularImputacionPago,
  resolverPuntoCero
};
