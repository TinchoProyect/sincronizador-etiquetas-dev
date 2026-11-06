/**
 * Servicio WSFE (Web Service de Facturación Electrónica)
 * Gestiona la emisión de comprobantes electrónicos con AFIP usando @afipsdk/afip.js
 * Incluye Doble Persistencia Automática (Disco `certs/TA-*.json` <-> PostgreSQL `public.factura_afip_ta`)
 * para garantizar continuidad sin bloqueo de 12hs en ARCA/AFIP ante failover o rollback Nube <-> PcAlmacen.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Afip = require('@afipsdk/afip.js');
const { pool } = require('../config/database');
const { ENTORNO, CUIT, CERTIFICADOS, ALICUOTAS_IVA } = require('../config/afip');

const CERTS_DIR = path.resolve(__dirname, '../certs/');

// Inicializar SDK de AFIP fijando tanto res_folder como ta_folder en src/facturacion/certs/
const afip = new Afip({
    CUIT: parseInt(CUIT, 10),
    cert: CERTIFICADOS[ENTORNO].CERT,
    key: CERTIFICADOS[ENTORNO].KEY,
    res_folder: CERTS_DIR,
    ta_folder: CERTS_DIR,
    production: ENTORNO === 'PROD'
});

let _tablaTaVerificada = false;

function obtenerRutaArchivoTA(service = 'wsfe') {
    const isProd = afip.options && afip.options.production;
    const cuitNum = afip.options ? afip.options.CUIT : parseInt(CUIT, 10);
    return path.resolve(
        CERTS_DIR,
        `TA-${cuitNum}-${service}${isProd ? '-production' : ''}.json`
    );
}

/**
 * Si existía un TA previo en la carpeta interna de node_modules/@afipsdk/afip.js/src/Afip_res/,
 * lo migra sin pérdida hacia src/facturacion/certs/.
 */
function migrarTaLegacySiExiste(service = 'wsfe') {
    try {
        const targetPath = obtenerRutaArchivoTA(service);
        if (fs.existsSync(targetPath)) return;
        const legacyDir = path.resolve(path.dirname(require.resolve('@afipsdk/afip.js')), 'Afip_res');
        const legacyPath = path.resolve(legacyDir, path.basename(targetPath));
        if (fs.existsSync(legacyPath)) {
            fs.copyFileSync(legacyPath, targetPath);
            console.log(`🔄 [FACTURACION-TA-SYNC] TA previo migrado desde Afip_res a ${targetPath}`);
        }
    } catch (_) {}
}

