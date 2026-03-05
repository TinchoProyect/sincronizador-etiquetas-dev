/**
 * Servicio WSFE (Web Service de Facturación Electrónica)
 * Gestiona la emisión de comprobantes electrónicos con AFIP usando @afipsdk/afip.js
 */

const Afip = require('@afipsdk/afip.js');
const { pool } = require('../config/database');
const { ENTORNO, CUIT } = require('../config/afip');
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
                ) as items
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

        const nextVoucher = await afip.ElectronicBilling.getLastVoucher(factura.pto_vta, factura.tipo_cbte) + 1;
        console.log(`   Próximo comprobante: ${nextVoucher}`);

        const date = new Date(Date.now() - ((new Date()).getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        payload = {
            'CantReg': 1,
            'PtoVta': factura.pto_vta,
            'CbteTipo': factura.tipo_cbte,
            'Concepto': factura.concepto,
            'DocTipo': factura.doc_tipo || 99,
            'DocNro': factura.doc_nro || 0,
            'CbteDesde': nextVoucher,
            'CbteHasta': nextVoucher,
            'CbteFch': parseInt(date.replace(/-/g, '')),
            'ImpTotal': factura.imp_total,
            'ImpTotConc': 0,
            'ImpNeto': factura.imp_neto,
            'ImpOpEx': 0,
            'ImpIVA': factura.imp_iva,
            'ImpTrib': factura.imp_trib,
            'MonId': factura.moneda || 'PES',
            'MonCotiz': factura.mon_cotiz || 1,
        };

        // RG 5616 - 2024: Condicion Frente al IVA del receptor
        let condicionIva = factura.condicion_iva_id;

        // REGLA ESTRICTA AFIP: Facturas B (6) y NC B (8) NUNCA pueden ir a un Responsable Inscripto (1).
        // Si la base de datos dice que es Responsable Inscripto (1), PERO le estamos haciendo Factura B,
        // debemos forzar a Consumidor Final (5) o Monotributo (6) para que AFIP no rechace (Error 10243).
        if ((factura.tipo_cbte === 6 || factura.tipo_cbte === 8) && (condicionIva === 1 || !condicionIva)) {
            // Si tiene CUIT (80), asumimos Monotributo (6), si tiene DNI (96) u otro, Consumidor Final (5)
            condicionIva = factura.doc_tipo === 80 ? 6 : 5;
        } else if (!condicionIva) {
            // Valores por defecto si no viene de la BD
            if (factura.doc_tipo === 80) condicionIva = 1; // CUIT -> Resp. Inscripto
            else condicionIva = 5; // Otros -> Consumidor Final
        }

        payload.CondicionIVAReceptorId = condicionIva;

        if (factura.imp_iva > 0 && factura.items && factura.items.length > 0) {
            const porAlicuota = {};
            factura.items.forEach(item => {
                const idIva = item.alic_iva_id;
                if (!porAlicuota[idIva]) {
                    porAlicuota[idIva] = { BaseImp: 0, Importe: 0 };
                }
                porAlicuota[idIva].BaseImp += parseFloat(item.imp_neto);
                porAlicuota[idIva].Importe += parseFloat(item.imp_iva);
            });

            payload.Iva = Object.keys(porAlicuota).map(id => ({
                'Id': parseInt(id),
                'BaseImp': Number(porAlicuota[id].BaseImp.toFixed(2)),
                'Importe': Number(porAlicuota[id].Importe.toFixed(2))
            }));
        }

        console.log(`📝 [FACTURACION-WSFE] Enviando payload a AFIP:`, JSON.stringify(payload, null, 2));

        const res = await afip.ElectronicBilling.createVoucher(payload);

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
        console.error('🚨 [VIGÍA AFIP] Error al emitir:', error.message);
        console.error('📦 [VIGÍA AFIP] Payload enviado:', payload ? JSON.stringify(payload, null, 2) : 'No llegó a construirse el payload');

        // Log detallado
        if (error.response) {
            console.error('❌ [FACTURACION-WSFE] Respuesta AFIP:', error.response.data);
        } else {
            console.error(error);
        }

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
