/**
 * Servicio de Asistencia Financiera y Financiación Automática ("Servicio Salvavidas")
 * Módulo: Logística / Cuentas Corrientes Búnker (Fase 1: Modo Sombra / Simulación en Paralelo)
 * 
 * Filosofía: Erradicación absoluta de conceptos de mora, atraso o multa.
 * Si el plazo transcurre sin acreditación, el sistema interpreta una SOLICITUD IMPLÍCITA DE ASISTENCIA
 * FINANCIERA, ante la cual LAMDA interviene prestando contención para no interrumpir el flujo comercial.
 * 
 * Esquema de 3 Ventanas Temporales:
 * 1. Ventana 1 (Días 1 a 7): Margen Operativo Estándar (Medios habituales, 0% cargo).
 * 2. Ventana 2 (Días 8 a 14): Ventana de Asistencia de Cortesía (Solicitud potencial bonificada al 100% si abona en la semana).
 * 3. Ventana 3 (Día 15 en adelante): Prestación Formal de Asistencia Financiera (LAMDA banca al cliente y devenga tasa diaria sobre saldo asistido).
 */

const { pool } = require('../config/database');
try { delete require.cache[require.resolve('./composicionSaldoService')]; } catch (_) {}
const composicionSaldoService = require('./composicionSaldoService');

/**
 * Obtener la configuración global activa del Servicio de Asistencia Financiera
 * @param {Object} db - Pool o cliente de base de datos
 */
async function obtenerConfiguracionGlobal(db = pool) {
    const res = await db.query(
        `SELECT id, nombre, dias_ventana_estandar, dias_gracia_estandar, dias_ventana_cortesia,
                cupo_cortesias_anual, tasa_servicio_financiero, tasa_efectiva_mensual_base, tasa_nominal_anual_referencia,
                modo_calculo, modo_sistema, descripcion_servicio, descripcion_facturacion, activo
         FROM public.bunker_financiacion_config
         WHERE activo = TRUE
         ORDER BY id ASC LIMIT 1`
    );

    if (res.rows.length === 0) {
        return {
            id: 1,
            nombre: 'Configuración Estándar LAMDA',
            dias_ventana_estandar: 7,
            dias_gracia_natural: 3,
            dias_tope_sin_comodin: 10,
            dias_ventana_cortesia: 7,
            cupo_cortesias_anual: 3,
            tasa_servicio_financiero: 3.000,
            tasa_efectiva_mensual_base: 3.000,
            tasa_nominal_anual_referencia: 36.500,
            iva_porcentaje: 21.0,
            modo_calculo: 'LINEAL',
            modo_sistema: 'SOMBRA',
            descripcion_servicio: 'Servicio de Asistencia Financiera LAMDA - Contención y Acompañamiento',
            descripcion_facturacion: 'Servicio de Asistencia Financiera - Prórroga Asistida',
            activo: true
        };
    }

    const r = res.rows[0];
    const tasaFinanciera = parseFloat(r.tasa_servicio_financiero || r.tasa_efectiva_mensual_base) || 3.0;
    const diasEst = parseInt(r.dias_ventana_estandar) || 7;
    const diasGraciaNat = parseInt(r.dias_gracia_estandar) || 3;
    const diasCort = parseInt(r.dias_ventana_cortesia) || 7;
    return {
        ...r,
        dias_ventana_estandar: diasEst,
        dias_gracia_natural: diasGraciaNat,
        dias_tope_sin_comodin: diasEst + diasGraciaNat,
        dias_ventana_cortesia: diasCort,
        cupo_cortesias_anual: parseInt(r.cupo_cortesias_anual) || 3,
        tasa_servicio_financiero: tasaFinanciera,
        tasa_efectiva_mensual_base: tasaFinanciera,
        tasa_nominal_anual_referencia: parseFloat(r.tasa_nominal_anual_referencia) || 36.5,
        iva_porcentaje: 21.0
    };
}

/**
 * Resuelve la jerarquía de reglas de asistencia financiera para un cliente:
 * 1. Nivel Cliente (Excepciones comerciales / Tarifas a medida / Exclusiones)
 * 2. Nivel Lista de Precios (Parámetros comerciales por segmento)
 * 3. Nivel Global (Estándar de Asistencia LAMDA)
 * 
 * @param {string} codigoBunkerCliente - Código del cliente (ej: 'CB-0001')
 * @param {Object} db - Pool o cliente de base de datos
 */
