/**
 * Servicio de Pagos en Efectivo Ensobrados (Módulo Logística & ERP LAMDA)
 * Maneja la auditoría, recepción física y acreditación transaccional en Cuentas Corrientes.
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { pool, ejecutarTransaccion } = require('../config/database');
const CuentaCorrienteService = require('./cuentaCorrienteService');

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

const supabaseAdmin = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : null;

const CLOUDFLARE_PORTAL_URL = process.env.B2B_PORTAL_URL || 'https://proud-darkness-ac3d.miserrano75.workers.dev';

class PagosEfectivoService {
    /**
     * Lista todos los sobres registrados en el sistema con filtros opcionales.
     * Incluye datos del cliente búnker y su saldo de cuenta corriente actual.
     * 
     * @param {Object} filtros - Filtros de búsqueda
     * @param {string} [filtros.estado] - Estado ('PREPARADO', 'EN_TRANSITO', 'RECIBIDO_LOCAL', 'ACREDITADO', 'OBSERVADO', 'CANCELADO')
     * @param {string} [filtros.cliente_id] - Código de cliente (ej: 'CB-0034')
     * @param {string} [filtros.modalidad] - 'CHOFER' | 'LOCAL'
     * @returns {Promise<Array>} Lista de sobres enriquecidos
     */
    static async listarSobres(filtros = {}) {
        let query = `
            SELECT 
                p.id,
                p.codigo_sobre,
                p.cliente_id,
                p.monto_declarado,
                p.desglose_billetes,
                p.foto_frente_url,
                p.foto_dorso_url,
                p.modalidad_entrega,
                p.estado,
                p.observaciones_cliente,
                p.observaciones_admin,
                p.local_movimiento_id,
                p.recibo_url,
                p.monto_auditado,
                p.auditado_por,
                p.fecha_auditoria,
                p.chofer_nombre,
                p.recibo_url,
                p.monto_auditado,
                p.auditado_por,
                p.fecha_auditoria,
                p.chofer_nombre,
                p.fecha_retiro_chofer,
                p.id_ruta,
                p.orden_entrega,
                p.id_domicilio_entrega,
                r.nombre_ruta AS ruta_nombre,
                r.estado AS ruta_estado,
                p.fecha_creacion,
                p.fecha_actualizacion,
                COALESCE(c.razon_social, c.cliente_nombre, p.cliente_id) AS cliente_razon_social,
                COALESCE(c.cliente_nombre, c.razon_social, p.cliente_id) AS cliente_nombre_fantasia,
                c.cuit_cuil AS cliente_cuit,
                c.whatsapp_facturas AS cliente_telefono,
                cc.id AS cuenta_corriente_id,
                COALESCE(cc.saldo, 0.00) AS saldo_cuenta_corriente
            FROM public.factura_pagos_efectivo p
            LEFT JOIN public.bunker_clientes c ON c.codigo_bunker_cliente = p.cliente_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = p.cliente_id
            LEFT JOIN public.rutas r ON r.id = p.id_ruta
            WHERE 1=1
        `;

        const values = [];
        let valIndex = 1;

        if (filtros.estado && filtros.estado !== 'TODOS') {
            query += ` AND p.estado = $${valIndex}`;
            values.push(filtros.estado);
            valIndex++;
        }

        if (filtros.cliente_id) {
            query += ` AND p.cliente_id = $${valIndex}`;
            values.push(filtros.cliente_id);
            valIndex++;
        }

        if (filtros.modalidad) {
            query += ` AND p.modalidad_entrega = $${valIndex}`;
            values.push(filtros.modalidad);
            valIndex++;
        }

        query += ` ORDER BY p.fecha_creacion DESC`;

        const res = await pool.query(query, values);
        return res.rows;
    }

    /**
     * Obtiene los datos detallados de un sobre por su ID o Código.
     * 
     * @param {number|string} identificador - ID numérico o código 'SOB-XXXX'
     * @returns {Promise<Object>} Sobre detallado
     */
    static async obtenerSobre(identificador) {
        const isId = !isNaN(parseInt(identificador)) && !String(identificador).startsWith('SOB-');
        const query = `
            SELECT 
                p.*,
                COALESCE(c.razon_social, c.cliente_nombre, p.cliente_id) AS cliente_razon_social,
                COALESCE(c.cliente_nombre, c.razon_social, p.cliente_id) AS cliente_nombre_fantasia,
                c.cuit_cuil AS cliente_cuit,
                c.whatsapp_facturas AS cliente_telefono,
                c.domicilio_fiscal AS cliente_domicilio,
                cc.id AS cuenta_corriente_id,
                COALESCE(cc.saldo, 0.00) AS saldo_cuenta_corriente
            FROM public.factura_pagos_efectivo p
            LEFT JOIN public.bunker_clientes c ON c.codigo_bunker_cliente = p.cliente_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = p.cliente_id
            WHERE ${isId ? 'p.id = $1' : 'p.codigo_sobre = $1'}
        `;

        const res = await pool.query(query, [identificador]);
        if (res.rows.length === 0) {
            throw new Error(`No se encontró el sobre especificado (${identificador}).`);
        }
        return res.rows[0];
    }

    /**
     * Aprueba y acredita un sobre de efectivo en la Cuenta Corriente del cliente.
     * Ejecuta una transacción atómica que crea el movimiento contable, recalcula el saldo
     * y deja listo el registro para sincronización bidireccional.
     * 
     * @param {Object} params
     * @param {number|string} params.sobreId - ID del sobre a acreditar
     * @param {number} [params.montoAuditado] - Monto real contado (si difiere del declarado)
     * @param {string} [params.operador] - Nombre del administrativo que auditó
     * @param {string} [params.observacionesAdmin] - Notas de la auditoría
     * @returns {Promise<Object>} Resultado de la acreditación
     */
    static async aprobarYAcreditar({ sobreId, montoAuditado, operador = 'Administración', observacionesAdmin = '', desgloseAuditado = null, diferenciasArqueo = null, modoFacturacionInteres = null }) {
        console.log(`⚡ [PAGOS-EFECTIVO-SERVICE] Iniciando acreditación para sobre ID/Código: ${sobreId}`);

        return await ejecutarTransaccion(async (client) => {
            // 1. Obtener y bloquear el registro del sobre
            const isId = !isNaN(parseInt(sobreId)) && !String(sobreId).startsWith('SOB-');
            const resSobre = await client.query(
                `SELECT * FROM public.factura_pagos_efectivo WHERE ${isId ? 'id = $1' : 'codigo_sobre = $1'} FOR UPDATE`,
                [sobreId]
            );

            if (resSobre.rows.length === 0) {
                throw new Error('El sobre especificado no existe.');
            }

            const sobre = resSobre.rows[0];

            if (sobre.estado === 'ACREDITADO') {
                throw new Error(`El sobre ${sobre.codigo_sobre} ya fue acreditado previamente (Movimiento #${sobre.local_movimiento_id}).`);
            }

            if (sobre.estado === 'CANCELADO') {
                throw new Error(`El sobre ${sobre.codigo_sobre} se encuentra cancelado.`);
            }

            const montoFinal = parseFloat(montoAuditado) > 0 ? parseFloat(montoAuditado) : parseFloat(sobre.monto_declarado);
            if (isNaN(montoFinal) || montoFinal <= 0) {
                throw new Error('El monto a acreditar debe ser mayor que cero.');
            }

            // Extraer modoFacturacionInteres si vino embebido en desgloseAuditado (compatibilidad hot-reload)
            let desgloseLimpio = desgloseAuditado && typeof desgloseAuditado === 'object'
                ? { ...desgloseAuditado }
                : (sobre.desglose_billetes || {});
            let modoInteres = modoFacturacionInteres || desgloseLimpio.__modo_facturacion_interes || 'APROBACION_INTERNA';
            if (desgloseLimpio && Object.prototype.hasOwnProperty.call(desgloseLimpio, '__modo_facturacion_interes')) {
                delete desgloseLimpio.__modo_facturacion_interes;
            }
            modoInteres = String(modoInteres).toUpperCase();

            // 2. Obtener o auto-crear la Cuenta Corriente del cliente
            let ccId;
            const resCC = await client.query(
                `SELECT id, saldo FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1 FOR UPDATE`,
                [sobre.cliente_id]
            );

            if (resCC.rows.length === 0) {
                console.log(`💳 [PAGOS-EFECTIVO-SERVICE] Auto-creando Cuenta Principal para cliente: ${sobre.cliente_id}`);
                const resNewCC = await client.query(
                    `INSERT INTO public.factura_cuentas_corrientes (codigo_bunker_cliente, nombre_cuenta, moneda, saldo, saldo_apertura)
                     VALUES ($1, 'Cuenta Principal', 'ARS', 0.00, 0.00)
                     RETURNING id, saldo`,
                    [sobre.cliente_id]
                );
                ccId = resNewCC.rows[0].id;
            } else {
                ccId = resCC.rows[0].id;
            }

            // 3. Simular imputación FIFO antes de insertar los movimientos para detectar si cancela Interés de Financiación + Capital
            delete require.cache[require.resolve('./composicionSaldoService')];
            const composicionSaldoService = require('./composicionSaldoService');
            const simImputacion = await composicionSaldoService.simularImputacionPago(ccId, montoFinal, client);

            const fmtMoneda = (val) => {
                const parts = (parseFloat(val) || 0).toFixed(2).split('.');
                return `$ ${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${parts[1]}`;
            };

            const baseMetadatosArqueo = {
                tipo_pago: 'Efectivo Ensobrado',
                codigo_sobre: sobre.codigo_sobre,
                monto_declarado: parseFloat(sobre.monto_declarado),
                monto_auditado: montoFinal,
                desglose_billetes: sobre.desglose_billetes,
                desglose_auditado: desgloseLimpio,
                diferencias_arqueo: Array.isArray(diferenciasArqueo) ? diferenciasArqueo : [],
                auditado_por: operador,
                fecha_auditoria: new Date().toISOString(),
                fotos: [sobre.foto_frente_url, sobre.foto_dorso_url].filter(Boolean),
                observaciones: observacionesAdmin || null
            };

            let movimientoCreado = null;
            let movimientoInteresCreado = null;
            let movimientoDebitoInteresCreado = null;
            let facturaInteresInfo = null;

            if (modoInteres !== 'BONIFICAR' && simImputacion && simImputacion.tiene_financiacion_imputada && simImputacion.financiacion_con_iva_cancelada > 0.005) {
                const capCancelado = simImputacion.capital_cancelado_total;
                const intNeto = simImputacion.financiacion_neta_cancelada;
                const intIva = simImputacion.financiacion_iva_cancelada;
                const intConIva = simImputacion.financiacion_con_iva_cancelada;
                const detallesFin = (simImputacion.detalles_comprobantes || []).filter(d => d.con_financiacion);
                const resumenDocs = detallesFin.map(d => {
                    const nomCorto = (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
                    return `${nomCorto} (${d.dias_al_pago}d al ${d.tasa_tem || 3}% mensual)`;
                }).join(' + ');
                const resumenFacturasCorto = (simImputacion.detalles_comprobantes || []).map(d => {
                    return (d.comprobante_descripcion || 'Comprobante').split('(')[0].trim();
                }).join(' + ') || 'comprobante en cuenta corriente';
                const diasMaxFin = detallesFin.length > 0 ? detallesFin[0].dias_al_pago : 15;

                // 3.A. Crear el comprobante de Servicio de Financiación (en Bandeja de Aprobación / ARCA o emitido directo)
                const facturaService = require('../../facturacion/services/facturaService');
                const cliRes = await client.query(
                    `SELECT id, codigo_bunker_cliente, cliente_nombre, razon_social, cuit_cuil, condicion_iva, lomas_soft_id
                     FROM public.bunker_clientes
                     WHERE codigo_bunker_cliente = $1
                     LIMIT 1`,
                    [sobre.cliente_id]
                );
                const bc = cliRes.rows[0] || {};
                const clienteIdNum = parseInt(String(bc.lomas_soft_id || '').replace(/\D/g, ''), 10) || bc.id || 1;
                const cuitStr = String(bc.cuit_cuil || '').replace(/\D/g, '');
                const condIvaStr = String(bc.condicion_iva || '').toLowerCase();
                const esRI = condIvaStr.includes('inscripto');
                const condicionIvaId = esRI ? 1 : (condIvaStr.includes('monotrib') ? 6 : (condIvaStr.includes('exento') ? 4 : 5));
                const docTipo = cuitStr.length === 11 ? 80 : 96;
                const docNro = cuitStr || '0';

                const esCircuitoArca = (modoInteres === 'ARCA' || modoInteres === 'APROBACION_ARCA' || modoInteres === 'BANDEJA_ARCA');
                const emitirAhora = (modoInteres === 'INTERNA' || modoInteres === 'ARCA');
                const ptoVta = esCircuitoArca ? 32 : 90;
                const tipoCbte = esCircuitoArca ? (esRI ? 1 : 6) : 6;
                const ahoraDate = new Date();
                const fechaEmisionStr = ahoraDate.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
                const descItem = `Servicio de Financiación LAMDA s/ capital cancelado (${fmtMoneda(capCancelado)}) de ${resumenDocs || 'cuenta corriente'} — Sobre #${sobre.codigo_sobre}`;

                const borrador = await facturaService.crearBorrador({
                    tipo_cbte: tipoCbte,
                    pto_vta: ptoVta,
                    concepto: 1,
                    fecha_emision: fechaEmisionStr,
                    precio_modo: 'NETO',
                    requiere_afip: esCircuitoArca,
                    serie_interna: esCircuitoArca ? null : 'X',
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
                            p_unit: intNeto,
                            alic_iva_id: 1,
                            costo_unitario: 0.0001
                        }
                    ]
                });

                await client.query(
                    `UPDATE public.factura_facturas
                     SET imp_neto = $1, imp_iva = $2, imp_total = $3, stock_descontado = TRUE
                     WHERE id = $4`,
                    [intNeto, intIva, intConIva, borrador.id]
                );
                await client.query(
                    `UPDATE public.factura_factura_items
                     SET p_unit = $1, imp_neto = $1, imp_iva = $2
                     WHERE factura_id = $3`,
                    [intNeto, intIva, borrador.id]
                );

                let facturaFinal = borrador;
                let etiquetaComp = '';
                let tipoCompMovDebito = 'PENDIENTE_FACTURACION';

                if (emitirAhora) {
                    facturaFinal = await facturaService.emitir(borrador.id);
                    tipoCompMovDebito = 'FACTURA';
                    if (esCircuitoArca && facturaFinal.estado === 'APROBADA') {
                        const ptoPad = String(facturaFinal.pto_vta).padStart(4, '0');
                        const nroPad = String(facturaFinal.cbte_nro).padStart(8, '0');
                        const letraStr = tipoCbte === 1 ? 'Factura A' : 'Factura B';
                        etiquetaComp = `${letraStr} ${ptoPad}-${nroPad} (CAE: ${facturaFinal.cae || 'N/A'})`;
                    } else {
                        const nroIntPad = String(facturaFinal.nro_interno || facturaFinal.cbte_nro || facturaFinal.id).padStart(8, '0');
                        etiquetaComp = `Fac X0090-${nroIntPad}`;
                    }
                } else {
                    if (esCircuitoArca) {
                        const letraStr = tipoCbte === 1 ? 'Factura A' : 'Factura B';
                        etiquetaComp = `${letraStr} Pto. 0032 (Pend. CAE en ARCA #${borrador.id})`;
                    } else {
                        etiquetaComp = `Comp. Interno X0090 (En Aprobación #${borrador.id})`;
                    }
                }

                const fechaDebitoInteres = new Date(ahoraDate.getTime() - 2000);
                const fechaCreditoInteres = new Date(ahoraDate.getTime() - 1000);
                const fechaCreditoCapital = ahoraDate;

                const descMovDebito = `${etiquetaComp} — Servicio Financiación ${diasMaxFin}d (Sobre #${sobre.codigo_sobre})`;
                const metaDebito = {
                    es_cargo_financiacion: true,
                    modo_facturacion: modoInteres,
                    codigo_sobre: sobre.codigo_sobre,
                    monto_total_sobre: montoFinal,
                    capital_cancelado: capCancelado,
                    financiacion_neta: intNeto,
                    financiacion_iva: intIva,
                    financiacion_con_iva: intConIva,
                    detalles_comprobantes: simImputacion.detalles_comprobantes
                };

                // Verificar si emitir() ya insertó el movimiento en CC; si no, insertarlo
                const existDebRes = await client.query(
                    `SELECT id FROM public.factura_cuenta_corriente_movimientos WHERE cuenta_corriente_id = $1 AND comprobante_id = $2`,
                    [ccId, facturaFinal.id]
                );
                if (existDebRes.rows.length > 0) {
                    const upDeb = await client.query(
                        `UPDATE public.factura_cuenta_corriente_movimientos
                         SET descripcion = $1, fecha_movimiento = $2, metadatos = $3::jsonb
                         WHERE id = $4
                         RETURNING *`,
                        [descMovDebito, fechaDebitoInteres, JSON.stringify(metaDebito), existDebRes.rows[0].id]
                    );
                    movimientoDebitoInteresCreado = upDeb.rows[0];
                } else {
                    const insDeb = await client.query(
                        `INSERT INTO public.factura_cuenta_corriente_movimientos (
                            cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                            tipo_comprobante, comprobante_id, descripcion, fecha_movimiento, metadatos
                         ) VALUES ($1, 'DEBITO', $2, 0.00, $3, $4, $5, $6, $7)
                         RETURNING *`,
                        [ccId, intConIva, tipoCompMovDebito, facturaFinal.id, descMovDebito, fechaDebitoInteres, JSON.stringify(metaDebito)]
                    );
                    movimientoDebitoInteresCreado = insDeb.rows[0];
                }

                // 3.B. Insertar Crédito 1: Cancelación del Interés de Financiación (-$ 2.658,92)
                const descMovInteres = `Pago Efectivo (Sobre #${sobre.codigo_sobre}) — Cancelación Interés Financiación ${diasMaxFin}d (Parte de sobre ${fmtMoneda(montoFinal)})`;
                const metaInteres = {
                    ...baseMetadatosArqueo,
                    es_pago_financiacion: true,
                    es_desglose_separado_en_cc: true,
                    monto_total_sobre: montoFinal,
                    capital_cancelado_sobre: capCancelado,
                    financiacion_neta_sobre: intNeto,
                    financiacion_iva_sobre: intIva,
                    financiacion_con_iva_sobre: intConIva,
                    financiacion_facturada_id: facturaFinal.id,
                    financiacion_facturada_mov_id: movimientoDebitoInteresCreado.id,
                    financiacion_facturada_nro: etiquetaComp,
                    financiacion_facturada_modo: modoInteres,
                    detalles_comprobantes: simImputacion.detalles_comprobantes
                };

                const resMovInt = await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, descripcion, fecha_movimiento, metadatos
                     ) VALUES ($1, 'CREDITO', $2, 0.00, 'RECIBO_PAGO', $3, $4, $5)
                     RETURNING *`,
                    [ccId, intConIva, descMovInteres, fechaCreditoInteres, JSON.stringify(metaInteres)]
                );
                movimientoInteresCreado = resMovInt.rows[0];

                // 3.C. Insertar Crédito 2: Cancelación del Capital ya facturado (-$ 137.341,08)
                const descMovCapital = `Pago Efectivo (Sobre #${sobre.codigo_sobre}) — Cancelación Capital s/ ${resumenFacturasCorto} (Parte de sobre ${fmtMoneda(montoFinal)})`;
                const metaCapital = {
                    ...baseMetadatosArqueo,
                    es_pago_capital_separado: true,
                    es_desglose_separado_en_cc: true,
                    pago_interes_mov_id: movimientoInteresCreado.id,
                    debito_interes_mov_id: movimientoDebitoInteresCreado.id,
                    monto_total_sobre: montoFinal,
                    capital_cancelado_sobre: capCancelado,
                    financiacion_neta_sobre: intNeto,
                    financiacion_iva_sobre: intIva,
                    financiacion_con_iva_sobre: intConIva,
                    financiacion_facturada_id: facturaFinal.id,
                    financiacion_facturada_mov_id: movimientoDebitoInteresCreado.id,
                    financiacion_facturada_nro: etiquetaComp,
                    financiacion_facturada_modo: modoInteres,
                    detalles_comprobantes: simImputacion.detalles_comprobantes
                };

                const resMovCap = await client.query(
                    `INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, descripcion, fecha_movimiento, metadatos
                     ) VALUES ($1, 'CREDITO', $2, 0.00, 'RECIBO_PAGO', $3, $4, $5)
                     RETURNING *`,
                    [ccId, capCancelado, descMovCapital, fechaCreditoCapital, JSON.stringify(metaCapital)]
                );
                movimientoCreado = resMovCap.rows[0];

                // Vincular cruzadamente los IDs en los movimientos de interés y débito
                await client.query(
                    `UPDATE public.factura_cuenta_corriente_movimientos
                     SET metadatos = metadatos || $1::jsonb
                     WHERE id = $2`,
                    [JSON.stringify({ pago_capital_mov_id: movimientoCreado.id }), movimientoInteresCreado.id]
                );
                await client.query(
                    `UPDATE public.factura_cuenta_corriente_movimientos
                     SET metadatos = metadatos || $1::jsonb
                     WHERE id = $2`,
                    [JSON.stringify({ pago_origen_id: movimientoCreado.id, pago_interes_mov_id: movimientoInteresCreado.id }), movimientoDebitoInteresCreado.id]
                );

                facturaInteresInfo = {
                    factura_id: facturaFinal.id,
                    estado: facturaFinal.estado,
                    modo_facturacion: modoInteres,
                    etiqueta_comprobante: etiquetaComp,
                    capital_cancelado: capCancelado,
                    financiacion_neta: intNeto,
                    financiacion_iva: intIva,
                    financiacion_con_iva: intConIva
                };
            } else {
                // Sin interés de financiación o con financiación 100% bonificada: el 100% del sobre cancela capital
                if (modoInteres === 'BONIFICAR' && simImputacion && simImputacion.financiacion_con_iva_cancelada > 0.005) {
                    baseMetadatosArqueo.financiacion_bonificada = true;
                    baseMetadatosArqueo.financiacion_bonificada_con_iva = simImputacion.financiacion_con_iva_cancelada;
                }
                const descMovimiento = `Pago en efectivo ensobrado - Sobre #${sobre.codigo_sobre}`;
                const queryInsertMov = `
                    INSERT INTO public.factura_cuenta_corriente_movimientos (
                        cuenta_corriente_id, tipo_movimiento, monto, saldo_resultante,
                        tipo_comprobante, descripcion, fecha_movimiento, metadatos
                    ) VALUES ($1, 'CREDITO', $2, 0.00, 'RECIBO_PAGO', $3, NOW(), $4)
                    RETURNING *;
                `;

                const resMov = await client.query(queryInsertMov, [
                    ccId,
                    montoFinal,
                    descMovimiento,
                    JSON.stringify(baseMetadatosArqueo)
                ]);

                movimientoCreado = resMov.rows[0];
            }

            // 4. Recalcular saldos de la cuenta corriente
            await CuentaCorrienteService.recalcularSaldos(ccId, client);

            // 5. Actualizar el estado del sobre a ACREDITADO
            const queryUpdateSobre = `
                UPDATE public.factura_pagos_efectivo
                SET 
                    estado = 'ACREDITADO',
                    monto_auditado = $1,
                    auditado_por = $2,
                    fecha_actualizacion = NOW(),
                    fecha_auditoria = NOW(),
                    observaciones_admin = $3,
                    local_movimiento_id = $4,
                    sincronizado_supabase = false
                WHERE id = $5
                RETURNING *;
            `;

            const resUpdateSobre = await client.query(queryUpdateSobre, [
                montoFinal,
                operador,
                observacionesAdmin || null,
                movimientoCreado.id,
                sobre.id
            ]);

            console.log(`✅ [PAGOS-EFECTIVO-SERVICE] Sobre ${sobre.codigo_sobre} acreditado OK. Movimiento contable ID: ${movimientoCreado.id}`);

            const sobreActualizado = resUpdateSobre.rows[0];

            // 6. Intentar sincronizar inmediatamente con Supabase para evitar demoras o pisadas
            if (supabaseAdmin) {
                try {
                    const { error: supaErr } = await supabaseAdmin
                        .from('clientes_b2b_pagos_efectivo')
                        .update({
                            estado: 'ACREDITADO',
                            local_movimiento_id: movimientoCreado.id,
                            observaciones_admin: observacionesAdmin || null,
                            sincronizado_local: true,
                            updated_at: new Date().toISOString()
                        })
                        .eq('codigo_sobre', sobre.codigo_sobre);

                    if (!supaErr) {
                        await client.query(
                            `UPDATE public.factura_pagos_efectivo SET sincronizado_supabase = true WHERE id = $1`,
                            [sobre.id]
                        );
                        sobreActualizado.sincronizado_supabase = true;
                        console.log(`☁️ [PAGOS-EFECTIVO-SERVICE] Acreditación de ${sobre.codigo_sobre} sincronizada en Supabase en tiempo real.`);
                    } else {
                        console.warn(`⚠️ [PAGOS-EFECTIVO-SERVICE] No se pudo sincronizar acreditación en tiempo real (${supaErr.message}). Queda en cola.`);
                    }
                } catch (errSupa) {
                    console.warn(`⚠️ [PAGOS-EFECTIVO-SERVICE] Error de red sincronizando acreditación en Supabase: ${errSupa.message}`);
                }
            }

            return {
                success: true,
                sobre: sobreActualizado,
                movimiento: movimientoCreado,
                movimiento_interes: movimientoInteresCreado,
                movimiento_debito_interes: movimientoDebitoInteresCreado,
                desglose_imputacion: facturaInteresInfo
            };
        });
    }

    /**
     * Cambia el estado de un sobre (ej. recepcionado por chofer, recibido en mostrador, observado o cancelado).
     * 
     * @param {Object} params
     * @param {number|string} params.sobreId - ID o código
     * @param {string} params.nuevoEstado - 'EN_TRANSITO' | 'RECIBIDO_LOCAL' | 'OBSERVADO' | 'CANCELADO' | 'PREPARADO'
     * @param {string} [params.choferNombre] - Nombre del chofer que retira
     * @param {string} [params.observaciones] - Notas o motivo
     * @param {string} [params.operador] - Operador que registra el cambio
     * @param {string} [params.modalidadEntrega] - 'CHOFER' | 'LOCAL'
     * @returns {Promise<Object>} Sobre actualizado
     */
    static async actualizarEstado({ sobreId, nuevoEstado, choferNombre, observaciones, operador, modalidadEntrega }) {
        const isId = !isNaN(parseInt(sobreId)) && !String(sobreId).startsWith('SOB-');
        
        let query = `
            UPDATE public.factura_pagos_efectivo
            SET 
                estado = $1,
                sincronizado_supabase = false,
                fecha_actualizacion = NOW()
        `;
        const values = [nuevoEstado];
        let valIdx = 2;

        if (choferNombre) {
            query += `, chofer_nombre = $${valIdx}, fecha_retiro_chofer = NOW()`;
            values.push(choferNombre);
            valIdx++;
        }

        if (observaciones !== undefined) {
            query += `, observaciones_admin = $${valIdx}`;
            values.push(observaciones || null);
            valIdx++;
        }

        if (operador) {
            query += `, auditado_por = $${valIdx}`;
            values.push(operador);
            valIdx++;
        }

        if (modalidadEntrega && ['CHOFER', 'LOCAL'].includes(modalidadEntrega)) {
            query += `, modalidad_entrega = $${valIdx}`;
            values.push(modalidadEntrega);
            valIdx++;
            if (modalidadEntrega === 'LOCAL') {
                query += `, id_ruta = NULL, orden_entrega = NULL`;
            }
        }

        if (nuevoEstado === 'CANCELADO') {
            query += `, id_ruta = NULL, orden_entrega = NULL`;
        }

        query += ` WHERE ${isId ? 'id = $' + valIdx : 'codigo_sobre = $' + valIdx} RETURNING *;`;
        values.push(sobreId);

        const res = await pool.query(query, values);
        if (res.rows.length === 0) {
            throw new Error(`No se encontró el sobre ${sobreId}.`);
        }

        const sobreActualizado = res.rows[0];
        console.log(`🔄 [PAGOS-EFECTIVO-SERVICE] Sobre ${sobreActualizado.codigo_sobre} pasó a estado: ${nuevoEstado}`);

        // Sincronizar en tiempo real con Supabase
        if (supabaseAdmin) {
            try {
                const supaPayload = {
                    estado: nuevoEstado,
                    sincronizado_local: true,
                    updated_at: new Date().toISOString()
                };
                if (observaciones !== undefined) {
                    supaPayload.observaciones_admin = observaciones || null;
                }
                if (modalidadEntrega && ['CHOFER', 'LOCAL'].includes(modalidadEntrega)) {
                    supaPayload.modalidad_entrega = modalidadEntrega;
                }

                const { error: supaErr } = await supabaseAdmin
                    .from('clientes_b2b_pagos_efectivo')
                    .update(supaPayload)
                    .eq('codigo_sobre', sobreActualizado.codigo_sobre);

                if (!supaErr) {
                    await pool.query(
                        `UPDATE public.factura_pagos_efectivo SET sincronizado_supabase = true WHERE id = $1`,
                        [sobreActualizado.id]
                    );
                    sobreActualizado.sincronizado_supabase = true;
                    console.log(`☁️ [PAGOS-EFECTIVO-SERVICE] Cambio de estado de ${sobreActualizado.codigo_sobre} (${nuevoEstado}) sincronizado en Supabase.`);
                } else {
                    console.warn(`⚠️ [PAGOS-EFECTIVO-SERVICE] Advertencia al sincronizar estado en Supabase: ${supaErr.message}`);
                }
            } catch (errSupa) {
                console.warn(`⚠️ [PAGOS-EFECTIVO-SERVICE] Error de red al sincronizar estado con Supabase: ${errSupa.message}`);
            }
        }

        return sobreActualizado;
    }

    /**
     * Crea un sobre derivado en estado PENDIENTE_ENSOBRADO tanto en la base de datos local
     * como en Supabase, generando un token criptográfico único y un link público.
     * 
     * @param {Object} params
     * @param {string} params.clienteId - Código de cliente (ej: 'CB-0008') o PK
     * @param {number} params.montoDeclarado - Monto solicitado en pesos
     * @param {string} [params.colaboradorNombre] - Nombre del contacto / colaborador
     * @param {string} [params.colaboradorTelefono] - Teléfono / WhatsApp
     * @param {string} [params.colaboradorEmail] - Email
     * @param {string} [params.observaciones] - Observaciones o concepto
     * @param {string} [params.derivadoPor] - Origen de la derivación ('Chofer / Móvil LAMDA')
     * @returns {Promise<Object>} { sobre, token_publico, url_ensobrado, codigo_sobre }
     */
    static async crearSobreDerivado({ clienteId, montoDeclarado, colaboradorNombre, colaboradorTelefono, colaboradorEmail, observaciones, derivadoPor }) {
        if (!clienteId) {
            throw new Error('El código o ID de cliente es obligatorio.');
        }

        // 1. Resolver el cliente Búnker canónico para garantizar datos duros
        const ClientesBunkerModel = require('../models/clientesBunkerModel');
        const clienteBunker = await ClientesBunkerModel.obtenerPorId(clienteId);
        if (!clienteBunker) {
            throw new Error(`No se encontró el cliente con identificador: ${clienteId}`);
        }

        const codigoBunkerCanónico = clienteBunker.codigo_bunker_cliente || clienteId;
        const nombreTitular = clienteBunker.razon_social || clienteBunker.cliente_nombre || codigoBunkerCanónico;

        // 2. Generar código correlativo de sobre único (ej: SOB-XXXXXX)
        let codigoSobre = '';
        let exists = true;
        let attempts = 0;
        while (exists && attempts < 10) {
            attempts++;
            const randNum = Math.floor(100000 + Math.random() * 900000);
            codigoSobre = `SOB-${randNum}`;
            const check = await pool.query('SELECT 1 FROM public.factura_pagos_efectivo WHERE codigo_sobre = $1', [codigoSobre]);
            if (check.rows.length === 0) exists = false;
        }

        // 3. Generar token público UUID criptográfico
        const tokenPublico = crypto.randomUUID ? crypto.randomUUID() : (crypto.randomBytes(16).toString('hex'));

        const montoNum = parseFloat(montoDeclarado) || 0;
        const nombreColab = (colaboradorNombre || '').trim() || clienteBunker.cliente_nombre || 'Titular / Encargado';
        
        let telColab = (colaboradorTelefono || '').trim();
        if (!telColab && clienteBunker.whatsapp_facturas) {
            try {
                const parsedW = typeof clienteBunker.whatsapp_facturas === 'string' && clienteBunker.whatsapp_facturas.startsWith('[')
                    ? JSON.parse(clienteBunker.whatsapp_facturas)
                    : null;
                telColab = parsedW && parsedW.length > 0 ? parsedW[0].numero : clienteBunker.whatsapp_facturas;
            } catch (e) {
                telColab = clienteBunker.whatsapp_facturas;
            }
        }

        let emailColab = (colaboradorEmail || '').trim();
        if (!emailColab && clienteBunker.email_facturas) {
            try {
                const parsedE = typeof clienteBunker.email_facturas === 'string' && clienteBunker.email_facturas.startsWith('[')
                    ? JSON.parse(clienteBunker.email_facturas)
                    : null;
                emailColab = parsedE && parsedE.length > 0 ? parsedE[0].email : clienteBunker.email_facturas;
            } catch (e) {
                emailColab = clienteBunker.email_facturas;
            }
        }

        const obs = (observaciones || '').trim() || null;
        const origen = (derivadoPor || '').trim() || 'Chofer / Móvil LAMDA';

        // 4. Inserción local en PostgreSQL
        const insertLocalSql = `
            INSERT INTO public.factura_pagos_efectivo (
                codigo_sobre, cliente_id, monto_declarado, desglose_billetes,
                modalidad_entrega, estado, observaciones_cliente, token_publico,
                colaborador_nombre, colaborador_telefono, colaborador_email,
                derivado_por, fecha_derivacion, sincronizado_supabase, fecha_creacion, fecha_actualizacion
            ) VALUES (
                $1, $2, $3, '{}'::jsonb,
                'CHOFER', 'PENDIENTE_ENSOBRADO', $4, $5,
                $6, $7, $8,
                $9, NOW(), true, NOW(), NOW()
            )
            RETURNING *;
        `;
        const resLocal = await pool.query(insertLocalSql, [
            codigoSobre, codigoBunkerCanónico, montoNum, obs, tokenPublico,
            nombreColab, telColab, emailColab, origen
        ]);
        const sobreCreado = resLocal.rows[0];

        // 5. Inserción en Supabase (clientes_b2b_pagos_efectivo) para que el link público y el portal B2B lo reconozcan inmediatamente
        if (supabaseAdmin) {
            try {
                const { error: supaErr } = await supabaseAdmin
                    .from('clientes_b2b_pagos_efectivo')
                    .insert([{
                        codigo_sobre: codigoSobre,
                        cliente_id: codigoBunkerCanónico,
                        monto_declarado: montoNum > 0 ? montoNum : 1,
                        desglose_billetes: {},
                        foto_frente_url: null,
                        foto_dorso_url: null,
                        modalidad_entrega: 'CHOFER',
                        estado: 'PENDIENTE_ENSOBRADO',
                        observaciones_cliente: obs,
                        token_publico: tokenPublico,
                        colaborador_nombre: nombreColab,
                        colaborador_telefono: telColab,
                        colaborador_email: emailColab,
                        derivado_por: origen,
                        fecha_derivacion: new Date().toISOString(),
                        sincronizado_local: true
                    }]);
                if (supaErr) {
                    console.warn('⚠️ [PAGOS-EFECTIVO-SERVICE] Advertencia al insertar en Supabase:', supaErr.message);
                } else {
                    console.log(`☁️ [PAGOS-EFECTIVO-SERVICE] Sobre ${codigoSobre} insertado en Supabase OK.`);
                }
            } catch (errSupa) {
                console.warn('⚠️ [PAGOS-EFECTIVO-SERVICE] Error de conexión con Supabase:', errSupa.message);
            }
        }

        const urlEnsobrado = `${CLOUDFLARE_PORTAL_URL}/#ensobrado/${tokenPublico}`;

        console.log(`✅ [PAGOS-EFECTIVO-SERVICE] Sobre derivado creado: ${codigoSobre} para ${codigoBunkerCanónico} (${nombreTitular}) -> ${urlEnsobrado}`);

        return {
            sobre: {
                ...sobreCreado,
                cliente_nombre: clienteBunker.cliente_nombre,
                razon_social: clienteBunker.razon_social,
                saldo_cuenta_corriente: clienteBunker.saldo || 0
            },
            codigo_sobre: codigoSobre,
            token_publico: tokenPublico,
            url_ensobrado: urlEnsobrado,
            cliente: {
                id: clienteBunker.id,
                codigo_bunker: codigoBunkerCanónico,
                nombre: clienteBunker.cliente_nombre,
                razon_social: clienteBunker.razon_social,
                cuit: clienteBunker.cuit_cuil,
                saldo: clienteBunker.saldo || 0,
                whatsapp: telColab,
                email: emailColab
            }
        };
    }
}

module.exports = PagosEfectivoService;
