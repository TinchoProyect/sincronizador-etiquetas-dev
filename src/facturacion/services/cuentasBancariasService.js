const XLSX = require('xlsx');
const crypto = require('crypto');
const { pool } = require('../config/database');
const geminiService = require('./geminiService');

/**
 * Normaliza y limpia un valor numérico desde Excel (ej. de string a float)
 * Controla formatos locales con coma como separador decimal.
 */
function parseMonto(val) {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    
    let str = String(val).trim();
    // Eliminar símbolos de moneda y espacios
    str = str.replace('$', '').replace(/\s/g, '');
    
    // Si tiene puntos y comas, ej. -1.234,56
    if (str.includes('.') && str.includes(',')) {
        str = str.replace(/\./g, ''); // Quitar miles (puntos)
        str = str.replace(',', '.');   // Cambiar decimal (coma a punto)
    } else if (str.includes(',')) {
        // Solo tiene comas, ej. -1234,56
        str = str.replace(',', '.');
    }
    
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

/**
 * Parsea una fecha en formato DD/MM/YYYY o serial de Excel
 */
function parseFecha(val) {
    if (!val) return null;
    
    // Si es un número (serial de fecha de Excel)
    if (typeof val === 'number') {
        const date = XLSX.SSF.parse_date_code(val);
        return new Date(date.y, date.m - 1, date.d);
    }
    
    const str = String(val).trim();
    
    // Formato DD/MM/YYYY o DD-MM-YYYY
    const parts = str.split(/[\/\-]/);
    if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1; // Mes es 0-indexed en JS
        let y = parseInt(parts[2], 10);
        if (y < 100) y += 2000; // Ajustar año de 2 dígitos
        
        const fecha = new Date(y, m, d);
        if (!isNaN(fecha.getTime())) {
            return fecha;
        }
    }
    
    // Fallback standard parse
    const standardDate = new Date(str);
    return isNaN(standardDate.getTime()) ? null : standardDate;
}

/**
 * Clasifica la operación basándose en el concepto y el sentido financiero (débito/crédito)
 */
function clasificarConcepto(concepto, debito = 0, credito = 0) {
    if (!concepto) return 'Otros';
    const c = concepto.toLowerCase();
    const deb = parseFloat(debito) || 0;
    const cred = parseFloat(credito) || 0;

    // 1. REGLAS PARA CRÉDITOS (Ingresos / Cobros / Depósitos)
    if (cred > 0) {
        // Transferencias / Pagos recibidos de clientes:
        // Detecta transferencias estándar y el servicio corporativo de Galicia "SERVICIO PAGO A PROVEEDORES"
        if (c.includes('servicio pago a proveedores') || c.includes('pago a proveedores') ||
            c.includes('transferencia') || c.includes('coelsa') || c.includes('terceros') || 
            c.includes('envio') || c.includes('recibo') || c.includes('trf') || c.includes('transf') || c.includes('alias')) {
            return 'Transferencia';
        }
        
        // Si tiene un CUIT explícito en el concepto y es crédito, es un cobro de cliente
        if (/\b(20|23|24|27|30|33|34)[-]?\d{8}[-]?\d\b/.test(concepto)) {
            return 'Transferencia';
        }

        // Depósitos en efectivo, autoservicio o cheques
        if (c.includes('deposito') || c.includes('depósito') || c.includes('acreditacion') || 
            c.includes('acreditación') || c.includes('efectivo') || c.includes('autoservicio') ||
            c.includes('echeq') || c.includes('cheque')) {
            return 'Depósito';
        }

        // Devoluciones impositivas
        if (c.includes('anulacion percepcion') || c.includes('retencion') || c.includes('retención') || c.includes('iva')) {
            return 'Impuestos';
        }

        // NUNCA un crédito puede ser un 'Gasto Comisión'
        return 'Otros';
    }

    // 2. REGLAS PARA DÉBITOS (Egresos / Gastos / Comisiones / Impuestos)
    if (deb > 0) {
        // Compras con tarjeta de débito (no son depósitos aunque digan 'caja')
        if (c.includes('compra debito') || c.includes('compra')) {
            return 'Otros';
        }

        // Impuestos y retenciones bancarias
        if (c.includes('impuesto') || c.includes('retencion') || c.includes('retención') || 
            c.includes('ing. brutos') || c.includes('ing.brutos') || c.includes('i.b.') || 
            c.includes('iva') || c.includes('percepcion') || c.includes('percepción') || c.includes('sircreb')) {
            return 'Impuestos';
        }

        // Comisiones y gastos bancarios reales
        if (c.includes('comision') || c.includes('comisión') || c.includes('cargo') || 
            c.includes('mantenimiento') || c.includes('gasto') || 
            (c.includes('servicio') && !c.includes('pago a proveedores'))) {
            return 'Gasto Comisión';
        }

        // Transferencias salientes
        if (c.includes('transferencia') || c.includes('coelsa') || c.includes('trf') || c.includes('transf') || c.includes('alias')) {
            return 'Transferencia';
        }

        return 'Otros';
    }

    // Fallback neutral si ambos son 0
    if (c.includes('transferencia') || c.includes('coelsa')) return 'Transferencia';
    if (c.includes('deposito') || c.includes('depósito')) return 'Depósito';
    if (c.includes('impuesto') || c.includes('iva')) return 'Impuestos';
    if (c.includes('comision') || c.includes('comisión')) return 'Gasto Comisión';

    return 'Otros';
}

