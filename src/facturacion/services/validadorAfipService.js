/**
 * Servicio de Validación Pre-AFIP
 * Valida que una factura esté lista para enviar a WSFE
 */

const { pool } = require('../config/database');
const { TIPOS_COMPROBANTE, TIPOS_DOCUMENTO, TIPOS_CONCEPTO, TOPE_CF_SIN_IDENTIFICAR } = require('../config/afip');

console.log('🔍 [VALIDADOR-AFIP] Cargando servicio de validación...');

/**
 * Validar factura completa para AFIP
 */
async function validarFacturaParaAfip(facturaId) {
    console.log(`🔍 [VALIDADOR-AFIP] Validando factura ${facturaId} para AFIP...`);
    
    try {
        // Obtener factura con items
        const facturaQuery = `
            SELECT f.*, 
                   COUNT(i.id) as items_count,
                   SUM(i.imp_neto) as items_neto,
                   SUM(i.imp_iva) as items_iva
            FROM factura_facturas f
            LEFT JOIN factura_factura_items i ON f.id = i.factura_id
            WHERE f.id = $1
            GROUP BY f.id
        `;
        
        const result = await pool.query(facturaQuery, [facturaId]);
        
        if (result.rows.length === 0) {
            throw new Error(`Factura ${facturaId} no encontrada`);
        }
        
        const factura = result.rows[0];
        
        const faltantes = [];
        const advertencias = [];
        
        // Validar cabecera
        const faltantesCabecera = validarCabecera(factura);
        faltantes.push(...faltantesCabecera);
        
        // Validar items
        const faltantesItems = await validarItems(facturaId, factura);
        faltantes.push(...faltantesItems);
        
        // Validar fechas de servicio
        const faltantesFechas = validarFechasServicio(factura);
        faltantes.push(...faltantesFechas);
        
        // Validar documento receptor
        const faltantesDoc = validarDocumentoReceptor(factura);
        faltantes.push(...faltantesDoc);
        
        // Validar totales
        const faltantesTotales = validarTotales(factura);
        faltantes.push(...faltantesTotales);
        
        // Advertencias (no bloquean pero son importantes)
        if (factura.mon_cotiz === 1 && factura.moneda === 'PES') {
            advertencias.push({
                campo: 'mon_cotiz',
                mensaje: 'Cotización en 1 para pesos (correcto)'
            });
        }
        
        const readyForWSFE = faltantes.length === 0;
        
        console.log(`${readyForWSFE ? '✅' : '❌'} [VALIDADOR-AFIP] Validación completada: ${faltantes.length} faltantes`);
        
        return {
            facturaId,
            readyForWSFE,
            faltantes,
            advertencias,
            resumen: {
                estado: factura.estado,
                tipo_cbte: factura.tipo_cbte,
                concepto: factura.concepto,
                items_count: parseInt(factura.items_count) || 0,
                imp_total: parseFloat(factura.imp_total) || 0,
                requiere_afip: factura.requiere_afip
            }
        };
        
    } catch (error) {
        console.error(`❌ [VALIDADOR-AFIP] Error en validación:`, error.message);
        throw error;
    }
}

/**
 * Validar cabecera de factura
 */