async function resolverReglasFinanciacion(codigoBunkerCliente, db = pool) {
    const configGlobal = await obtenerConfiguracionGlobal(db);

    const queryCliente = `
        SELECT c.id as cliente_id, c.codigo_bunker_cliente, c.cliente_nombre, c.razon_social,
               c.salvavidas_modo, c.salvavidas_tasa_tem, c.salvavidas_dias_estandar, c.salvavidas_dias_cortesia,
               c.salvavidas_dias_gracia, c.salvavidas_motivo_excepcion,
               COALESCE(c.salvavidas_cupo_cortesias_anual, 3) as cupo_cortesias_anual,
               COALESCE(c.salvavidas_cortesias_usadas_anio, 0) as cortesias_usadas_anio,
               COALESCE(c.salvavidas_cortesias_anio, EXTRACT(YEAR FROM CURRENT_DATE)::INT) as cortesias_anio,
               lp.id as lista_precio_id, lp.nombre as lista_nombre,
               lp.salvavidas_habilitado as lista_salvavidas_habilitado,
               lp.salvavidas_tasa_tem as lista_salvavidas_tasa_tem,
               lp.salvavidas_dias_estandar as lista_salvavidas_dias_estandar,
               lp.salvavidas_dias_cortesia as lista_salvavidas_dias_cortesia
        FROM public.bunker_clientes c
        LEFT JOIN public.bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = c.id
        LEFT JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
        WHERE c.codigo_bunker_cliente = $1
        LIMIT 1
    `;
    const resCli = await db.query(queryCliente, [codigoBunkerCliente]);

    if (resCli.rows.length === 0) {
        const tasa = configGlobal.tasa_servicio_financiero;
        const vEst = configGlobal.dias_ventana_estandar;
        const vGraciaNat = configGlobal.dias_gracia_natural || 3;
        const vCort = configGlobal.dias_ventana_cortesia;
        return {
            habilitado: true,
            salvavidas_modo: 'GLOBAL_DEFAULT',
            dias_ventana_estandar: vEst,
            dias_gracia_natural: vGraciaNat,
            dias_tope_sin_comodin: vEst + vGraciaNat,
            dias_ventana_cortesia: vCort,
            dias_total_cortesia: vEst + vCort,
            cupo_cortesias_anual: 3,
            cortesias_usadas_anio: 0,
            cortesias_disponibles_anio: 3,
            tasa_servicio_financiero: tasa,
            tasa_tem: tasa,
            tasa_diaria: parseFloat((tasa / 30 / 100).toFixed(6)),
            iva_porcentaje: 21,
            modo_calculo: configGlobal.modo_calculo,
            modo_sistema: configGlobal.modo_sistema,
            origen_regla: 'GLOBAL',
            motivo_excepcion: null,
            lista_nombre: 'Sin Lista Asignada'
        };
    }

    const c = resCli.rows[0];
    const anioActual = new Date().getFullYear();
    const cupoAnual = parseInt(c.cupo_cortesias_anual ?? 3);
    const usadasAnio = (parseInt(c.cortesias_anio) === anioActual) ? parseInt(c.cortesias_usadas_anio || 0) : 0;
    const disponiblesAnio = Math.max(0, cupoAnual - usadasAnio);
    const vGraciaNatFinal = (c.salvavidas_dias_gracia !== null && !isNaN(parseInt(c.salvavidas_dias_gracia)))
        ? parseInt(c.salvavidas_dias_gracia)
        : (configGlobal.dias_gracia_natural || 3);

    // 1. Caso EXCLUIDO a nivel cliente (Acuerdo de contención especial sin cargo)
    if (c.salvavidas_modo === 'EXCLUIDO') {
        const vEst = c.salvavidas_dias_estandar || configGlobal.dias_ventana_estandar;
        const vCort = c.salvavidas_dias_cortesia || configGlobal.dias_ventana_cortesia;
        return {
            habilitado: false,
            salvavidas_modo: 'EXCLUIDO',
            modo_switch: 'EXCLUIDO',
            dias_ventana_estandar: vEst,
            dias_gracia_natural: vGraciaNatFinal,
            dias_tope_sin_comodin: vEst + vGraciaNatFinal,
            dias_ventana_cortesia: vCort,
            dias_total_cortesia: vEst + vCort,
            cupo_cortesias_anual: cupoAnual,
            cortesias_usadas_anio: usadasAnio,
            cortesias_disponibles_anio: disponiblesAnio,
            tasa_servicio_financiero: 0,
            tasa_tem: 0,
            tasa_diaria: 0,
            tasa_referencia_tem: configGlobal.tasa_servicio_financiero || 3.0,
            iva_porcentaje: 21,
            modo_calculo: configGlobal.modo_calculo,
            modo_sistema: 'EXCLUIDO',
            origen_regla: 'CLIENTE_EXCLUIDO',
            motivo_excepcion: c.salvavidas_motivo_excepcion || 'Acuerdo comercial de contención especial con la dirección',
            lista_nombre: c.lista_nombre || 'Estándar'
        };
    }

    // 2. Si la lista de precios desactiva el servicio
    if (c.salvavidas_modo === 'HEREDAR_LISTA' && c.lista_salvavidas_habilitado === false) {
        const vEst = configGlobal.dias_ventana_estandar;
        const vCort = configGlobal.dias_ventana_cortesia;
        return {
            habilitado: false,
            salvavidas_modo: 'HEREDAR_LISTA',
            modo_switch: 'EXCLUIDO',
            dias_ventana_estandar: vEst,
            dias_gracia_natural: vGraciaNatFinal,
            dias_tope_sin_comodin: vEst + vGraciaNatFinal,
            dias_ventana_cortesia: vCort,
            dias_total_cortesia: vEst + vCort,
            cupo_cortesias_anual: cupoAnual,
            cortesias_usadas_anio: usadasAnio,
            cortesias_disponibles_anio: disponiblesAnio,
            tasa_servicio_financiero: 0,
            tasa_tem: 0,
            tasa_diaria: 0,
            tasa_referencia_tem: configGlobal.tasa_servicio_financiero || 3.0,
            iva_porcentaje: 21,
            modo_calculo: configGlobal.modo_calculo,
            modo_sistema: 'EXCLUIDO',
            origen_regla: 'LISTA_DESHABILITADA',
            motivo_excepcion: `Lista de precios ${c.lista_nombre || ''} exenta del servicio`,
            lista_nombre: c.lista_nombre || 'Estándar'
        };
    }

    // 3. Resolución en cascada de Ventana Estándar (Días 1 a 7)
    let vEstFinal = configGlobal.dias_ventana_estandar;
    let origenEst = 'GLOBAL';
    if (c.salvavidas_dias_estandar !== null && !isNaN(parseInt(c.salvavidas_dias_estandar))) {
        vEstFinal = parseInt(c.salvavidas_dias_estandar);
        origenEst = 'CLIENTE';
    } else if (c.lista_salvavidas_dias_estandar !== null && !isNaN(parseInt(c.lista_salvavidas_dias_estandar))) {
        vEstFinal = parseInt(c.lista_salvavidas_dias_estandar);
        origenEst = 'LISTA';
    }

    // 4. Resolución en cascada de Ventana de Cortesía (Días 8 a 14: 3 días gracia natural + 4 días comodín)
    let vCortFinal = configGlobal.dias_ventana_cortesia;
    let origenCort = 'GLOBAL';
    if (c.salvavidas_dias_cortesia !== null && !isNaN(parseInt(c.salvavidas_dias_cortesia))) {
        vCortFinal = parseInt(c.salvavidas_dias_cortesia);
        origenCort = 'CLIENTE';
    } else if (c.lista_salvavidas_dias_cortesia !== null && !isNaN(parseInt(c.lista_salvavidas_dias_cortesia))) {
        vCortFinal = parseInt(c.lista_salvavidas_dias_cortesia);
        origenCort = 'LISTA';
    }

    // 5. Resolución en cascada de Tasa de Asistencia Financiera (TEM)
    let tasaFinal = configGlobal.tasa_servicio_financiero;
    let origenTasa = 'GLOBAL';
    if (c.salvavidas_tasa_tem !== null && !isNaN(parseFloat(c.salvavidas_tasa_tem))) {
        tasaFinal = parseFloat(c.salvavidas_tasa_tem);
        origenTasa = 'CLIENTE';
    } else if (c.lista_salvavidas_tasa_tem !== null && !isNaN(parseFloat(c.lista_salvavidas_tasa_tem))) {
        tasaFinal = parseFloat(c.lista_salvavidas_tasa_tem);
        origenTasa = 'LISTA';
    }

    const tasaDiaria = parseFloat((tasaFinal / 30 / 100).toFixed(6));
    const totalCortesia = vEstFinal + vCortFinal;

    const rawModo = String(c.salvavidas_modo || 'HEREDAR_LISTA').toUpperCase();
    let modoSwitch = 'SOMBRA';
    if (rawModo === 'ACTIVO' || rawModo === 'HABILITADO') {
        modoSwitch = 'ACTIVO';
    } else if (rawModo === 'SOMBRA') {
        modoSwitch = 'SOMBRA';
    } else if (configGlobal.modo_sistema === 'ACTIVO') {
        modoSwitch = 'ACTIVO';
    }

    return {
        habilitado: true,
        salvavidas_modo: c.salvavidas_modo || 'HEREDAR_LISTA',
        modo_switch: modoSwitch,
        dias_ventana_estandar: vEstFinal,
        dias_gracia_natural: vGraciaNatFinal,
        dias_tope_sin_comodin: vEstFinal + vGraciaNatFinal,
        dias_ventana_cortesia: vCortFinal,
        dias_total_cortesia: totalCortesia,
        cupo_cortesias_anual: cupoAnual,
        cortesias_usadas_anio: usadasAnio,
        cortesias_disponibles_anio: disponiblesAnio,
        tasa_servicio_financiero: tasaFinal,
        tasa_tem: tasaFinal,
        tasa_diaria: tasaDiaria,
        iva_porcentaje: 21,
        modo_calculo: configGlobal.modo_calculo,
        modo_sistema: modoSwitch,
        origen_regla: origenTasa === 'CLIENTE' || origenEst === 'CLIENTE' || origenCort === 'CLIENTE' ? 'CLIENTE' : (origenTasa === 'LISTA' || origenEst === 'LISTA' || origenCort === 'LISTA' ? 'LISTA' : 'GLOBAL'),
        motivo_excepcion: c.salvavidas_motivo_excepcion,
        lista_nombre: c.lista_nombre || 'Estándar'
    };
}

/**
 * Calcula la simulación de asistencia financiera en modo sombra para una cuenta corriente.
 * Aplica el esquema de 4 etapas operativas (Días 1-7 Compromiso, Días 8-10 Gracia Natural +3d,
 * Días 11-14 Comodín Trimestral, Día 15+ Salvavidas de Financiación 3% + IVA).
 * 
 * @param {number} cuentaId - ID de la cuenta corriente
 * @param {Object} [opciones] - Opciones de cálculo (ej: { persistir_sombra: true })
 * @param {Object} [db] - Pool o cliente de base de datos
 */