function calcularHashDedup(cuentaId, fechaStr, concepto, debito, credito, referencia, saldoResultante) {
    // Normalizar el concepto dividiendo por líneas, limpiando espacios, ordenando alfabéticamente y uniendo con | en minúsculas
    const normalizedConcept = String(concepto || '')
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .sort()
        .join('|')
        .toLowerCase();

    const rawString = `${cuentaId}_${fechaStr}_${normalizedConcept}_${Number(debito).toFixed(2)}_${Number(credito).toFixed(2)}_${referencia || ''}_${Number(saldoResultante).toFixed(2)}`;
    return crypto.createHash('sha256').update(rawString).digest('hex');
}

/**
 * Procesa un archivo Excel de extracto Galicia
 * @param {number} cuentaId - ID de la cuenta bancaria en la base de datos
 * @param {Buffer} fileBuffer - Buffer binario del archivo
 * @returns {Promise<Object>} Estadísticas del procesamiento
 */
async function procesarExtractoGalicia(cuentaId, fileBuffer) {
    console.log(`📥 [BANCARIO-SERVICE] Iniciando procesamiento de extracto para cuenta ID ${cuentaId}...`);
    
    // 1. Leer el archivo con xlsx
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convertir la hoja a una matriz bidimensional (filas de celdas)
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    
    if (rows.length === 0) {
        throw new Error('El archivo Excel está vacío.');
    }
    
    // 2. Buscar fila de cabeceras de forma predictiva
    let headerRowIndex = -1;
    let colFechaIndex = -1;
    let colConceptoIndex = -1;
    let colMontoIndex = -1;
    let colDebitoIndex = -1;
    let colCreditoIndex = -1;
    let colReferenciaIndex = -1;
    let colSaldoIndex = -1;
    
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const row = rows[i];
        if (!row || !Array.isArray(row)) continue;
        
        let foundFecha = false;
        let foundConcepto = false;
        let foundMonto = false;
        let foundDebito = false;
        let foundCredito = false;
        
        for (let j = 0; j < row.length; j++) {
            const cellVal = String(row[j] || '').toLowerCase().trim();
            
            if (cellVal.includes('fecha') || cellVal.startsWith('fec')) {
                colFechaIndex = j;
                foundFecha = true;
            } else if (cellVal.includes('concepto') || cellVal.includes('descrip') || cellVal.includes('detalle') || cellVal.includes('movimiento')) {
                colConceptoIndex = j;
                foundConcepto = true;
            } else if (cellVal === 'débito' || cellVal === 'debito' || cellVal === 'egreso' || cellVal === 'salida') {
                colDebitoIndex = j;
                foundDebito = true;
            } else if (cellVal === 'crédito' || cellVal === 'credito' || cellVal === 'ingreso' || cellVal === 'entrada') {
                colCreditoIndex = j;
                foundCredito = true;
            } else if (cellVal.includes('monto') || cellVal.includes('importe') || cellVal.includes('valor')) {
                colMontoIndex = j;
                foundMonto = true;
            } else if (cellVal.includes('referencia') || cellVal.includes('comprobante') || cellVal.startsWith('ref') || cellVal.includes('comentarios')) {
                colReferenciaIndex = j;
            } else if (cellVal.includes('saldo') || cellVal.includes('acumulado') || cellVal.includes('balance') || cellVal.includes('parcial')) {
                colSaldoIndex = j;
            }
        }
        
        // Si encontramos las columnas principales, esta es la cabecera
        if (foundFecha && foundConcepto && (foundMonto || (foundDebito && foundCredito))) {
            headerRowIndex = i;
            console.log(`✅ [BANCARIO-SERVICE] Cabecera detectada en fila ${headerRowIndex + 1}:`);
            console.log(`   - Fecha: Columna ${colFechaIndex}`);
            console.log(`   - Concepto/Movimiento: Columna ${colConceptoIndex}`);
            if (foundMonto) {
                console.log(`   - Monto: Columna ${colMontoIndex}`);
            } else {
                console.log(`   - Débito: Columna ${colDebitoIndex}`);
                console.log(`   - Crédito: Columna ${colCreditoIndex}`);
            }
            console.log(`   - Referencia (opcional): Columna ${colReferenciaIndex !== -1 ? colReferenciaIndex : 'No encontrada'}`);
            console.log(`   - Saldo (opcional): Columna ${colSaldoIndex !== -1 ? colSaldoIndex : 'No encontrada'}`);
            break;
        }
    }
    
    if (headerRowIndex === -1) {
        throw new Error('No se pudo identificar la fila de cabeceras en el archivo Excel. Asegúrese de que contenga columnas de Fecha, Concepto/Movimiento y Monto (o Débito y Crédito).');
    }
    
    // 3. Parsear filas de datos
    const movimientosAInsertar = [];
    
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        
        const rawFecha = row[colFechaIndex];
        const rawConcepto = row[colConceptoIndex];
        const rawReferencia = colReferenciaIndex !== -1 ? row[colReferenciaIndex] : null;
        const rawSaldo = colSaldoIndex !== -1 ? row[colSaldoIndex] : null;
        
        // Validar que la fecha sea válida para procesar la fila
        const fecha = parseFecha(rawFecha);
        if (!fecha) {
            // Si no tiene fecha válida, probablemente sea el pie de página o fila vacía
            continue;
        }
        
        const concepto = String(rawConcepto || '').trim();
        if (!concepto) continue;
        
        // Mapear flujos de fondos
        let debito = 0;
        let credito = 0;
        
        if (colMontoIndex !== -1) {
            const rawMonto = row[colMontoIndex];
            const monto = parseMonto(rawMonto);
            if (monto > 0) {
                credito = monto;
            } else {
                debito = Math.abs(monto); // Guardar valor absoluto
            }
        } else if (colDebitoIndex !== -1 && colCreditoIndex !== -1) {
            const rawDebito = row[colDebitoIndex];
            const rawCredito = row[colCreditoIndex];
            debito = Math.abs(parseMonto(rawDebito));
            credito = Math.abs(parseMonto(rawCredito));
        }
        
        // Referencia
        const referencia = rawReferencia ? String(rawReferencia).trim() : null;
        
        // Saldo
        const saldoResultante = rawSaldo !== null ? parseMonto(rawSaldo) : 0;
        
        const tipoOperacion = clasificarConcepto(concepto, debito, credito);
        
        // Generar hash único
        const fechaStr = fecha.toISOString().split('T')[0]; // YYYY-MM-DD
        const hash = calcularHashDedup(cuentaId, fechaStr, concepto, debito, credito, referencia, saldoResultante);
        
        movimientosAInsertar.push({
            cuenta_id: cuentaId,
            fecha_movimiento: fecha,
            concepto,
            tipo_operacion: tipoOperacion,
            debito,
            credito,
            referencia,
            saldo_resultante: saldoResultante,
            hash_dedup: hash
        });
    }
    
    console.log(`📊 [BANCARIO-SERVICE] Se extrajeron ${movimientosAInsertar.length} movimientos potenciales del archivo.`);
    
    if (movimientosAInsertar.length === 0) {
        return { total: 0, insertados: 0, duplicados: 0, clasificadosRegla: 0, clasificadosIA: 0, estadoIA: 'INACTIVO' };
    }
    
    // 3b. PRE-FILTRO DE DUPLICADOS ANTES DE LLAMAR A LA IA (Evita re-analizar cientos de filas históricas)
    const hashesArchivo = [...new Set(movimientosAInsertar.map(m => m.hash_dedup))];
    const resExistentes = await pool.query(
        'SELECT hash_dedup FROM public.fin_movimientos_bancarios WHERE cuenta_id = $1 AND hash_dedup = ANY($2::text[])',
        [cuentaId, hashesArchivo]
    );
    const hashesEnBD = new Set(resExistentes.rows.map(r => r.hash_dedup));
    const hashesVistosEnLote = new Set();
    const movimientosNuevos = [];
    let duplicadosPreFiltrados = 0;

    for (const mov of movimientosAInsertar) {
        if (hashesEnBD.has(mov.hash_dedup) || hashesVistosEnLote.has(mov.hash_dedup)) {
            duplicadosPreFiltrados++;
        } else {
            hashesVistosEnLote.add(mov.hash_dedup);
            movimientosNuevos.push(mov);
        }
    }

    console.log(`⚡ [BANCARIO-SERVICE] Pre-filtro instantáneo: ${movimientosNuevos.length} movimientos NUEVOS, ${duplicadosPreFiltrados} duplicados omitidos antes de IA.`);

    const apiKeyValida = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('YOUR_GEMINI_API_KEY');

    // Si todos los movimientos del archivo ya estaban en la BD, actualizamos saldo y retornamos en milisegundos
    if (movimientosNuevos.length === 0) {
        const resUltimoDup = await pool.query(
            'SELECT saldo_resultante FROM public.fin_movimientos_bancarios WHERE cuenta_id = $1 ORDER BY fecha_movimiento DESC, id DESC LIMIT 1',
            [cuentaId]
        );
        if (resUltimoDup.rowCount > 0) {
            await pool.query(
                'UPDATE public.fin_cuentas_bancarias SET saldo = $1, actualizado_en = NOW() WHERE id = $2',
                [parseFloat(resUltimoDup.rows[0].saldo_resultante), cuentaId]
            );
        }
        return {
            total: movimientosAInsertar.length,
            insertados: 0,
            duplicados: duplicadosPreFiltrados,
            clasificadosRegla: 0,
            clasificadosIA: 0,
            estadoIA: apiKeyValida ? 'ONLINE' : 'FALLBACK_SIN_CLAVE'
        };
    }

    // 3c. Extracción determinista instantánea (CUIT, CBU, Titular y Reglas Bancarias) sobre los movimientos nuevos
    const movimientosAmbiguosParaIA = [];
    const indicesAmbiguos = [];

    movimientosNuevos.forEach((mov, idx) => {
        const datosRegla = extraerDatosBancariosDeConcepto(mov.concepto);
        mov.cuit_extraido = datosRegla.cuit || null;
        mov.referencia_operacion = mov.referencia || null;
        mov.estado_clasificacion = 'AUTO';
        mov.metadata_adicional = (datosRegla.titular || datosRegla.cbu) ? {
            nombre_entidad_ia: datosRegla.titular || null,
            cbu_detectado: datosRegla.cbu || null
        } : null;

        const cLower = String(mov.concepto || '').toLowerCase();
        const esCompraDebito = cLower.includes('compra debito') || cLower.includes('compra débito');
        const esDeterminista =
            mov.tipo_operacion === 'Impuestos' ||
            mov.tipo_operacion === 'Gasto Comisión' ||
            mov.tipo_operacion === 'Depósito' ||
            esCompraDebito ||
            (mov.tipo_operacion === 'Transferencia' && Boolean(mov.cuit_extraido));

        if (!esDeterminista) {
            movimientosAmbiguosParaIA.push(mov);
            indicesAmbiguos.push(idx);
        }
    });

    // 3d. Clasificación IA (Gemini) SOLO para los movimientos nuevos genuinamente ambiguos
    let countClasificadosIA = 0;
    let iaFallo = false;

    if (apiKeyValida && movimientosAmbiguosParaIA.length > 0) {
        try {
            console.log(`🤖 [BANCARIO-SERVICE] Consultando Gemini solo para ${movimientosAmbiguosParaIA.length} movimiento(s) ambiguo(s) de ${movimientosNuevos.length} nuevos...`);
            const resultadosIA = await geminiService.clasificarMovimientosBancarios(movimientosAmbiguosParaIA);
            resultadosIA.forEach((ia, subIdx) => {
                if (!ia) return;
                const mov = movimientosNuevos[indicesAmbiguos[subIdx]];
                if (!mov) return;

                if (ia.cuit_extraido && !mov.cuit_extraido) {
                    mov.cuit_extraido = ia.cuit_extraido;
                }
                if (ia.referencia_operacion && !mov.referencia_operacion) {
                    mov.referencia_operacion = ia.referencia_operacion;
                }
                if (ia.estado_clasificacion) {
                    mov.estado_clasificacion = ia.estado_clasificacion;
                }
                if (ia.metadata_adicional) {
                    mov.metadata_adicional = { ...(mov.metadata_adicional || {}), ...ia.metadata_adicional };
                }

                const cLower = String(mov.concepto || '').toLowerCase();
                const esCompraDebito = cLower.includes('compra debito') || cLower.includes('compra débito');

                if (ia.tipo_operacion && !esCompraDebito) {
                    countClasificadosIA++;
                    if (mov.credito > 0 && ia.tipo_operacion === 'Gasto Comisión') {
                        mov.tipo_operacion = 'Transferencia';
                    } else if (ia.tipo_operacion === 'Pago Cliente') {
                        mov.tipo_operacion = 'Transferencia';
                        if (!mov.metadata_adicional) mov.metadata_adicional = {};
                        mov.metadata_adicional.subtipo = 'Pago Cliente';
                    } else if (ia.tipo_operacion === 'Pago Proveedor') {
                        mov.tipo_operacion = 'Transferencia';
                        if (!mov.metadata_adicional) mov.metadata_adicional = {};
                        mov.metadata_adicional.subtipo = 'Pago Proveedor';
                    } else {
                        mov.tipo_operacion = ia.tipo_operacion;
                    }
                }
            });
        } catch (err) {
            iaFallo = true;
            console.error('❌ [BANCARIO-SERVICE] Error en clasificación Gemini (Fallback activado):', err.message);
        }
    } else if (!apiKeyValida) {
        console.log('ℹ️ [BANCARIO-SERVICE] GEMINI_API_KEY no detectada. Usando reglas deterministas blindadas (AUTO).');
    } else {
        console.log(`⚡ [BANCARIO-SERVICE] Los ${movimientosNuevos.length} movimientos nuevos fueron resueltos al 100% por motor determinista (CUIT/Reglas) en 0ms.`);
    }

    // Invertimos el array para que los movimientos más antiguos se inserten primero.
    // Esto garantiza que tengan IDs menores y que la ordenación DESC devuelva el saldo de la transacción más reciente.
    movimientosNuevos.reverse();
    
    // 4. Inserción transaccional en la BD (solo movimientos nuevos)
    const client = await pool.connect();
    let insertados = 0;
    let duplicados = duplicadosPreFiltrados;
    
    try {
        await client.query('BEGIN');
        
        for (const mov of movimientosNuevos) {
            const query = `
                INSERT INTO public.fin_movimientos_bancarios (
                    cuenta_id, fecha_movimiento, concepto, tipo_operacion, 
                    debito, credito, referencia, saldo_resultante, hash_dedup,
                    cuit_extraido, referencia_operacion, cliente_id, estado_clasificacion, metadata_adicional
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (hash_dedup) DO NOTHING
            `;
            
            const res = await client.query(query, [
                mov.cuenta_id,
                mov.fecha_movimiento,
                mov.concepto,
                mov.tipo_operacion,
                mov.debito,
                mov.credito,
                mov.referencia,
                mov.saldo_resultante,
                mov.hash_dedup,
                mov.cuit_extraido,
                mov.referencia_operacion,
                null, // cliente_id se inicia en NULL para validación humana (Human-in-the-Loop)
                mov.estado_clasificacion,
                mov.metadata_adicional ? JSON.stringify(mov.metadata_adicional) : null
            ]);
            
            if (res.rowCount > 0) {
                insertados++;
            } else {
                duplicados++;
            }
        }
        
        // 5. Actualizar el saldo actual de la cuenta bancaria.
        // Obtenemos el saldo resultante del movimiento cronológicamente más reciente (ordenado por fecha desc, id desc).
        const queryUltimoMovimiento = `
            SELECT saldo_resultante 
            FROM public.fin_movimientos_bancarios 
            WHERE cuenta_id = $1 
            ORDER BY fecha_movimiento DESC, id DESC 
            LIMIT 1
        `;
        const resUltimo = await client.query(queryUltimoMovimiento, [cuentaId]);
        
        if (resUltimo.rowCount > 0) {
            const nuevoSaldo = parseFloat(resUltimo.rows[0].saldo_resultante);
            console.log(`💰 [BANCARIO-SERVICE] Actualizando saldo de la cuenta ${cuentaId} a $${nuevoSaldo}...`);
            await client.query(
                'UPDATE public.fin_cuentas_bancarias SET saldo = $1, actualizado_en = NOW() WHERE id = $2',
                [nuevoSaldo, cuentaId]
            );
        }
        
        await client.query('COMMIT');
        console.log(`✅ [BANCARIO-SERVICE] Ingesta completada. Insertados: ${insertados}, Duplicados omitidos: ${duplicados}`);
        
        return {
            total: movimientosAInsertar.length,
            insertados,
            duplicados,
            clasificadosRegla: insertados - countClasificadosIA,
            clasificadosIA: countClasificadosIA,
            estadoIA: !apiKeyValida ? 'FALLBACK_SIN_CLAVE' : (iaFallo ? 'FALLBACK_ERROR' : 'ONLINE')
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [BANCARIO-SERVICE] Error en transacción de ingesta:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Extrae CUIT, CBU/CVU (22 dígitos) y Titular del concepto de un movimiento bancario
 */
function extraerDatosBancariosDeConcepto(concepto, cuitExistente = null) {
    if (!concepto) return { cuit: cuitExistente, cbu: null, titular: null };
    
    const lineas = String(concepto).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    
    // 1. CUIT
    let cuit = cuitExistente ? String(cuitExistente).replace(/\D/g, '') : null;
    if (!cuit) {
        const matchCuit = String(concepto).match(/\b(20|23|24|27|30|33|34)[-]?(\d{8})[-]?(\d)\b/);
        if (matchCuit) {
            cuit = `${matchCuit[1]}${matchCuit[2]}${matchCuit[3]}`;
        }
    }
    
    // 2. CBU / CVU (22 dígitos numéricos)
    let cbu = null;
    const matchCbu = String(concepto).match(/\b\d{22}\b/);
    if (matchCbu) {
        cbu = matchCbu[0];
    }
    
    // 3. Titular (suele ser la 2da línea si no es genérica ni numérica)
    let titular = null;
    if (lineas.length > 1) {
        const candidatos = lineas.slice(1, 3);
        for (const cand of candidatos) {
            const soloDigitos = cand.replace(/\D/g, '');
            const esNumerico = soloDigitos.length > 8 && soloDigitos.length === cand.replace(/[\s-]/g, '').length;
            const esPalabraClave = /^(transferencia|credito|debito|factura|varios|afip|link|pago|servicio|no\b)/i.test(cand);
            if (!esNumerico && !esPalabraClave && cand.length >= 3) {
                titular = cand;
                break;
            }
        }
    }
    
    return { cuit, cbu, titular };
}

module.exports = {
    procesarExtractoGalicia,
    parseMonto,
    parseFecha,
    clasificarConcepto,
    calcularHashDedup,
    extraerDatosBancariosDeConcepto
};