function validarCabecera(factura) {
    console.log(`🔍 [VALIDADOR-AFIP] Validando cabecera...`);
    
    const faltantes = [];
    
    // Tipo de comprobante
    if (!factura.tipo_cbte) {
        faltantes.push({
            campo: 'tipo_cbte',
            mensaje: 'Falta tipo de comprobante'
        });
    } else if (!TIPOS_COMPROBANTE[factura.tipo_cbte]) {
        faltantes.push({
            campo: 'tipo_cbte',
            mensaje: `Tipo de comprobante ${factura.tipo_cbte} no válido`
        });
    }
    
    // Punto de venta
    if (!factura.pto_vta || factura.pto_vta <= 0) {
        faltantes.push({
            campo: 'pto_vta',
            mensaje: 'Punto de venta debe ser mayor a 0'
        });
    }
    
    // Concepto
    if (!factura.concepto) {
        faltantes.push({
            campo: 'concepto',
            mensaje: 'Falta concepto (1=Productos, 2=Servicios, 3=Ambos)'
        });
    } else if (![1, 2, 3].includes(factura.concepto)) {
        faltantes.push({
            campo: 'concepto',
            mensaje: 'Concepto debe ser 1, 2 o 3'
        });
    }
    
    // Fecha de emisión
    if (!factura.fecha_emision) {
        faltantes.push({
            campo: 'fecha_emision',
            mensaje: 'Falta fecha de emisión'
        });
    }
    
    // Condición IVA
    if (!factura.condicion_iva_id) {
        faltantes.push({
            campo: 'condicion_iva_id',
            mensaje: 'Falta condición de IVA del receptor'
        });
    }
    
    // Moneda
    if (!factura.moneda) {
        faltantes.push({
            campo: 'moneda',
            mensaje: 'Falta moneda'
        });
    } else if (factura.moneda !== 'PES') {
        faltantes.push({
            campo: 'moneda',
            mensaje: 'Por ahora solo se soporta moneda PES'
        });
    }
    
    // Cotización
    if (!factura.mon_cotiz) {
        faltantes.push({
            campo: 'mon_cotiz',
            mensaje: 'Falta cotización de moneda'
        });
    } else if (factura.moneda === 'PES' && Math.abs(parseFloat(factura.mon_cotiz) - 1) > 0.0001) {
        faltantes.push({
            campo: 'mon_cotiz',
            mensaje: 'Cotización debe ser 1 para pesos'
        });
    }
    
    // Estado
    if (factura.estado !== 'BORRADOR') {
        faltantes.push({
            campo: 'estado',
            mensaje: `Estado debe ser BORRADOR (actual: ${factura.estado})`
        });
    }
    
    console.log(`${faltantes.length === 0 ? '✅' : '⚠️'} [VALIDADOR-AFIP] Cabecera: ${faltantes.length} faltantes`);
    
    return faltantes;
}

/**
 * Validar items de factura
 */
async function validarItems(facturaId, factura) {
    console.log(`🔍 [VALIDADOR-AFIP] Validando items...`);
    
    const faltantes = [];
    
    // Verificar que tenga items
    const itemsCount = parseInt(factura.items_count) || 0;
    
    if (itemsCount === 0) {
        faltantes.push({
            campo: 'items',
            mensaje: 'La factura debe tener al menos 1 item'
        });
        return faltantes;
    }
    
    // Obtener items para validación detallada
    const itemsQuery = `
        SELECT * FROM factura_factura_items
        WHERE factura_id = $1
        ORDER BY orden
    `;
    
    const itemsResult = await pool.query(itemsQuery, [facturaId]);
    const items = itemsResult.rows;
    
    // Validar cada item
    items.forEach((item, index) => {
        const itemNum = index + 1;
        
        if (!item.descripcion || item.descripcion.trim() === '') {
            faltantes.push({
                campo: `items[${itemNum}].descripcion`,
                mensaje: `Item ${itemNum}: Falta descripción`
            });
        }
        
        if (!item.qty || item.qty <= 0) {
            faltantes.push({
                campo: `items[${itemNum}].qty`,
                mensaje: `Item ${itemNum}: Cantidad debe ser mayor a 0`
            });
        }
        
        if (item.p_unit === null || item.p_unit === undefined) {
            faltantes.push({
                campo: `items[${itemNum}].p_unit`,
                mensaje: `Item ${itemNum}: Falta precio unitario`
            });
        } else if (item.p_unit < 0) {
            faltantes.push({
                campo: `items[${itemNum}].p_unit`,
                mensaje: `Item ${itemNum}: Precio unitario no puede ser negativo`
            });
        }
        
        if (!item.alic_iva_id) {
            faltantes.push({
                campo: `items[${itemNum}].alic_iva_id`,
                mensaje: `Item ${itemNum}: Falta alícuota de IVA`
            });
        }
        
        // Validar cálculos
        const expectedNeto = item.qty * item.p_unit;
        const diffNeto = Math.abs(item.imp_neto - expectedNeto);
        
        if (diffNeto > 0.01) {
            faltantes.push({
                campo: `items[${itemNum}].imp_neto`,
                mensaje: `Item ${itemNum}: Importe neto incorrecto (esperado: ${expectedNeto.toFixed(2)}, actual: ${item.imp_neto})`
            });
        }
    });
    
    console.log(`${faltantes.length === 0 ? '✅' : '⚠️'} [VALIDADOR-AFIP] Items: ${faltantes.length} faltantes`);
    
    return faltantes;
}