async function calcularSimulacionCuenta(cuentaId, opciones = {}, db = pool) {
    // 1. Obtener composición de saldo mediante FIFO determinista
    const comp = await composicionSaldoService.calcularComposicionSaldo(cuentaId, db);
    if (!comp) return null;

    const saldoActual = comp.saldo_actual || 0;
    const reglas = await resolverReglasFinanciacion(comp.codigo, db);
    const comprobantesCancelados = comp.comprobantes_cancelados || [];

    // Cruzar historial de comodines usados en el año calendario desde el motor FIFO (días 11 a 14)
    const anioActual = new Date().getFullYear();
    const comodinesHistorial = comprobantesCancelados.filter(cc => {
        if (!cc.uso_comodin) return false;
        const fCanc = cc.fecha_cancelacion ? new Date(cc.fecha_cancelacion) : null;
        return !fCanc || fCanc.getFullYear() === anioActual;
    });

    if (reglas.habilitado) {
        const usadasEfectivas = Math.max(reglas.cortesias_usadas_anio || 0, comodinesHistorial.length);
        reglas.cortesias_usadas_anio = usadasEfectivas;
        reglas.cortesias_disponibles_anio = Math.max(0, (reglas.cupo_cortesias_anual || 3) - usadasEfectivas);
        reglas.comodines_historial = comodinesHistorial;
    }

    // Si la cuenta está al día o registra saldo a favor
    if (saldoActual <= 0.005 || !comp.capas || comp.capas.length === 0) {
        return {
            cuenta_id: comp.cuenta_id,
            codigo_cliente: comp.codigo,
            cliente_nombre: comp.cliente,
            saldo_contable_real: saldoActual,
            financiacion_total: 0.00,
            financiacion_iva: 0.00,
            financiacion_total_con_iva: 0.00,
            saldo_total_proyectado: saldoActual,
            saldo_total_proyectado_con_iva: saldoActual,
            comprobantes_margen_estandar: 0,
            comprobantes_gracia_natural: 0,
            comprobantes_cortesia: 0,
            comprobantes_asistencia_formalizada: 0,
            reglas_aplicadas: { ...reglas, estado: 'AL_DIA' },
            capas_simuladas: [],
            comprobantes_cancelados: comprobantesCancelados,
            comodines_historial: comodinesHistorial,
            texto_whatsapp_salvavidas: '',
            texto_pdf_salvavidas: ''
        };
    }

    // Si el cliente está comercialmente exento (EXCLUIDO / Apagado), igual calculamos la referencia potencial
    // para que el operador pueda alternar el switch (Apagado / Sombra / Activo) en tiempo real sin perder el monto de referencia.
    if (!reglas.habilitado) {
        const tasaRefTem = reglas.tasa_referencia_tem || 3.0;
        const tasaRefDiaria = parseFloat((tasaRefTem / 30 / 100).toFixed(6));
        const diasTopeComRef = reglas.dias_total_cortesia || 14;
        const comodinesDispRef = reglas.cortesias_disponibles_anio !== undefined ? reglas.cortesias_disponibles_anio : 3;
        const diasTopeSinComRef = reglas.dias_tope_sin_comodin || 10;

        let potNeto = 0;
        let potIva = 0;
        let potConIva = 0;
        let potFormalizadas = 0;
        for (const c of comp.capas) {
            const dTot = c.antiguedad_dias;
            const dReloj = Math.max(1, dTot);
            const cap = c.monto_pendiente;
            const SuperaTope = dTot > diasTopeComRef || (dTot > diasTopeSinComRef && comodinesDispRef <= 0);
            if (SuperaTope) {
                const intN = parseFloat((cap * tasaRefDiaria * dReloj).toFixed(2));
                const intV = parseFloat((intN * 0.21).toFixed(2));
                potNeto += intN;
                potIva += intV;
                potConIva += parseFloat((intN + intV).toFixed(2));
                potFormalizadas++;
            }
        }
        potNeto = parseFloat(potNeto.toFixed(2));
        potIva = parseFloat(potIva.toFixed(2));
        potConIva = parseFloat(potConIva.toFixed(2));

        return {
            cuenta_id: comp.cuenta_id,
            codigo_cliente: comp.codigo,
            cliente_nombre: comp.cliente,
            saldo_contable_real: saldoActual,
            financiacion_total: 0.00,
            financiacion_neta_total: 0.00,
            financiacion_iva: 0.00,
            financiacion_iva_total: 0.00,
            financiacion_total_con_iva: 0.00,
            financiacion_calculada_neta: potNeto,
            financiacion_calculada_iva: potIva,
            financiacion_calculada_con_iva: potConIva,
            comprobantes_potenciales_formalizados: potFormalizadas,
            saldo_total_proyectado: saldoActual,
            saldo_total_proyectado_con_iva: saldoActual,
            comprobantes_margen_estandar: comp.capas.length,
            comprobantes_gracia_natural: 0,
            comprobantes_cortesia: 0,
            comprobantes_asistencia_formalizada: 0,
            estado_general: 'EXCLUIDO',
            reglas_aplicadas: reglas,
            capas_simuladas: comp.capas.map(c => ({
                ...c,
                capital_pendiente: c.monto_pendiente,
                monto_pendiente: c.monto_pendiente,
                ventana_codigo: 'EXCEPCION_COMERCIAL',
                ventana_nombre: 'Acuerdo Especial / Contención Exenta',
                icono: '⭐',
                dias_asistencia_efectiva: 0,
                interes_financiacion: 0.00,
                iva_financiacion: 0.00,
                interes_financiacion_con_iva: 0.00,
                saldo_proyectado: c.monto_pendiente,
                saldo_proyectado_con_iva: c.monto_pendiente,
                estado_texto: 'Acuerdo Comercial Especial (0% de cargo financiero)'
            })),
            comprobantes_cancelados: comprobantesCancelados,
            comodines_historial: comodinesHistorial,
            texto_whatsapp_salvavidas: '',
            texto_pdf_salvavidas: ''
        };
    }

    // 3. Evaluar cada capa impaga en el esquema de 4 Etapas Temporales
    let financiacionTotalDevengada = 0;
    let financiacionIvaTotal = 0;
    let financiacionTotalConIva = 0;
    let financiacionCortesiaProyectada = 0;
    const capasSimuladas = [];

    let countEstandar = 0;
    let countGraciaNatural = 0;
    let countCortesia = 0;
    let countFormalizada = 0;

    const diasEst = reglas.dias_ventana_estandar || 7;
    const diasGraciaNat = reglas.dias_gracia_natural || 3;
    const diasTopeSinComodin = reglas.dias_tope_sin_comodin || (diasEst + diasGraciaNat);
    const diasTopeComodin = reglas.dias_total_cortesia || 14;

    for (const c of comp.capas) {
        const diasTotales = c.antiguedad_dias;
        const diasRelojDesdeDia1 = Math.max(1, diasTotales);
        const capitalPendiente = c.monto_pendiente;

        // El reloj de interés corre desde el Día 1 de entregada la mercadería
        const interesDesdeDia1Lineal = parseFloat((capitalPendiente * reglas.tasa_diaria * diasRelojDesdeDia1).toFixed(2));
        const interesDesdeDia1Compuesto = parseFloat((capitalPendiente * (Math.pow(1 + (reglas.tasa_servicio_financiero / 100), diasRelojDesdeDia1 / 30) - 1)).toFixed(2));
        const interesAcumuladoDesdeDia1 = reglas.modo_calculo === 'COMPUESTO' ? interesDesdeDia1Compuesto : interesDesdeDia1Lineal;

        let ventanaCodigo = 'MARGEN_ESTANDAR';
        let ventanaNombre = 'Plazo Habitual (Días 1 a 7)';
        let ventanaDescripcion = 'Dentro del compromiso habitual de pago (7 días). 0% de financiación y sin uso de comodín.';
        let iconoVentana = '🟢';
        let diasAsistenciaEfectiva = 0;
        let interesDevengado = 0;
        let interesProyectadoCortesia = 0;

        if (diasTotales <= diasEst) {
            // --- ETAPA 1: DÍAS 1 A 7 (Compromiso Habitual del Cliente — 0% Financiación, Sin Comodín) ---
            ventanaCodigo = 'MARGEN_ESTANDAR';
            ventanaNombre = `Compromiso Habitual (Días 1 a ${diasEst})`;
            ventanaDescripcion = `Día ${diasTotales} de ${diasEst} (Compromiso habitual). 0% de financiación y sin uso de comodín.`;
            iconoVentana = '🟢';
            countEstandar++;
            interesProyectadoCortesia = interesAcumuladoDesdeDia1;
            financiacionCortesiaProyectada += interesProyectadoCortesia;

        } else if (diasTotales <= diasTopeSinComodin) {
            // --- ETAPA 2: DÍAS 8 A 10 (+3 Días de Gracia Naturales — 0% Financiación y SIN Usar Comodín) ---
            ventanaCodigo = 'GRACIA_NATURAL';
            ventanaNombre = `+${diasGraciaNat} Días de Gracia Naturales (Días ${diasEst + 1} a ${diasTopeSinComodin})`;
            ventanaDescripcion = `Día ${diasTotales} de ${diasTopeSinComodin}. Dentro de los +${diasGraciaNat} días de gracia naturales (demoras bancarias / viernes a lunes): 0% de financiación y NO consume comodín trimestral.`;
            iconoVentana = '⏳';
            countGraciaNatural++;
            countEstandar++;
            interesProyectadoCortesia = interesAcumuladoDesdeDia1;
            financiacionCortesiaProyectada += interesProyectadoCortesia;

        } else if (diasTotales <= diasTopeComodin && (reglas.cortesias_disponibles_anio === undefined || reglas.cortesias_disponibles_anio > 0)) {
            // --- ETAPA 3: DÍAS 11 A 14 (Uso de Comodín Trimestral: 1 cada 3 meses / 3 al año — 0% Financiación) ---
            ventanaCodigo = 'ASISTENCIA_CORTESIA';
            ventanaNombre = `Comodín Trimestral (Días ${diasTopeSinComodin + 1} a ${diasTopeComodin})`;
            const comodinesRest = reglas.cortesias_disponibles_anio ?? 3;
            const cupoTotal = reglas.cupo_cortesias_anual ?? 3;
            ventanaDescripcion = `Día ${diasTotales} de ${diasTopeComodin}. Cubierto por Comodín Trimestral (${comodinesRest}/${cupoTotal} disponibles en el año): 0% de financiación abonando hasta el día ${diasTopeComodin}.`;
            iconoVentana = '🎟️';
            countCortesia++;

            interesProyectadoCortesia = interesAcumuladoDesdeDia1;
            financiacionCortesiaProyectada += interesProyectadoCortesia;

        } else {
            // --- ETAPA 4: DÍA 15 EN ADELANTE (o Día 11+ si ya usó el Comodín del trimestre / agotó cupo) ---
            ventanaCodigo = 'ASISTENCIA_FORMALIZADA';
            ventanaNombre = `Salvavidas de Financiación Activo (${reglas.tasa_servicio_financiero}% + IVA)`;
            diasAsistenciaEfectiva = diasRelojDesdeDia1; // Computado desde el Día 1 de entrega sobre saldo pendiente
            const motivoActivacion = (diasTotales <= diasTopeComodin && reglas.cortesias_disponibles_anio <= 0)
                ? `Sin comodines trimestrales disponibles (0/${reglas.cupo_cortesias_anual || 3})`
                : `Plazo de ${diasTopeComodin} días superado (7d compromiso + 3d gracia natural + 4d comodín)`;
            ventanaDescripcion = `${motivoActivacion}. Salvavidas activo computado desde el Día 1 de entrega (${diasAsistenciaEfectiva} días al ${reglas.tasa_servicio_financiero}% mensual + IVA sobre saldo pendiente).`;
            iconoVentana = '🛡️';
            countFormalizada++;

            interesDevengado = interesAcumuladoDesdeDia1;
            financiacionTotalDevengada += interesDevengado;
        }

        const ivaDevengado = parseFloat((interesDevengado * 0.21).toFixed(2));
        const interesConIva = parseFloat((interesDevengado + ivaDevengado).toFixed(2));
        const saldoProyectadoCapa = parseFloat((capitalPendiente + interesDevengado).toFixed(2));
        const saldoProyectadoCapaConIva = parseFloat((capitalPendiente + interesConIva).toFixed(2));
        const costoDiarioNeto = parseFloat((capitalPendiente * reglas.tasa_diaria).toFixed(2));
        const costoDiarioConIva = parseFloat((costoDiarioNeto * 1.21).toFixed(2));

        financiacionIvaTotal += ivaDevengado;
        financiacionTotalConIva += interesConIva;

        capasSimuladas.push({
            mov_id: c.mov_id,
            comprobante_id: c.comprobante_id,
            descripcion: c.descripcion,
            tipo_comprobante: c.tipo_comprobante,
            punto_cero: c.punto_cero,
            fecha_vto_compromiso: c.fecha_vto_compromiso,
            fecha_vto_gracia_natural: c.fecha_vto_gracia_natural,
            fecha_vto_comodin: c.fecha_vto_comodin,
            canal_logistico: c.canal_logistico,
            antiguedad_dias: diasTotales,
            antiguedad_horas: c.antiguedad_horas,
            monto_original: c.monto_original,
            monto_pagado: c.capital_pagado ?? c.monto_pagado ?? 0,
            capital_pagado: c.capital_pagado ?? 0,
            financiacion_pagada_neta: c.financiacion_pagada_neta ?? 0,
            financiacion_pagada_iva: c.financiacion_pagada_iva ?? 0,
            financiacion_pagada_con_iva: c.financiacion_pagada_con_iva ?? 0,
            pagos_aplicados: c.pagos_aplicados || [],
            capital_pendiente: capitalPendiente,
            monto_pendiente: capitalPendiente,
            porcentaje_impago: c.porcentaje_impago ?? 100,
            ventana_codigo: ventanaCodigo,
            ventana_nombre: ventanaNombre,
            ventana_descripcion: ventanaDescripcion,
            icono: iconoVentana,
            dias_asistencia_efectiva: diasAsistenciaEfectiva,
            dias_reloj_desde_dia_1: diasRelojDesdeDia1,
            interes_acumulado_desde_dia_1: interesAcumuladoDesdeDia1,
            dias_ventana_estandar: diasEst,
            dias_gracia_natural: diasGraciaNat,
            dias_tope_sin_comodin: diasTopeSinComodin,
            dias_ventana_cortesia: reglas.dias_ventana_cortesia,
            dias_total_cortesia: diasTopeComodin,
            cupo_cortesias_anual: reglas.cupo_cortesias_anual ?? 3,
            cortesias_usadas_anio: reglas.cortesias_usadas_anio ?? 0,
            cortesias_disponibles_anio: reglas.cortesias_disponibles_anio ?? 3,
            tasa_servicio_financiero: reglas.tasa_servicio_financiero,
            tasa_diaria: reglas.tasa_diaria,
            iva_porcentaje: 21,
            interes_financiacion: interesDevengado,
            iva_financiacion: ivaDevengado,
            interes_financiacion_con_iva: interesConIva,
            interes_proyectado_cortesia: interesProyectadoCortesia,
            costo_diario_neto: costoDiarioNeto,
            costo_diario_con_iva: costoDiarioConIva,
            saldo_proyectado: saldoProyectadoCapa,
            saldo_proyectado_con_iva: saldoProyectadoCapaConIva
        });
    }

    financiacionTotalDevengada = parseFloat(financiacionTotalDevengada.toFixed(2));
    financiacionIvaTotal = parseFloat(financiacionIvaTotal.toFixed(2));
    financiacionTotalConIva = parseFloat(financiacionTotalConIva.toFixed(2));
    financiacionCortesiaProyectada = parseFloat(financiacionCortesiaProyectada.toFixed(2));
    const saldoTotalAsistido = parseFloat((saldoActual + financiacionTotalDevengada).toFixed(2));
    const saldoTotalAsistidoConIva = parseFloat((saldoActual + financiacionTotalConIva).toFixed(2));

    // 4. Persistencia en auditoría sombra si se solicita
    if (opciones.persistir_sombra === true) {
        try {
            for (const cs of capasSimuladas) {
                await db.query(`
                    INSERT INTO public.factura_cc_salvavidas_simulaciones (
                        cuenta_corriente_id, codigo_bunker_cliente, movimiento_origen_id,
                        comprobante_descripcion, fecha_punto_cero, antiguedad_total_dias,
                        dias_gracia_aplicados, dias_financiados_efectivos, capital_base_impago,
                        tasa_tem_aplicada, tasa_diaria_aplicada, interes_financiacion_calculado,
                        saldo_proyectado_comprobante, estado_simulacion, ventana_actual,
                        dias_ventana_estandar, dias_ventana_cortesia, dias_asistencia_efectiva,
                        interes_proyectado_cortesia
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'SOMBRA', $14, $15, $16, $17, $18)
                `, [
                    cuentaId,
                    comp.codigo,
                    typeof cs.mov_id === 'number' ? cs.mov_id : null,
                    cs.descripcion,
                    cs.punto_cero,
                    cs.antiguedad_dias,
                    reglas.dias_total_cortesia,
                    cs.dias_asistencia_efectiva,
                    cs.capital_pendiente,
                    reglas.tasa_servicio_financiero,
                    reglas.tasa_diaria,
                    cs.interes_financiacion,
                    cs.saldo_proyectado,
                    cs.ventana_codigo,
                    reglas.dias_ventana_estandar,
                    reglas.dias_ventana_cortesia,
                    cs.dias_asistencia_efectiva,
                    cs.interes_proyectado_cortesia
                ]);
            }
        } catch (errPersist) {
            console.warn('⚠️ [ASISTENCIA-FINANCIERA] Error registrando auditoría sombra:', errPersist.message);
        }
    }

    // 5. Redacción de mensajes empáticos y constructivos
    const textoWhatsapp = construirTextoWhatsappAsistencia(capasSimuladas, reglas, financiacionTotalDevengada, financiacionIvaTotal, financiacionTotalConIva);
    const textoPdf = construirTextoPdfAsistencia(capasSimuladas, reglas, financiacionTotalDevengada, financiacionIvaTotal, financiacionTotalConIva);

    let estadoGeneral = 'EN_TERMINO';
    if (countFormalizada > 0) {
        estadoGeneral = 'ASISTENCIA_FORMALIZADA';
    } else if (countCortesia > 0) {
        estadoGeneral = 'ASISTENCIA_CORTESIA';
    } else if (countGraciaNatural > 0) {
        estadoGeneral = 'GRACIA_NATURAL';
    }

    return {
        cuenta_id: comp.cuenta_id,
        codigo_cliente: comp.codigo,
        cliente_nombre: comp.cliente,
        saldo_contable_real: saldoActual,
        saldo_contable_tabla: comp.saldo_contable_tabla ?? saldoActual,
        financiacion_cobrada_pendiente_facturar: comp.financiacion_cobrada_pendiente_facturar ?? 0,
        pagos_con_financiacion: comp.pagos_con_financiacion || [],
        imputaciones_por_movimiento: comp.imputaciones_por_movimiento || {},
        estado_general: estadoGeneral,
        financiacion_total: financiacionTotalDevengada,
        financiacion_neta_total: financiacionTotalDevengada,
        financiacion_iva: financiacionIvaTotal,
        financiacion_iva_total: financiacionIvaTotal,
        financiacion_total_con_iva: financiacionTotalConIva,
        financiacion_calculada_neta: financiacionTotalDevengada,
        financiacion_calculada_iva: financiacionIvaTotal,
        financiacion_calculada_con_iva: financiacionTotalConIva,
        financiacion_cortesia_bonificada: financiacionCortesiaProyectada,
        saldo_total_proyectado: saldoTotalAsistido,
        saldo_total_proyectado_con_iva: saldoTotalAsistidoConIva,
        comprobantes_margen_estandar: countEstandar,
        comprobantes_gracia_natural: countGraciaNatural,
        comprobantes_cortesia: countCortesia,
        comprobantes_asistencia_formalizada: countFormalizada,
        reglas_aplicadas: reglas,
        capas_simuladas: capasSimuladas,
        comprobantes_cancelados: comprobantesCancelados,
        comodines_historial: comodinesHistorial,
        texto_whatsapp_salvavidas: textoWhatsapp,
        texto_pdf_salvavidas: textoPdf
    };
}

