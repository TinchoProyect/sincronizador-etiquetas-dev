/**
 * Servicio WSFE (Web Service de Facturación Electrónica)
 * Gestiona la emisión de comprobantes electrónicos con AFIP usando @afipsdk/afip.js
 */

const Afip = require('@afipsdk/afip.js');
const { pool } = require('../config/database');
const { ENTORNO, CUIT, ALICUOTAS_IVA } = require('../config/afip');
const path = require('path');

// Inicializar SDK de AFIP
const afip = new Afip({
    CUIT: 23248921749,
    cert: path.resolve(__dirname, '../certs/certificado_homo.crt'),
    key: path.resolve(__dirname, '../certs/privada_homo.key'),
    res_folder: path.resolve(__dirname, '../certs/'),
    production: false
});

console.log('🔍 [FACTURACION-WSFE] Cargando servicio WSFE con afip.js...');
console.log(`   Modo Producción: ${afip.options.production}`);
console.log(`   CUIT: ${afip.options.CUIT}`);

/**
 * Obtener factura completa para CAE
 */
const obtenerFacturaParaCAE = async (facturaId) => {
    console.log(`🔍 [FACTURACION-WSFE] Obteniendo factura ID: ${facturaId}`);
    try {
        const query = `
            SELECT 
                f.*,
                json_agg(
                    json_build_object(
                        'descripcion', i.descripcion,
                        'qty', i.qty,
                        'p_unit', i.p_unit,
                        'alic_iva_id', i.alic_iva_id,
                        'imp_neto', i.imp_neto,
                        'imp_iva', i.imp_iva
                    ) ORDER BY i.orden
                ) as items,
                (SELECT row_to_json(fa) FROM factura_facturas fa WHERE fa.id = f.factura_asociada_id) as factura_asociada
            FROM factura_facturas f
            LEFT JOIN factura_factura_items i ON f.id = i.factura_id
            WHERE f.id = $1
            GROUP BY f.id
        `;
        const resultado = await pool.query(query, [facturaId]);
        if (resultado.rows.length === 0) {
            throw new Error(`Factura ${facturaId} no encontrada`);
        }
        return resultado.rows[0];
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error obteniendo factura:', error.message);
        throw error;
    }
};

/**
 * Obtener último comprobante autorizado por AFIP
 */
const ultimoAutorizado = async (ptoVta, tipoCbte, entorno = 'HOMO') => {
    console.log(`🔍 [FACTURACION-WSFE] Consultando último autorizado PV:${ptoVta} Tipo:${tipoCbte}`);
    try {
        const lastVoucher = await afip.ElectronicBilling.getLastVoucher(ptoVta, tipoCbte);
        console.log(`✅ [FACTURACION-WSFE] Último autorizado (AFIP SDK): ${lastVoucher}`);
        return lastVoucher;
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error consultando último autorizado:', error.message);
        throw error;
    }
};

/**
 * Guardar log de operación WSFE
 */
const guardarLogWSFE = async (facturaId, metodo, requestData, responseData, resultado) => {
    console.log(`💾 [FACTURACION-WSFE] Guardando log para factura ID: ${facturaId}`);
    try {
        const query = `
            INSERT INTO factura_afip_wsfe_logs 
            (factura_id, metodo, request_xml, response_xml, observaciones, resultado, creado_en)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `;

        const observaciones = resultado.observaciones
            ? JSON.stringify(resultado.observaciones)
            : null;

        await pool.query(query, [
            facturaId,
            metodo,
            JSON.stringify(requestData),
            JSON.stringify(responseData),
            observaciones,
            resultado.resultado
        ]);

        console.log(`✅ [FACTURACION-WSFE] Log guardado`);
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error guardando log:', error.message);
    }
};

/**
 * Solicitar CAE (Código de Autorización Electrónico)
 */