/**
 * Validar fechas de servicio (solo si concepto = 2 o 3)
 */
function validarFechasServicio(factura) {
    console.log(`🔍 [VALIDADOR-AFIP] Validando fechas de servicio...`);
    
    const faltantes = [];
    
    // Solo validar si concepto es 2 (Servicios) o 3 (Productos y Servicios)
    if (factura.concepto === 2 || factura.concepto === 3) {
        if (!factura.fch_serv_desde) {
            faltantes.push({
                campo: 'fch_serv_desde',
                mensaje: 'Concepto de servicios requiere fecha de servicio desde'
            });
        }
        
        if (!factura.fch_serv_hasta) {
            faltantes.push({
                campo: 'fch_serv_hasta',
                mensaje: 'Concepto de servicios requiere fecha de servicio hasta'
            });
        }
        
        if (!factura.fch_vto_pago) {
            faltantes.push({
                campo: 'fch_vto_pago',
                mensaje: 'Concepto de servicios requiere fecha de vencimiento de pago'
            });
        }
        
        // Validar que fecha desde <= fecha hasta
        if (factura.fch_serv_desde && factura.fch_serv_hasta) {
            const desde = new Date(factura.fch_serv_desde);
            const hasta = new Date(factura.fch_serv_hasta);
            
            if (desde > hasta) {
                faltantes.push({
                    campo: 'fch_serv_desde',
                    mensaje: 'Fecha de servicio desde debe ser menor o igual a fecha hasta'
                });
            }
        }
    }
    
    console.log(`${faltantes.length === 0 ? '✅' : '⚠️'} [VALIDADOR-AFIP] Fechas servicio: ${faltantes.length} faltantes`);
    
    return faltantes;
}

/**
 * Validar documento del receptor
 */
function validarDocumentoReceptor(factura) {
    console.log(`🔍 [VALIDADOR-AFIP] Validando documento receptor...`);
    
    const faltantes = [];
    
    // Solo validar si requiere AFIP
    if (!factura.requiere_afip) {
        console.log(`ℹ️ [VALIDADOR-AFIP] Factura interna, no requiere validación de documento`);
        return faltantes;
    }
    
    const docTipoNum = parseInt(factura.doc_tipo, 10);
    const docNroStr = factura.doc_nro !== null && factura.doc_nro !== undefined ? String(factura.doc_nro).replace(/[-\s]/g, '') : '';

    if (!docTipoNum) {
        faltantes.push({
            campo: 'doc_tipo',
            mensaje: 'Falta tipo de documento del receptor'
        });
    } else if (!TIPOS_DOCUMENTO[docTipoNum]) {
        faltantes.push({
            campo: 'doc_tipo',
            mensaje: `Tipo de documento ${docTipoNum} no válido`
        });
    }

    if (docTipoNum === 99) {
        const impTotalNum = parseFloat(factura.imp_total) || 0;
        if (impTotalNum >= TOPE_CF_SIN_IDENTIFICAR) {
            faltantes.push({
                campo: 'doc_nro',
                mensaje: `ARCA (RG 5700/2025) exige DNI o CUIL para operaciones con Consumidor Final iguales o superiores a $${TOPE_CF_SIN_IDENTIFICAR.toLocaleString('es-AR')}`
            });
        }
    } else if (!docNroStr) {
        faltantes.push({
            campo: 'doc_nro',
            mensaje: 'Falta número de documento del receptor'
        });
    } else {
        // Validar formato según tipo
        if (docTipoNum === 80 || docTipoNum === 86) {
            // CUIT/CUIL: debe tener 11 dígitos
            if (!/^\d{11}$/.test(docNroStr)) {
                faltantes.push({
                    campo: 'doc_nro',
                    mensaje: `${docTipoNum === 86 ? 'CUIL' : 'CUIT'} debe tener 11 dígitos`
                });
            }
        } else if (docTipoNum === 96) {
            // DNI: debe tener 7-8 dígitos y no ser solo ceros
            if (!/^\d{7,8}$/.test(docNroStr) || /^0+$/.test(docNroStr)) {
                faltantes.push({
                    campo: 'doc_nro',
                    mensaje: 'DNI debe tener 7 u 8 dígitos'
                });
            }
        }
    }
    
    console.log(`${faltantes.length === 0 ? '✅' : '⚠️'} [VALIDADOR-AFIP] Documento: ${faltantes.length} faltantes`);
    
    return faltantes;
}