let _cacheDashboardSombra = null; // { fingerprint, ts, payload }
const DASHBOARD_SOMBRA_TTL_MS = 120000;

async function _obtenerHuellaDashboardSombra(db = pool) {
    try {
        const r = await db.query(`
            SELECT
                TO_CHAR(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha_ar,
                (SELECT COUNT(*)::text || ':' || COALESCE(MAX(id)::text, '0') || ':' || COALESCE(SUM(COALESCE(monto, 0))::numeric(16,2)::text, '0') FROM public.factura_cuenta_corriente_movimientos) AS fp_movs,
                (SELECT COUNT(*)::text || ':' || COALESCE(SUM(COALESCE(saldo, 0))::numeric(16,2)::text, '0') FROM public.factura_cuentas_corrientes) AS fp_cc,
                (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text, '0') FROM public.bunker_clientes) AS fp_cli,
                (SELECT COALESCE(STRING_AGG(id::text || ':' || COALESCE(modo_sistema, '') || ':' || COALESCE(tasa_servicio_financiero::text, ''), ',' ORDER BY id), '') FROM public.bunker_financiacion_config) AS fp_cfg,
                (SELECT COUNT(*)::text || ':' || COALESCE(STRING_AGG(id::text || '=' || COALESCE(salvavidas_habilitado::text, ''), ',' ORDER BY id), '') FROM public.bunker_listas_precios) AS fp_lp
        `);
        const row = r.rows[0] || {};
        return `${row.fecha_ar}|${row.fp_movs}|${row.fp_cc}|${row.fp_cli}|${row.fp_cfg}|${row.fp_lp}`;
    } catch (_) {
        return null;
    }
}