const solicitarCAE = async (facturaId, entorno = 'HOMO') => {
    console.log(`📄 [FACTURACION-WSFE] Solicitando CAE para factura ID: ${facturaId}`);
    try {
        const factura = await obtenerFacturaParaCAE(facturaId);

        console.log('\n======================================================');
        console.log('🔍 [VIGÍA - PASO 1: LECTURA DB]');
        console.log('======================================================');
        console.log(JSON.stringify({
            id: factura.id,
            condicion_iva_id: factura.condicion_iva_id,
            condicion_iva_str: factura.condicion_iva,
            doc_tipo: factura.doc_tipo,
            doc_nro: factura.doc_nro,
            tipo_cbte: factura.tipo_cbte,
            imp_total: factura.imp_total
        }, null, 2));

        const nextVoucher = await afip.ElectronicBilling.getLastVoucher(factura.pto_vta, factura.tipo_cbte) + 1;
        console.log(`   Próximo comprobante: ${nextVoucher}`);

        const date = new Date(Date.now() - ((new Date()).getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        // --- REGLA 1: DICCIONARIO DE CONDICIÓN DE IVA (CondicionIVAReceptorId) ---
        let condicionIva = 5; // Fallback Consumidor Final
        const condicionString = (factura.condicion_iva || '').toLowerCase();
        const condicionId = factura.condicion_iva_id;

        if (condicionId && !isNaN(condicionId)) {
            condicionIva = parseInt(condicionId, 10);
        } else if (condicionString.includes('inscripto')) {
            condicionIva = 1;
        } else if (condicionString.includes('exento')) {
            condicionIva = 4;
        } else if (condicionString.includes('social')) {
            condicionIva = 13;
        } else if (condicionString.includes('monotributo') || condicionString.includes('monotributista')) {
            condicionIva = 6;
        } else if (condicionString.includes('consumidor') || condicionString.includes('final')) {
            condicionIva = 5;
        }

        const isFacturaB = (factura.tipo_cbte === 6 || factura.tipo_cbte === 8 || factura.tipo_cbte === 11);

        // --- REGLA 3: VALIDACIONES DE NEGOCIO CRUZADAS ---
        // Si la base dice Resp. Inscripto (1) o Monotributo (6) pero el usuario pidió hacer una Factura B,
        // FORZAMOS a Consumidor Final (5) para evitar el rechazo de AFIP (Error 10243).
        if (isFacturaB && (condicionIva === 1 || condicionIva === 6)) {
            condicionIva = 5;
        }

        // --- REGLA 2: TIPOS DE DOCUMENTO Y LÍMITES (DocTipo y DocNro) ---
        let docTipo = factura.doc_tipo ? parseInt(factura.doc_tipo, 10) : 99;
        let docNro = factura.doc_nro || 0;

        // Limpieza de DocNro para garantizar que sea un número entero puro (sin guiones ni puntos)
        docNro = parseInt(String(docNro).replace(/\D/g, ''), 10) || 0;

        if (isFacturaB) {
            if (condicionIva === 5) { // Si es Consumidor Final
                if (docTipo === 80) { // Si trajo CUIT por error en la BD
                    docTipo = 99; // Se fuerza a Sin Identificar porque AFIP no permite CUIT para Consumidor Final
                    docNro = 0;
                } else if (docNro > 0) {
                    // Si tiene documento, exigimos que sea 96 (DNI), nunca otro
                    docTipo = 96;
                } else {
                    // Si no tiene, debe ser 99 y DocNro 0
                    docTipo = 99;
                    docNro = 0;
                }
            }

            // Tope Normativo Anónimo 
            if (docTipo === 99 && factura.imp_total >= 344000) {
                throw new Error('AFIP exige DNI o CUIT para ventas a Consumidor Final superiores al límite normativo (344,000 ARS). Por favor edite el presupuesto e ingrese el DNI del cliente.');
            }
        }

        // --- REGLA 4: EL DESGLOSE DE IVA ES OBLIGATORIO EN FACTURA B ---
        // Nos aseguramos que ImpNeto, ImpIVA e ImpTotal cierren matemáticamente
        let impTotal = parseFloat(factura.imp_total) || 0;
        let impNeto = parseFloat(factura.imp_neto) || 0;
        let impIva = parseFloat(factura.imp_iva) || 0;
        let impTrib = parseFloat(factura.imp_trib) || 0;

        // Recalcular si hay IVA en los ítems para garantizar precisión milimétrica 
        // y cuadre contra ImpTotal en las Facturas B que ocultan el IVA al cliente
        if (factura.items && factura.items.length > 0) {
            let sumIva = 0;
            let sumNeto = 0;
            factura.items.forEach(item => {
                sumIva += parseFloat(item.imp_iva || 0);
                sumNeto += parseFloat(item.imp_neto || 0);
            });

            if (sumIva > 0) {
                impIva = sumIva;
                impNeto = sumNeto;
                // Forzamos el total según el cálculo desagregado para no rebotar por diferencias
                impTotal = impNeto + impIva + impTrib;
            }
        }

        payload = {
            'CantReg': 1,
            'PtoVta': factura.pto_vta,
            'CbteTipo': factura.tipo_cbte,
            'Concepto': factura.concepto,
            'DocTipo': docTipo,
            'DocNro': docNro,
            'CbteDesde': nextVoucher,
            'CbteHasta': nextVoucher,
            'CbteFch': parseInt(date.replace(/-/g, '')),
            'ImpTotal': Number(impTotal.toFixed(2)),
            'ImpTotConc': 0,
            'ImpNeto': Number(impNeto.toFixed(2)),
            'ImpOpEx': 0,
            'ImpIVA': Number(impIva.toFixed(2)),
            'ImpTrib': Number(impTrib.toFixed(2)),
            'CondicionIVAReceptorId': condicionIva, // Nuevo campo obligatorio RG 5616/2024
            'MonId': factura.moneda || 'PES',
            'MonCotiz': factura.mon_cotiz || 1,
        };

        // --- REGLA 5: NOTAS DE CRÉDITO Y COMPROBANTES ASOCIADOS ---
        const isNotaCredito = (factura.tipo_cbte === 3 || factura.tipo_cbte === 8 || factura.tipo_cbte === 13);

        if (isNotaCredito) {
            if (!factura.factura_asociada) {
                throw new Error('AFIP exige un comprobante original asociado (CbtesAsoc) para emitir Notas de Crédito. Falta el vínculo con la factura original de venta.');
            }

            payload.CbtesAsoc = [
                {
                    Tipo: factura.factura_asociada.tipo_cbte,
                    PtoVta: factura.factura_asociada.pto_vta,
                    Nro: factura.factura_asociada.cbte_nro
                }
            ];
            console.log(`🔗 [FACTURACION-WSFE] Nota de Crédito: Asociada a Factura Tipo ${factura.factura_asociada.tipo_cbte} PV ${factura.factura_asociada.pto_vta} NRO ${factura.factura_asociada.cbte_nro}`);
        }

        // RG 5616 - AFIP EXIGE el campo CondicionIVAReceptorId en TODO comprobante (Facturas A, B, C, etc).

        if (impIva > 0 && factura.items && factura.items.length > 0) {
            const porAlicuota = {};
            factura.items.forEach(item => {
                const idIva = item.alic_iva_id || 5; // Default 21%
                if (!porAlicuota[idIva]) {
                    porAlicuota[idIva] = { BaseImp: 0, Importe: 0 };
                }
                porAlicuota[idIva].BaseImp += parseFloat(item.imp_neto || 0);
                porAlicuota[idIva].Importe += parseFloat(item.imp_iva || 0);
            });

            // Ajuste fino para sub-ítems
            let totalBaseValidado = 0;
            let totalIvaValidado = 0;

            payload.Iva = Object.keys(porAlicuota).map(id => {
                const base = Number(porAlicuota[id].BaseImp.toFixed(2));
                const imp = Number(porAlicuota[id].Importe.toFixed(2));
                totalBaseValidado += base;
                totalIvaValidado += imp;

                // Map local ID to AFIP's ID (e.g., 1 -> 5 for 21%)
                const afipIvaId = ALICUOTAS_IVA[id] ? ALICUOTAS_IVA[id].codigo_afip : parseInt(id);

                return {
                    'Id': afipIvaId,
                    'BaseImp': base,
                    'Importe': imp
                };
            });

            // Garantizar la igualdad fundamental ImpNeto + ImpIVA + ImpTrib = ImpTotal
            payload.ImpNeto = Number(totalBaseValidado.toFixed(2));
            payload.ImpIVA = Number(totalIvaValidado.toFixed(2));
            payload.ImpTotal = Number((payload.ImpNeto + payload.ImpIVA + payload.ImpTrib).toFixed(2));
        }

        console.log('\n======================================================');
        console.log('🔄 [VIGÍA - PASO 2: TRANSFORMACIÓN]');
        console.log('======================================================');
        console.log(`Original:  CondIvaBD=${factura.condicion_iva_id || 'null'}, DocTipoBD=${factura.doc_tipo || 'null'}, CbteTipoBD=${factura.tipo_cbte || 'null'}`);
        console.log(`Mapeado:   CondIvaAFIP=${payload.CondicionIVAReceptorId}, DocTipoAFIP=${payload.DocTipo}, CbteTipoAFIP=${payload.CbteTipo}`);
        console.log(`Validado:  ImpTotalAFIP=${payload.ImpTotal}, ImpNetoAFIP=${payload.ImpNeto}, ImpIvaAFIP=${payload.ImpIVA}`);

        console.log('\n======================================================');
        console.log('📤 [VIGÍA - PASO 3: PAYLOAD FINAL AFIP]');
        console.log('======================================================');
        console.log(JSON.stringify(payload, null, 2));

        const res = await afip.ElectronicBilling.createVoucher(payload);

        console.log('\n======================================================');
        console.log('📥 [VIGÍA - PASO 4: RESPUESTA CRUDA (ÉXITO)]');
        console.log('======================================================');
        console.log(JSON.stringify(res, null, 2));

        const cae = res.CAE; // CAE asignado 
        const vto = res.CAEFchVto; // Fecha vencimiento (YYYYMMDD)

        console.log(`✅ [FACTURACION-WSFE] Respuesta AFIP: CAE=${cae}, Vto=${vto}`);

        const resultadoParseado = {
            cae: cae,
            cae_vto: `${vto.substring(0, 4)}-${vto.substring(4, 6)}-${vto.substring(6, 8)}`,
            resultado: 'A',
            observaciones: []
        };

        await guardarLogWSFE(facturaId, 'createVoucher', payload, res, resultadoParseado);

        return resultadoParseado;
    } catch (error) {
        console.log('\n======================================================');
        console.log('💥 [VIGÍA - PASO 4: RESPUESTA CRUDA (ERROR)]');
        console.log('======================================================');
        console.log('Mensaje Principal:', error.message);

        // Log detallado
        if (error.response && error.response.data) {
            console.log('Datos de respuesta AFIP:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('Pila de error:', error.stack || error);
        }
        console.log('======================================================\n');

        await guardarLogWSFE(facturaId, 'createVoucher', { error: 'Request Failed' }, { error: error.message, stack: error.stack }, {
            resultado: 'R',
            observaciones: [error.message]
        });
        throw error;
    }
};

/**
 * Consultar comprobante en AFIP
 */
const consultarComprobante = async (ptoVta, tipoCbte, cbteNro, entorno = 'HOMO') => {
    console.log(`🔍 [FACTURACION-WSFE] Consultando comprobante PV:${ptoVta} Tipo:${tipoCbte} Nro:${cbteNro}`);
    try {
        const voucherInfo = await afip.ElectronicBilling.getVoucherInfo(cbteNro, ptoVta, tipoCbte);
        if (!voucherInfo) {
            return { encontrado: false };
        }
        return {
            encontrado: true,
            ptoVta,
            tipoCbte,
            cbteNro,
            cae: voucherInfo.CodAutorizacion,
            estado: voucherInfo.Resultado === 'A' ? 'APROBADA' : voucherInfo.Resultado
        };
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error consultando comprobante:', error.message);
        throw error;
    }
};

console.log('✅ [FACTURACION-WSFE] Servicio WSFE cargado con afip.js');

module.exports = {
    ultimoAutorizado,
    solicitarCAE,
    consultarComprobante
};