/**
 * Validar totales
 */
function validarTotales(factura) {
    console.log(`🔍 [VALIDADOR-AFIP] Validando totales...`);
    
    const faltantes = [];
    
    const impNeto = parseFloat(factura.imp_neto) || 0;
    const impIva = parseFloat(factura.imp_iva) || 0;
    const impTrib = parseFloat(factura.imp_trib) || 0;
    const impTotal = parseFloat(factura.imp_total) || 0;
    
    // Validar que los totales sean >= 0
    if (impNeto < 0) {
        faltantes.push({
            campo: 'imp_neto',
            mensaje: 'Importe neto no puede ser negativo'
        });
    }
    
    if (impIva < 0) {
        faltantes.push({
            campo: 'imp_iva',
            mensaje: 'Importe IVA no puede ser negativo'
        });
    }
    
    if (impTrib < 0) {
        faltantes.push({
            campo: 'imp_trib',
            mensaje: 'Importe tributos no puede ser negativo'
        });
    }
    
    if (impTotal <= 0) {
        faltantes.push({
            campo: 'imp_total',
            mensaje: 'Importe total debe ser mayor a 0'
        });
    }
    
    // Validar que total = neto + iva + trib
    const expectedTotal = impNeto + impIva + impTrib;
    const diffTotal = Math.abs(impTotal - expectedTotal);
    
    if (diffTotal > 0.01) {
        faltantes.push({
            campo: 'imp_total',
            mensaje: `Total incorrecto (esperado: ${expectedTotal.toFixed(2)}, actual: ${impTotal.toFixed(2)})`
        });
    }
    
    // Validar que totales de items coincidan con totales de factura
    const itemsNeto = parseFloat(factura.items_neto) || 0;
    const itemsIva = parseFloat(factura.items_iva) || 0;
    
    const diffNeto = Math.abs(impNeto - itemsNeto);
    const diffIva = Math.abs(impIva - itemsIva);
    
    if (diffNeto > 0.01) {
        faltantes.push({
            campo: 'imp_neto',
            mensaje: `Neto de factura no coincide con suma de items (factura: ${impNeto.toFixed(2)}, items: ${itemsNeto.toFixed(2)})`
        });
    }
    
    if (diffIva > 0.01) {
        faltantes.push({
            campo: 'imp_iva',
            mensaje: `IVA de factura no coincide con suma de items (factura: ${impIva.toFixed(2)}, items: ${itemsIva.toFixed(2)})`
        });
    }
    
    console.log(`${faltantes.length === 0 ? '✅' : '⚠️'} [VALIDADOR-AFIP] Totales: ${faltantes.length} faltantes`);
    
    return faltantes;
}

console.log('✅ [VALIDADOR-AFIP] Servicio de validación cargado');

module.exports = {
    validarFacturaParaAfip,
    validarCabecera,
    validarItems,
    validarFechasServicio,
    validarDocumentoReceptor,
    validarTotales
};