/**
 * Genera el Dashboard de Métricas Sombra consolidado bajo el paradigma de 3 ventanas
 * y el mapa integral `clientes_financiacion_map` para la grilla de Gestión de Clientes Búnker.
 * @param {Object} db - Pool o cliente de base de datos
 */
async function obtenerDashboardMetricasSombra(db = pool) {
    const fingerprint = await _obtenerHuellaDashboardSombra(db);
    if (
        fingerprint &&
        _cacheDashboardSombra &&
        _cacheDashboardSombra.fingerprint === fingerprint &&
        (Date.now() - _cacheDashboardSombra.ts) < DASHBOARD_SOMBRA_TTL_MS
    ) {
        return _cacheDashboardSombra.payload;
    }

    const configGlobal = await obtenerConfiguracionGlobal(db);

    const queryClientes = `
        SELECT c.id as cliente_id, c.codigo_bunker_cliente, c.cliente_nombre, c.salvavidas_modo,
               cc.id as cuenta_id, COALESCE(cc.saldo, 0) as saldo,
               lp.salvavidas_habilitado as lista_salvavidas_habilitado
        FROM public.bunker_clientes c
        LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = c.codigo_bunker_cliente
        LEFT JOIN public.bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = c.id
        LEFT JOIN public.bunker_listas_precios lp ON lp.id = clp.bunker_lista_precio_id
        ORDER BY c.id ASC
    `;
    const resClientes = await db.query(queryClientes);

    const clientesUnicos = new Map();
    for (const row of resClientes.rows) {
        if (!clientesUnicos.has(row.codigo_bunker_cliente)) {
            clientesUnicos.set(row.codigo_bunker_cliente, row);
        }
    }

    let capitalTotalDeudaReal = 0;
    let asistenciaTotalDevengada = 0;
    let cortesiaTotalBonificada = 0;

    let totalFinanciacionActivaConIva = 0;
    let totalFinanciacionSombraConIva = 0;
    let countModoActivo = 0;
    let countModoSombra = 0;
    let countModoExcluido = 0;

    let totalCuentasAnalizadas = 0;
    let cuentasEnMargenEstandar = 0;
    let cuentasEnCortesia = 0;
    let cuentasEnAsistenciaFormalizada = 0;
    let cuentasExcluidas = 0;

    const desglosePorLista = {};
    const rankingClientesAsistidos = [];
    const clientesFinanciacionMap = {};
    const pendientesSimulacion = [];

    for (const cli of clientesUnicos.values()) {
        const rawModo = String(cli.salvavidas_modo || 'HEREDAR_LISTA').toUpperCase();
        let modoSwitch = 'SOMBRA';
        if (rawModo === 'EXCLUIDO' || (rawModo === 'HEREDAR_LISTA' && cli.lista_salvavidas_habilitado === false)) {
            modoSwitch = 'EXCLUIDO';
            countModoExcluido++;
        } else if (rawModo === 'ACTIVO' || rawModo === 'HABILITADO') {
            modoSwitch = 'ACTIVO';
            countModoActivo++;
        } else if (rawModo === 'SOMBRA') {
            modoSwitch = 'SOMBRA';
            countModoSombra++;
        } else if (configGlobal.modo_sistema === 'ACTIVO') {
            modoSwitch = 'ACTIVO';
            countModoActivo++;
        } else {
            modoSwitch = 'SOMBRA';
            countModoSombra++;
        }

        const saldoNum = parseFloat(cli.saldo || 0);
        if (saldoNum <= 0.005 || !cli.cuenta_id) {
            clientesFinanciacionMap[cli.codigo_bunker_cliente] = {
                codigo_bunker_cliente: cli.codigo_bunker_cliente,
                salvavidas_modo: cli.salvavidas_modo || 'HEREDAR_LISTA',
                modo_switch: modoSwitch,
                saldo_real: saldoNum,
                financiacion_calculada_neta: 0,
                financiacion_calculada_iva: 0,
                financiacion_calculada_con_iva: 0,
                financiacion_vigente_con_iva: 0,
                estado_general: saldoNum < -0.005 ? 'A_FAVOR' : 'AL_DIA',
                comprobantes_formalizados: 0,
                comprobantes_cortesia: 0,
                comprobantes_gracia_natural: 0,
                comprobantes_estandar: 0,
                dias_max_antiguedad: 0,
                comodines_disponibles: 3,
                comodines_max: 3
            };
            continue;
        }

        totalCuentasAnalizadas++;
        pendientesSimulacion.push({ cli, modoSwitch });
    }

    const BATCH_SIZE = 8;
    const resultadosSim = [];
    for (let i = 0; i < pendientesSimulacion.length; i += BATCH_SIZE) {
        const lote = pendientesSimulacion.slice(i, i + BATCH_SIZE);
        const simsLote = await Promise.all(
            lote.map(item => calcularSimulacionCuenta(item.cli.cuenta_id, { persistir_sombra: false }, db))
        );
        for (let j = 0; j < lote.length; j++) {
            resultadosSim.push({ ...lote[j], sim: simsLote[j] });
        }
    }

    for (const { cli, modoSwitch, sim } of resultadosSim) {
        if (!sim) continue;

        const calcNeta = Number(sim.financiacion_calculada_neta ?? sim.financiacion_total ?? 0);
        const calcIva = Number(sim.financiacion_calculada_iva ?? sim.financiacion_iva ?? 0);
        const calcConIva = Number(sim.financiacion_calculada_con_iva ?? sim.financiacion_total_con_iva ?? 0);

        const diasMax = Array.isArray(sim.capas_simuladas) && sim.capas_simuladas.length > 0
            ? Math.max(...sim.capas_simuladas.map(cp => Number(cp.antiguedad_dias || 0)))
            : 0;

        clientesFinanciacionMap[cli.codigo_bunker_cliente] = {
            codigo_bunker_cliente: cli.codigo_bunker_cliente,
            salvavidas_modo: cli.salvavidas_modo || 'HEREDAR_LISTA',
            modo_switch: modoSwitch,
            saldo_real: sim.saldo_contable_real,
            financiacion_calculada_neta: calcNeta,
            financiacion_calculada_iva: calcIva,
            financiacion_calculada_con_iva: calcConIva,
            financiacion_vigente_con_iva: modoSwitch === 'EXCLUIDO' ? 0 : calcConIva,
            estado_general: sim.estado_general,
            comprobantes_formalizados: sim.comprobantes_asistencia_formalizada || sim.comprobantes_potenciales_formalizados || 0,
            comprobantes_cortesia: sim.comprobantes_cortesia || 0,
            comprobantes_gracia_natural: sim.comprobantes_gracia_natural || 0,
            comprobantes_estandar: sim.comprobantes_margen_estandar || 0,
            dias_max_antiguedad: diasMax,
            comodines_disponibles: sim.reglas_aplicadas?.cortesias_disponibles_anio ?? 3,
            comodines_max: sim.reglas_aplicadas?.cupo_cortesias_anual ?? 3
        };

        if (modoSwitch === 'ACTIVO') {
            totalFinanciacionActivaConIva += calcConIva;
        } else if (modoSwitch === 'SOMBRA') {
            totalFinanciacionSombraConIva += calcConIva;
        }

        capitalTotalDeudaReal += sim.saldo_contable_real;
        asistenciaTotalDevengada += sim.financiacion_total;
        cortesiaTotalBonificada += (sim.financiacion_cortesia_bonificada || 0);

        if (sim.reglas_aplicadas && sim.reglas_aplicadas.habilitado === false) {
            cuentasExcluidas++;
        } else if (sim.comprobantes_asistencia_formalizada > 0) {
            cuentasEnAsistenciaFormalizada++;
        } else if (sim.comprobantes_cortesia > 0) {
            cuentasEnCortesia++;
        } else {
            cuentasEnMargenEstandar++;
        }

        const listaNom = (sim.reglas_aplicadas && sim.reglas_aplicadas.lista_nombre) || 'Sin Lista';
        if (!desglosePorLista[listaNom]) {
            desglosePorLista[listaNom] = {
                lista: listaNom,
                cantidad_clientes: 0,
                capital_deuda: 0,
                asistencia_devengada: 0
            };
        }
        desglosePorLista[listaNom].cantidad_clientes++;
        desglosePorLista[listaNom].capital_deuda += sim.saldo_contable_real;
        desglosePorLista[listaNom].asistencia_devengada += sim.financiacion_total;

        if (sim.financiacion_total > 0 || sim.comprobantes_cortesia > 0) {
            rankingClientesAsistidos.push({
                cuenta_id: sim.cuenta_id,
                codigo_bunker_cliente: sim.codigo_cliente,
                cliente_nombre: sim.cliente_nombre,
                lista_nombre: listaNom,
                saldo_real: sim.saldo_contable_real,
                asistencia_devengada: sim.financiacion_total,
                cortesia_bonificada: sim.financiacion_cortesia_bonificada,
                saldo_total_asistido: sim.saldo_total_proyectado,
                comprobantes_estandar: sim.comprobantes_margen_estandar,
                comprobantes_cortesia: sim.comprobantes_cortesia,
                comprobantes_formalizados: sim.comprobantes_asistencia_formalizada,
                tasa_tem: sim.reglas_aplicadas.tasa_servicio_financiero,
                dias_estandar: sim.reglas_aplicadas.dias_ventana_estandar,
                dias_cortesia: sim.reglas_aplicadas.dias_ventana_cortesia
            });
        }
    }

    capitalTotalDeudaReal = parseFloat(capitalTotalDeudaReal.toFixed(2));
    asistenciaTotalDevengada = parseFloat(asistenciaTotalDevengada.toFixed(2));
    cortesiaTotalBonificada = parseFloat(cortesiaTotalBonificada.toFixed(2));
    totalFinanciacionActivaConIva = parseFloat(totalFinanciacionActivaConIva.toFixed(2));
    totalFinanciacionSombraConIva = parseFloat(totalFinanciacionSombraConIva.toFixed(2));

    rankingClientesAsistidos.sort((a, b) => b.asistencia_devengada - a.asistencia_devengada);

    const payload = {
        configuracion_vigente: configGlobal,
        clientes_financiacion_map: clientesFinanciacionMap,
        metricas_generales: {
            total_cuentas_con_saldo: totalCuentasAnalizadas,
            capital_total_deuda_real: capitalTotalDeudaReal,
            asistencia_total_devengada: asistenciaTotalDevengada,
            cortesia_total_bonificada: cortesiaTotalBonificada,
            total_financiacion_activa_con_iva: totalFinanciacionActivaConIva,
            total_financiacion_sombra_con_iva: totalFinanciacionSombraConIva,
            count_modo_activo: countModoActivo,
            count_modo_sombra: countModoSombra,
            count_modo_excluido: countModoExcluido,
            tasa_asistencia_ponderada: capitalTotalDeudaReal > 0 ? parseFloat(((asistenciaTotalDevengada / capitalTotalDeudaReal) * 100).toFixed(2)) : 0,
            distribucion_cuentas: {
                en_margen_estandar: cuentasEnMargenEstandar,
                en_ventana_cortesia: cuentasEnCortesia,
                en_asistencia_formalizada: cuentasEnAsistenciaFormalizada,
                excluidas_por_acuerdo: cuentasExcluidas
            }
        },
        desglose_por_lista: Object.values(desglosePorLista).map(l => ({
            ...l,
            capital_deuda: parseFloat(l.capital_deuda.toFixed(2)),
            asistencia_devengada: parseFloat(l.asistencia_devengada.toFixed(2))
        })),
        ranking_clientes_asistidos: rankingClientesAsistidos.slice(0, 20)
    };

    if (fingerprint) {
        _cacheDashboardSombra = { fingerprint, ts: Date.now(), payload };
    }
    return payload;
}