async function asegurarTablaAfipTa() {
    if (_tablaTaVerificada) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.factura_afip_ta (
                id SERIAL PRIMARY KEY,
                entorno VARCHAR(10) NOT NULL,
                servicio VARCHAR(20) NOT NULL DEFAULT 'wsfe',
                token TEXT NOT NULL,
                sign TEXT NOT NULL,
                expira_en TIMESTAMPTZ NOT NULL,
                creado_en TIMESTAMPTZ DEFAULT NOW(),
                cuit VARCHAR(20) DEFAULT '23248921749',
                ta_raw_json JSONB,
                origen_host VARCHAR(100),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT factura_afip_ta_entorno_servicio_key UNIQUE (entorno, servicio)
            );
            ALTER TABLE public.factura_afip_ta
                ADD COLUMN IF NOT EXISTS cuit VARCHAR(20) DEFAULT '23248921749',
                ADD COLUMN IF NOT EXISTS ta_raw_json JSONB,
                ADD COLUMN IF NOT EXISTS origen_host VARCHAR(100),
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        `);
        _tablaTaVerificada = true;
    } catch (err) {
        console.warn('⚠️ [FACTURACION-TA-SYNC] No se pudo verificar esquema factura_afip_ta:', err.message);
    }
}

/**
 * Lee `public.factura_afip_ta` y si el Ticket de Acceso en PostgreSQL está vigente y es más reciente
 * que el archivo local en `src/facturacion/certs/TA-*.json` (o si el archivo local no existe),
 * reconstruye el JSON en disco antes de que `@afipsdk/afip.js` invoque WSAA.
 */
async function sincronizarTADesdeBDHaciaDisco(service = 'wsfe') {
    await asegurarTablaAfipTa();
    migrarTaLegacySiExiste(service);

    const taFilePath = obtenerRutaArchivoTA(service);
    const res = await pool.query(
        `SELECT entorno, servicio, token, sign, expira_en, cuit, ta_raw_json, origen_host
         FROM public.factura_afip_ta
         WHERE entorno = $1 AND servicio = $2
         LIMIT 1`,
        [ENTORNO, service]
    );

    if (!res.rows || res.rows.length === 0) {
        return { syncedFromDb: false, reason: 'no_db_record' };
    }

    const dbRow = res.rows[0];
    const dbExp = new Date(dbRow.expira_en);
    const marginNow = new Date(Date.now() + 10 * 60 * 1000);
    if (isNaN(dbExp.getTime()) || dbExp <= marginNow) {
        return { syncedFromDb: false, reason: 'db_ta_expired' };
    }

    let diskExp = new Date(0);
    let diskExists = false;
    if (fs.existsSync(taFilePath)) {
        try {
            const rawDisk = JSON.parse(fs.readFileSync(taFilePath, 'utf8'));
            const expStr = rawDisk && rawDisk.header && rawDisk.header[1] && rawDisk.header[1].expirationtime;
            if (expStr) {
                diskExp = new Date(expStr);
                diskExists = true;
            }
        } catch (_) {}
    }

    if (!diskExists || dbExp.getTime() > diskExp.getTime() + 1000) {
        const taPayload = (dbRow.ta_raw_json && typeof dbRow.ta_raw_json === 'object' && dbRow.ta_raw_json.credentials)
            ? dbRow.ta_raw_json
            : {
                header: [
                    { version: '1.0' },
                    { expirationtime: dbExp.toISOString() }
                ],
                credentials: {
                    token: dbRow.token,
                    sign: dbRow.sign
                }
            };

        if (!fs.existsSync(CERTS_DIR)) {
            fs.mkdirSync(CERTS_DIR, { recursive: true });
        }
        fs.writeFileSync(taFilePath, JSON.stringify(taPayload, null, 2), 'utf8');
        try {
            delete require.cache[require.resolve(taFilePath)];
        } catch (_) {}
        console.log(`🔄 [FACTURACION-TA-SYNC] TA (${ENTORNO}/${service}) reconstruido en disco desde PostgreSQL (expira: ${dbExp.toISOString()}, origen: ${dbRow.origen_host || 'BD'}).`);
        return { syncedFromDb: true, taFilePath, expiresAt: dbExp.toISOString() };
    }

    return { syncedFromDb: false, reason: 'disk_up_to_date', taFilePath };
}

/**
 * Lee el archivo `src/facturacion/certs/TA-*.json` vigente en disco y lo persiste/actualiza
 * en `public.factura_afip_ta` para que el espejo de 15m y cualquier nodo de respaldo tengan el TA real.
 */
async function respaldarTADiscoHaciaBD(service = 'wsfe') {
    await asegurarTablaAfipTa();
    migrarTaLegacySiExiste(service);

    const taFilePath = obtenerRutaArchivoTA(service);
    if (!fs.existsSync(taFilePath)) {
        return { backedUpToDb: false, reason: 'no_disk_file' };
    }

    let taData;
    try {
        taData = JSON.parse(fs.readFileSync(taFilePath, 'utf8'));
    } catch (err) {
        return { backedUpToDb: false, reason: 'invalid_disk_json', error: err.message };
    }

    const token = taData && taData.credentials && taData.credentials.token;
    const sign = taData && taData.credentials && taData.credentials.sign;
    const expStr = taData && taData.header && taData.header[1] && taData.header[1].expirationtime;
    if (!token || !sign || !expStr) {
        return { backedUpToDb: false, reason: 'incomplete_ta_fields' };
    }

    const expDate = new Date(expStr);
    if (isNaN(expDate.getTime())) {
        return { backedUpToDb: false, reason: 'invalid_expiration_date' };
    }

    const hostName = `${os.hostname()}:${process.env.LAMDA_ROLE || 'PRIMARY'}`;
    await pool.query(
        `INSERT INTO public.factura_afip_ta
            (entorno, servicio, token, sign, expira_en, cuit, ta_raw_json, origen_host, creado_en, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())
         ON CONFLICT (entorno, servicio) DO UPDATE SET
            token = EXCLUDED.token,
            sign = EXCLUDED.sign,
            expira_en = EXCLUDED.expira_en,
            cuit = EXCLUDED.cuit,
            ta_raw_json = EXCLUDED.ta_raw_json,
            origen_host = EXCLUDED.origen_host,
            updated_at = NOW()
         WHERE EXCLUDED.expira_en >= public.factura_afip_ta.expira_en`,
        [ENTORNO, service, token, sign, expDate.toISOString(), String(CUIT), JSON.stringify(taData), hostName]
    );

    return { backedUpToDb: true, expiresAt: expDate.toISOString(), taFilePath };
}

// Interceptar de manera transparente afip.GetServiceTA para sincronizar BD <-> Disco en cada operación WSFE
const _originalGetServiceTA = afip.GetServiceTA.bind(afip);
afip.GetServiceTA = async function (service = 'wsfe', firstTry = true) {
    try {
        await sincronizarTADesdeBDHaciaDisco(service);
    } catch (syncErr) {
        console.warn(`⚠️ [FACTURACION-TA-SYNC] Aviso previo a GetServiceTA:`, syncErr.message);
    }
    const taCredentials = await _originalGetServiceTA(service, firstTry);
    try {
        await respaldarTADiscoHaciaBD(service);
    } catch (backupErr) {
        console.warn(`⚠️ [FACTURACION-TA-SYNC] Aviso posterior a GetServiceTA:`, backupErr.message);
    }
    return taCredentials;
};

// Sincronización inicial no bloqueante al cargar el módulo
sincronizarTADesdeBDHaciaDisco('wsfe')
    .then(() => respaldarTADiscoHaciaBD('wsfe'))
    .catch(() => {});

console.log('🔍 [FACTURACION-WSFE] Cargando servicio WSFE con afip.js + Doble Persistencia TA...');
console.log(`   Modo Producción: ${afip.options.production}`);
console.log(`   CUIT: ${afip.options.CUIT}`);
console.log(`   Carpeta Certs/TA: ${CERTS_DIR}`);

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

        let payload = {
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

        const lastVoucher = nextVoucher - 1;
        let usarExistente = false;
        let caeExistente = null;
        let caeVtoExistente = null;

        if (lastVoucher > 0) {
            try {
                console.log(`🔍 [FACTURACION-WSFE] Verificando si el último comprobante en AFIP (${lastVoucher}) ya fue autorizado para esta factura...`);
                const voucherInfo = await afip.ElectronicBilling.getVoucherInfo(lastVoucher, factura.pto_vta, factura.tipo_cbte);
                if (voucherInfo && 
                    voucherInfo.Resultado === 'A' && 
                    Number(voucherInfo.ImpTotal) === Number(payload.ImpTotal) && 
                    Number(voucherInfo.DocNro) === Number(payload.DocNro)) {
                    
                    const queryCheckNro = `
                        SELECT id FROM factura_facturas 
                        WHERE pto_vta = $1 AND tipo_cbte = $2 AND cbte_nro = $3 AND id != $4 AND estado IN ('APROBADA', 'APROBADA_LOCAL')
                    `;
                    const resCheckNro = await pool.query(queryCheckNro, [factura.pto_vta, factura.tipo_cbte, lastVoucher, facturaId]);
                    
                    if (resCheckNro.rows.length === 0) {
                        console.log(`⚠️ [FACTURACION-WSFE] El último comprobante en AFIP (Nº ${lastVoucher}) coincide en totales y DNI, y no está registrado localmente. Reutilizando CAE para evitar duplicados.`);
                        usarExistente = true;
                        caeExistente = voucherInfo.CodAutorizacion;
                        caeVtoExistente = voucherInfo.FchVto;
                    }
                }
            } catch (err) {
                console.log(`   [FACTURACION-WSFE] No se pudo verificar reutilización de comprobante anterior: ${err.message}`);
            }
        }

        let res;
        if (usarExistente) {
            res = {
                CAE: caeExistente,
                CAEFchVto: caeVtoExistente,
                _reutilizado: true
            };
        } else {
            res = await afip.ElectronicBilling.createVoucher(payload);
        }

        console.log('\n======================================================');
        console.log('📥 [VIGÍA - PASO 4: RESPUESTA CRUDA (ÉXITO)]');
        console.log('======================================================');
        console.log(JSON.stringify(res, null, 2));

        const cae = res.CAE; // CAE asignado 
        const vto = res.CAEFchVto; // Fecha vencimiento (YYYYMMDD)

        console.log(`✅ [FACTURACION-WSFE] Respuesta AFIP: CAE=${cae}, Vto=${vto}`);

        const vtoLimpio = String(vto || '').replace(/\D/g, '');
        const resultadoParseado = {
            cae: cae,
            cae_vto: vtoLimpio.length === 8 ? `${vtoLimpio.substring(0, 4)}-${vtoLimpio.substring(4, 6)}-${vtoLimpio.substring(6, 8)}` : vto,
            cbte_nro: usarExistente ? lastVoucher : nextVoucher,
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
    consultarComprobante,
    sincronizarTADesdeBDHaciaDisco,
    respaldarTADiscoHaciaBD,
    obtenerRutaArchivoTA
};