/**
 * Actualiza la configuración comercial de asistencia para un cliente.
 * Si solo se envía `salvavidas_modo` (ej: desde el switch rápido de Gestión de Clientes Búnker),
 * preserva los demás parámetros personalizados del cliente.
 */
async function actualizarConfiguracionCliente(codigoCliente, datos, db = pool) {
    const {
        salvavidas_modo,
        salvavidas_tasa_tem,
        salvavidas_dias_estandar,
        salvavidas_dias_cortesia,
        salvavidas_motivo_excepcion,
        salvavidas_cupo_cortesias_anual,
        salvavidas_cortesias_usadas_anio
    } = datos || {};

    const hasTasa = Object.prototype.hasOwnProperty.call(datos || {}, 'salvavidas_tasa_tem');
    const hasDiasEst = Object.prototype.hasOwnProperty.call(datos || {}, 'salvavidas_dias_estandar');
    const hasDiasCort = Object.prototype.hasOwnProperty.call(datos || {}, 'salvavidas_dias_cortesia');
    const hasMotivo = Object.prototype.hasOwnProperty.call(datos || {}, 'salvavidas_motivo_excepcion');

    const query = `
        UPDATE public.bunker_clientes
        SET salvavidas_modo = COALESCE($1, salvavidas_modo),
            salvavidas_tasa_tem = CASE WHEN $9::boolean THEN $2 ELSE salvavidas_tasa_tem END,
            salvavidas_dias_estandar = CASE WHEN $10::boolean THEN $3 ELSE salvavidas_dias_estandar END,
            salvavidas_dias_cortesia = CASE WHEN $11::boolean THEN $4 ELSE salvavidas_dias_cortesia END,
            salvavidas_motivo_excepcion = CASE WHEN $12::boolean THEN $5 ELSE salvavidas_motivo_excepcion END,
            salvavidas_cupo_cortesias_anual = COALESCE($6, salvavidas_cupo_cortesias_anual, 3),
            salvavidas_cortesias_usadas_anio = COALESCE($7, salvavidas_cortesias_usadas_anio, 0),
            salvavidas_cortesias_anio = EXTRACT(YEAR FROM CURRENT_DATE)::INT,
            updated_at = CURRENT_TIMESTAMP
        WHERE codigo_bunker_cliente = $8
        RETURNING id, codigo_bunker_cliente, cliente_nombre, salvavidas_modo, salvavidas_tasa_tem,
                  salvavidas_dias_estandar, salvavidas_dias_cortesia, salvavidas_motivo_excepcion,
                  salvavidas_cupo_cortesias_anual, salvavidas_cortesias_usadas_anio
    `;
    const res = await db.query(query, [
        salvavidas_modo || null,
        salvavidas_tasa_tem !== undefined && salvavidas_tasa_tem !== '' ? parseFloat(salvavidas_tasa_tem) : null,
        salvavidas_dias_estandar !== undefined && salvavidas_dias_estandar !== '' ? parseInt(salvavidas_dias_estandar) : null,
        salvavidas_dias_cortesia !== undefined && salvavidas_dias_cortesia !== '' ? parseInt(salvavidas_dias_cortesia) : null,
        salvavidas_motivo_excepcion || null,
        salvavidas_cupo_cortesias_anual !== undefined && salvavidas_cupo_cortesias_anual !== '' ? parseInt(salvavidas_cupo_cortesias_anual) : null,
        salvavidas_cortesias_usadas_anio !== undefined && salvavidas_cortesias_usadas_anio !== '' ? parseInt(salvavidas_cortesias_usadas_anio) : null,
        codigoCliente,
        hasTasa,
        hasDiasEst,
        hasDiasCort,
        hasMotivo
    ]);
    _cacheDashboardSombra = null;
    return res.rows[0] || null;
}

/**
 * Actualiza los parámetros globales de las ventanas de asistencia
 */
async function actualizarConfiguracionGlobal(datos, db = pool) {
    const { dias_ventana_estandar, dias_ventana_cortesia, tasa_servicio_financiero, modo_calculo, modo_sistema, descripcion_servicio } = datos;

    const query = `
        UPDATE public.bunker_financiacion_config
        SET dias_ventana_estandar = COALESCE($1, dias_ventana_estandar),
            dias_ventana_cortesia = COALESCE($2, dias_ventana_cortesia),
            tasa_servicio_financiero = COALESCE($3, tasa_servicio_financiero),
            tasa_efectiva_mensual_base = COALESCE($3, tasa_efectiva_mensual_base),
            modo_calculo = COALESCE($4, modo_calculo),
            modo_sistema = COALESCE($5, modo_sistema),
            descripcion_servicio = COALESCE($6, descripcion_servicio),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        RETURNING *
    `;
    const res = await db.query(query, [
        dias_ventana_estandar !== undefined ? parseInt(dias_ventana_estandar) : null,
        dias_ventana_cortesia !== undefined ? parseInt(dias_ventana_cortesia) : null,
        tasa_servicio_financiero !== undefined ? parseFloat(tasa_servicio_financiero) : null,
        modo_calculo,
        modo_sistema,
        descripcion_servicio
    ]);
    _cacheDashboardSombra = null;
    return res.rows[0] || null;
}

/**
 * Helper para formatear moneda en Argentina
 */
function formatMoneda(val) {
    const parts = (val || 0).toFixed(2).split('.');
    return `$ ${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${parts[1]}`;
}

/**
 * Redacción constructiva para WhatsApp: Acompañamiento, contención y cortesía
 */
function construirTextoWhatsappAsistencia(capas, reglas, totalDevengado, totalIva = 0, totalConIva = 0) {
    const formalizadas = capas.filter(c => c.ventana_codigo === 'ASISTENCIA_FORMALIZADA');
    const cortesias = capas.filter(c => c.ventana_codigo === 'ASISTENCIA_CORTESIA');
    const graciaNatural = capas.filter(c => c.ventana_codigo === 'GRACIA_NATURAL');

    if (formalizadas.length === 0 && cortesias.length === 0 && graciaNatural.length === 0) return '';

    const lineas = [];

    if (formalizadas.length > 0) {
        lineas.push('> 🛡️ *Servicio de Financiación LAMDA (ACTIVO):*');
        lineas.push(`> Superados los 7 días de compromiso + 3 días de gracia naturales + ventana de comodín (14 días), tu cuenta sigue activa y habilitada con financiación al *${reglas.tasa_servicio_financiero}% mensual + IVA*:`);
        formalizadas.forEach(c => {
            const doc = c.descripcion ? c.descripcion.replace(/\[.*?\]/g, '').trim() : 'Comprobante';
            lineas.push(`> • *${doc}*: ${c.dias_asistencia_efectiva} días financiados (+${formatMoneda(c.interes_financiacion)} + IVA ${formatMoneda(c.iva_financiacion)} = *${formatMoneda(c.interes_financiacion_con_iva)}*)`);
        });
        lineas.push(`> Financiación acumulada: *${formatMoneda(totalDevengado)} + IVA (${formatMoneda(totalIva)}) = ${formatMoneda(totalConIva)}*.`);
        lineas.push(`> _Cada pago parcial que realices descuenta capital en el acto y reduce la financiación diaria futura._`);
    } else if (cortesias.length > 0) {
        lineas.push('> 🎟️ *Uso de Comodín Trimestral (Días 11 a 14):*');
        lineas.push(`> Tenés *${cortesias.length} comprobante(s)* dentro de la ventana de comodín trimestral (1 cada 3 meses / 3 al año).`);
        lineas.push(`> _Política LAMDA:_ Abonando hasta el día 14 desde la entrega, la financiación queda *100% bonificada (0%)*.`);
    } else if (graciaNatural.length > 0) {
        lineas.push('> ⏳ *+3 Días de Gracia Naturales (Días 8 a 10):*');
        lineas.push(`> Tenés *${graciaNatural.length} comprobante(s)* dentro de los +3 días de gracia naturales posteriores al plazo habitual de 7 días.`);
        lineas.push(`> _Política LAMDA:_ *0% de financiación y SIN consumir tu comodín trimestral* (contemplando acreditaciones bancarias de viernes a lunes).`);
    }

    lineas.push('> Tu cuenta permanece plenamente *habilitada* para solicitar y recibir mercadería.');

    return '\n\n' + lineas.join('\n');
}

/**
 * Redacción constructiva para PDF y estados impresos
 */
function construirTextoPdfAsistencia(capas, reglas, totalDevengado, totalIva = 0, totalConIva = 0) {
    const formalizadas = capas.filter(c => c.ventana_codigo === 'ASISTENCIA_FORMALIZADA');
    const cortesias = capas.filter(c => c.ventana_codigo === 'ASISTENCIA_CORTESIA');
    const graciaNatural = capas.filter(c => c.ventana_codigo === 'GRACIA_NATURAL');

    if (formalizadas.length === 0 && cortesias.length === 0 && graciaNatural.length === 0) return '';

    if (formalizadas.length > 0) {
        return `Servicio de Financiación LAMDA (ACTIVO): ${formalizadas.length} comprobante(s) financiados (${reglas.tasa_servicio_financiero}% mensual + IVA). Financiación: ${formatMoneda(totalDevengado)} + IVA ${formatMoneda(totalIva)} = ${formatMoneda(totalConIva)}.`;
    }
    if (cortesias.length > 0) {
        return `Ventana de Comodín Trimestral LAMDA (Días 11 a 14): Comprobantes bonificados al 100% (0% financiación).`;
    }
    return `+3 Días de Gracia Naturales LAMDA (Días 8 a 10): 0% financiación y sin consumo de comodín trimestral.`;
}

/**
 * Emite el comprobante por la porción de Financiación (Interés + IVA) contenida y cancelada dentro de un pago.
 * Permite elegir entre:
 *  - 'INTERNA': Facturación de Aprobación Interna (pto_vta 90, estado 'APROBADA_LOCAL', sin comunicar a ARCA).
 *  - 'ARCA': Factura Oficial Electrónica (pto_vta 32, Factura A o B según condición IVA, con CAE de ARCA).
 *
 * @param {number} cuentaId - ID de la cuenta corriente
 * @param {number} pagoMovId - ID del movimiento de crédito (pago) que canceló la financiación
 * @param {string} [modoFacturacion='INTERNA'] - 'INTERNA' | 'ARCA'
 * @param {Object} [db=pool] - Pool o cliente de base de datos
 */
async function recalcularSaldosCC(ccId, dbClient) {
    const resCCInfo = await dbClient.query(
        `SELECT saldo_apertura FROM public.factura_cuentas_corrientes WHERE id = $1`,
        [ccId]
    );
    const saldoApertura = resCCInfo.rows.length > 0 ? parseFloat(resCCInfo.rows[0].saldo_apertura) || 0 : 0;

    const resMovs = await dbClient.query(
        `SELECT id, tipo_movimiento, monto
         FROM public.factura_cuenta_corriente_movimientos
         WHERE cuenta_corriente_id = $1
         ORDER BY fecha_movimiento ASC, id ASC`,
        [ccId]
    );

    let saldoAcumulado = saldoApertura;
    for (const mov of resMovs.rows) {
        const m = parseFloat(mov.monto) || 0;
        if (mov.tipo_movimiento === 'DEBITO') {
            saldoAcumulado += m;
        } else if (mov.tipo_movimiento === 'CREDITO') {
            saldoAcumulado -= m;
        }
        saldoAcumulado = parseFloat(saldoAcumulado.toFixed(2));

        await dbClient.query(
            `UPDATE public.factura_cuenta_corriente_movimientos
             SET saldo_resultante = $1
             WHERE id = $2`,
            [saldoAcumulado, mov.id]
        );
    }

    await dbClient.query(
        `UPDATE public.factura_cuentas_corrientes
         SET saldo = $1, actualizada_en = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [saldoAcumulado, ccId]
    );
}

async function emitirFacturaInteresPago(cuentaId, pagoMovId, modoFacturacion = 'INTERNA', db = pool) {
    const modo = String(modoFacturacion || 'INTERNA').toUpperCase() === 'ARCA' ? 'ARCA' : 'INTERNA';
    const comp = await composicionSaldoService.calcularComposicionSaldo(cuentaId, db);
    if (!comp) throw new Error('Cuenta corriente no encontrada.');

    const imp = comp.imputaciones_por_movimiento ? comp.imputaciones_por_movimiento[String(pagoMovId)] : null;
    if (!imp || !imp.tiene_financiacion_imputada || imp.financiacion_con_iva_cancelada <= 0) {
        throw new Error('El movimiento de pago indicado no posee cargos de financiación imputados para facturar.');
    }

    const facturaService = require('../../facturacion/services/facturaService');

    // Resolver datos fiscales del cliente
    const cliRes = await db.query(
        `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, condicion_iva, lomas_soft_id
         FROM public.bunker_clientes
         WHERE codigo_bunker_cliente = $1
         LIMIT 1`,
        [comp.codigo]
    );
    if (cliRes.rows.length === 0) throw new Error(`Cliente ${comp.codigo} no encontrado en Búnker.`);
    const bc = cliRes.rows[0];

    const clienteIdNum = parseInt(String(bc.lomas_soft_id || '').replace(/\D/g, ''), 10) || bc.id;
    const cuitStr = String(bc.cuit_cuil || '').replace(/\D/g, '');
    const condIvaStr = String(bc.condicion_iva || '').toLowerCase();
    const esRI = condIvaStr.includes('inscripto');
    const condicionIvaId = esRI ? 1 : (condIvaStr.includes('monotrib') ? 6 : (condIvaStr.includes('exento') ? 4 : 5));
    const docTipo = cuitStr.length === 11 ? 80 : 96;
    const docNro = cuitStr || '0';

    // Si ya tenía comprobante interno y se pide igual 'INTERNA', devolver idempotente;
    // si era 'INTERNA' y ahora se pide 'ARCA', actualizar el mismo comprobante y emitir en ARCA.
    if (imp.financiacion_facturada && imp.factura_financiacion_id) {
        const facPrevRes = await db.query('SELECT * FROM public.factura_facturas WHERE id = $1', [imp.factura_financiacion_id]);
        if (facPrevRes.rows.length > 0) {
            const facPrev = facPrevRes.rows[0];
            if (modo === 'INTERNA' || facPrev.estado === 'APROBADA') {
                await recalcularSaldosCC(cuentaId, db);
                return {
                    idempotente: true,
                    modo_facturacion: facPrev.estado === 'APROBADA' ? 'ARCA' : 'INTERNA',
                    factura: facPrev,
                    imputacion: imp
                };
            }
            // Upgrade de INTERNA ('APROBADA_LOCAL') a Oficial 'ARCA'
            const tipoCbteArca = esRI ? 1 : 6;
            await db.query(
                `UPDATE public.factura_facturas
                 SET pto_vta = 32, tipo_cbte = $1, requiere_afip = TRUE, estado = 'BORRADOR',
                     doc_tipo = $2, doc_nro = $3, condicion_iva_id = $4, updated_at = NOW()
                 WHERE id = $5`,
                [tipoCbteArca, docTipo, docNro, condicionIvaId, facPrev.id]
            );
            const facEmitidaArca = await facturaService.emitir(facPrev.id);
            const ptoPad = String(facEmitidaArca.pto_vta).padStart(4, '0');
            const nroPad = String(facEmitidaArca.cbte_nro).padStart(8, '0');
            const letraStr = tipoCbteArca === 1 ? 'Factura A' : 'Factura B';
            const descOficial = `${letraStr} ${ptoPad}-${nroPad} (CAE: ${facEmitidaArca.cae || 'N/A'}) — Servicio Financiación (${imp.codigo_sobre ? `Sobre #${imp.codigo_sobre}` : `Pago #${pagoMovId}`})`;

            await db.query(
                `UPDATE public.factura_cuenta_corriente_movimientos
                 SET descripcion = $1,
                     metadatos = COALESCE(metadatos, '{}'::jsonb) || $2::jsonb
                 WHERE cuenta_corriente_id = $3 AND comprobante_id = $4`,
                [descOficial, JSON.stringify({ es_cargo_financiacion: true, pago_origen_id: Number(pagoMovId), modo_facturacion: 'ARCA' }), cuentaId, facEmitidaArca.id]
            );
            await db.query(
                `UPDATE public.factura_cuenta_corriente_movimientos
                 SET metadatos = COALESCE(metadatos, '{}'::jsonb) || $1::jsonb
                 WHERE id = $2`,
                [JSON.stringify({
                    financiacion_facturada_id: facEmitidaArca.id,
                    financiacion_facturada_nro: `${letraStr} ${ptoPad}-${nroPad}`,
                    financiacion_facturada_modo: 'ARCA'
                }), pagoMovId]
            );
            await recalcularSaldosCC(cuentaId, db);
            return {
                idempotente: false,
                modo_facturacion: 'ARCA',
                factura: facEmitidaArca,
                imputacion: imp
            };
        }
    }

    // Construir descripción clara del servicio de financiación cubierto en el pago
    const detallesFin = (imp.detalles_comprobantes || []).filter(d => d.con_financiacion);
    const resumenDocs = detallesFin.map(d => {
        const nomCorto = (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
        return `${nomCorto} (${d.dias_al_pago}d al ${d.tasa_tem || 3}% mensual)`;
    }).join(' + ');
    const refPago = imp.codigo_sobre ? `Sobre #${imp.codigo_sobre}` : `Recibo #${pagoMovId}`;
    const descItem = `Servicio de Financiación LAMDA s/ capital cancelado de ${resumenDocs || 'cuenta corriente'} — ${refPago}`;

    const esArca = modo === 'ARCA';
    const ptoVta = esArca ? 32 : 90;
    const tipoCbte = esArca ? (esRI ? 1 : 6) : 6;
    const fechaPagoDate = new Date(imp.fecha_pago);
    const fechaEmisionStr = fechaPagoDate.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

    const borrador = await facturaService.crearBorrador({
        tipo_cbte: tipoCbte,
        pto_vta: ptoVta,
        concepto: 1,
        fecha_emision: fechaEmisionStr,
        precio_modo: 'NETO',
        requiere_afip: esArca,
        serie_interna: esArca ? null : 'X',
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
                p_unit: imp.financiacion_neta_cancelada,
                alic_iva_id: 1, // 21% (codigo_afip: 5)
                costo_unitario: 0.0001
            }
        ]
    });

    // Asegurar exactitud de centavos en neto, IVA y total antes de emitir
    await db.query(
        `UPDATE public.factura_facturas
         SET imp_neto = $1, imp_iva = $2, imp_total = $3, stock_descontado = TRUE
         WHERE id = $4`,
        [imp.financiacion_neta_cancelada, imp.financiacion_iva_cancelada, imp.financiacion_con_iva_cancelada, borrador.id]
    );
    await db.query(
        `UPDATE public.factura_factura_items
         SET p_unit = $1, imp_neto = $1, imp_iva = $2
         WHERE factura_id = $3`,
        [imp.financiacion_neta_cancelada, imp.financiacion_iva_cancelada, borrador.id]
    );

    const facturaEmitida = await facturaService.emitir(borrador.id);

    // Formatear etiqueta del comprobante emitido
    let etiquetaComp = '';
    if (esArca && facturaEmitida.estado === 'APROBADA') {
        const ptoPad = String(facturaEmitida.pto_vta).padStart(4, '0');
        const nroPad = String(facturaEmitida.cbte_nro).padStart(8, '0');
        const letraStr = tipoCbte === 1 ? 'Factura A' : 'Factura B';
        etiquetaComp = `${letraStr} ${ptoPad}-${nroPad} (CAE: ${facturaEmitida.cae || 'N/A'})`;
    } else {
        const nroIntPad = String(facturaEmitida.nro_interno || facturaEmitida.cbte_nro || facturaEmitida.id).padStart(8, '0');
        etiquetaComp = `Fac X0090-${nroIntPad}`;
    }

    const descMovDebito = `${etiquetaComp} — Servicio Financiación (${refPago})`;
    // Ubicar la fecha del cargo de financiación 1 segundo antes del pago para lectura cronológica perfecta
    const fechaMovCargo = new Date(fechaPagoDate.getTime() - 1000);

    const metaDebito = {
        es_cargo_financiacion: true,
        pago_origen_id: Number(pagoMovId),
        modo_facturacion: modo,
        codigo_sobre: imp.codigo_sobre || null,
        capital_cancelado: imp.capital_cancelado_total,
        financiacion_neta: imp.financiacion_neta_cancelada,
        financiacion_iva: imp.financiacion_iva_cancelada,
        financiacion_con_iva: imp.financiacion_con_iva_cancelada,
        detalles_comprobantes: imp.detalles_comprobantes
    };

    const movDebRes = await db.query(
        `UPDATE public.factura_cuenta_corriente_movimientos
         SET descripcion = $1,
             fecha_movimiento = $2,
             metadatos = $3::jsonb
         WHERE cuenta_corriente_id = $4 AND comprobante_id = $5
         RETURNING id`,
        [descMovDebito, fechaMovCargo, JSON.stringify(metaDebito), cuentaId, facturaEmitida.id]
    );
    const movDebitoId = movDebRes.rows[0]?.id || null;

    // Vincular en los metadatos del movimiento de pago (CREDITO)
    const metaPagoUpdate = {
        financiacion_facturada_id: facturaEmitida.id,
        financiacion_facturada_mov_id: movDebitoId,
        financiacion_facturada_nro: etiquetaComp,
        financiacion_facturada_modo: modo,
        imputacion_financiacion: {
            capital_cancelado: imp.capital_cancelado_total,
            financiacion_neta: imp.financiacion_neta_cancelada,
            financiacion_iva: imp.financiacion_iva_cancelada,
            financiacion_con_iva: imp.financiacion_con_iva_cancelada,
            detalles_comprobantes: imp.detalles_comprobantes
        }
    };

    await db.query(
        `UPDATE public.factura_cuenta_corriente_movimientos
         SET metadatos = COALESCE(metadatos, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify(metaPagoUpdate), pagoMovId]
    );

    // Recalcular saldos acumulados en orden cronológico estricto
    await recalcularSaldosCC(cuentaId, db);
    _cacheDashboardSombra = null;

    return {
        idempotente: false,
        modo_facturacion: modo,
        etiqueta_comprobante: etiquetaComp,
        factura: facturaEmitida,
        movimiento_debito_id: movDebitoId,
        imputacion: {
            ...imp,
            financiacion_facturada: true,
            factura_financiacion_id: facturaEmitida.id,
            factura_financiacion_mov_id: movDebitoId,
            factura_financiacion_descripcion: descMovDebito,
            modo_facturacion: modo
        }
    };
}

module.exports = {
    obtenerConfiguracionGlobal,
    resolverReglasFinanciacion,
    calcularSimulacionCuenta,
    obtenerDashboardMetricasSombra,
    actualizarConfiguracionCliente,
    actualizarConfiguracionGlobal,
    emitirFacturaInteresPago
};
