const buscarCandidatasLomasoft = async (req, res) => {
    const { id } = req.params;

    try {
        console.log(`🔍 [LOMASOFT] Buscando candidatas para el presupuesto ID: ${id}`);
        // 1. Extraer el Presupuesto y sus Detalles convirtiendo los artículos al código principal (alfanumérico)
        const sql = `
            SELECT 
                p.id_cliente, 
                p.fecha, 
                p.estado,
                p.tipo_comprobante,
                SUM(pd.cantidad * COALESCE(pd.precio1, pd.valor1, 0)) * (1 - COALESCE(p.descuento, 0)) AS monto_total,
                json_agg(
                    COALESCE(a.numero, pd.articulo)
                ) FILTER (WHERE pd.articulo IS NOT NULL) as codigos_articulos,
                json_agg(
                    COALESCE(a.numero, pd.articulo) || ' - ' || COALESCE(a.nombre, 'Sin descripción')
                ) FILTER (WHERE pd.articulo IS NOT NULL) as detalles_articulos
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles pd ON pd.id_presupuesto = p.id
            LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
            WHERE p.id = $1
            GROUP BY p.id, p.id_cliente, p.fecha, p.estado, p.descuento
            LIMIT 1;
        `;

        const dbResult = await req.db.query(sql, [id]);
        if (dbResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
        }

        const localData = dbResult.rows[0];
        const esDevolucion = localData.estado === 'Administrativa NC' || localData.tipo_comprobante === 'Orden de Retiro';
        const baseUrl = process.env.CLOUDFLARE_URL || "https://api.lamdaser.com";

        let candidatasArray = [];
        let totalCandidatas = 0;

        const vigia = {
            payload: {
                cliente_id: String(localData.id_cliente),
                monto_esperado: parseFloat(localData.monto_total || 0),
                articulos_buscados: []
            },
            respuestas_crudas: [],
            logica_match: []
        };


        if (esDevolucion) {
            console.log(`🚀 [LOMASOFT] Presupuesto es Devolución (NC / Retiro). Buscando Notas de Crédito homologadas en /devoluciones`);
            const urlLomasoft = new URL(`${baseUrl}/devoluciones`);
            urlLomasoft.searchParams.append('cliente', localData.id_cliente);

            const requestParams = {
                cliente: localData.id_cliente,
                articulos_buscados: localData.codigos_articulos || []
            };
            vigia.payload = requestParams; // Adaptado para Vigía sin usar POST JSON

            let resultadosRaw = [];

            try {
                console.log('\n================ VIGÍA DEPURADOR TICKET 33: HOMOLOGACIÓN (DEVOLUCIÓN) ================');
                console.log(`URL y Endpoint exacto: GET ${urlLomasoft.toString()}`);
                console.log(`Headers: { 'Accept': 'application/json' }`);
                console.log(`Datos Locales de Contexto: ID=${id}, Cliente=${localData.id_cliente}`);
                console.log(`Monto Esperado (monto_total del Presupuesto): ${localData.monto_total}`);
                console.log('=================================================================================\n');

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const lomaRes = await fetch(urlLomasoft.toString(), {
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' }
                });
                clearTimeout(timeout);

                const jsonText = await lomaRes.text();
                vigia.respuestas_crudas.push({
                    endpoint_utilizado: urlLomasoft.toString(),
                    http_status: lomaRes.status,
                    body_crudo: jsonText
                });

                if (lomaRes.ok) {
                    let lomaData = [];
                    try {
                        lomaData = JSON.parse(jsonText);
                    } catch (e) {
                        console.error(`[LOMASOFT] ❌ Error parseando respuesta (HTTP 200). Texto: ${jsonText.substring(0,200)}`);
                    }

                    if (Array.isArray(lomaData)) {
                        resultadosRaw.push(...lomaData);
                    } else if (lomaData && Array.isArray(lomaData.data)) {
                        resultadosRaw.push(...lomaData.data);
                    }
                } else {
                    console.error(`[LOMASOFT] ❌ Error Lomasoft HTTP ${lomaRes.status}: ${jsonText.substring(0, 200)}`);
                    vigia.logica_match.push(`[FALLO HTTP] Lomasoft devolvió un status ${lomaRes.status} para la URL ${urlLomasoft.toString()}`);
                }

                const fechaRef = new Date(localData.fecha);
                    
                    const resultados = resultadosRaw.filter(r => {
                        const compKey = `${String(r.punto_venta || 0).padStart(4, '0')}-${String(r.numero_comprobante || 0).padStart(8, '0')}`;
                        const tipo = (r.tipo_comprobante || '').toUpperCase();
                        if (!tipo.includes('N/C') && !tipo.includes('CREDITO') && !tipo.includes('CRÉDITO')) {
                            return false;
                        }
                        const fCandidato = r.fecha || r.fecha_emision;
                        if (!fCandidato) return false;
                        const f2 = new Date(fCandidato);
                        const difDias = Math.abs(Math.round((f2 - fechaRef) / (1000 * 60 * 60 * 24)));
                        if (difDias > 45) return false;
                        return true;
                    });

                    resultados.forEach(r => {
                        let montoCandidato = Math.abs(parseFloat(r.importe_total || 0));
                        let neto = Math.abs(parseFloat(r.importe_neto || r.imp_neto || 0));
                        
                        // Si Lomasoft no envió importe_total, le sumamos el 21% de IVA al neto para igualar el Total del Presupuesto
                        if (montoCandidato === 0 && neto > 0) {
                            montoCandidato = neto * 1.21;
                        }

                        const ptoStr = String(r.punto_venta || 0).padStart(4, '0');
                        const numStr = String(r.numero_comprobante || 0).padStart(8, '0');
                        const compFormat = `${ptoStr}-${numStr}`;

                        const montoPresupuesto = Math.abs(parseFloat(localData.monto_total || 0));
                        let alerta_monto = false;
                        if (montoPresupuesto > 100) {
                            const diferencia = Math.abs(montoCandidato - montoPresupuesto);
                            if (diferencia > 500) {
                                vigia.logica_match.push(`[${compFormat}] Diferencia de monto detectada: NC tiene $${montoCandidato} vs Presupuesto esperado $${montoPresupuesto}`);
                                alerta_monto = true;
                            }
                        }
                        
                        vigia.logica_match.push(`[${compFormat}] ${alerta_monto ? '¡Aprobado con alerta!' : '¡Aprobado!'} (Monto: $${montoCandidato}, Fecha: ${r.fecha || r.fecha_emision})`);

                        const existe = candidatasArray.find(c => c.comprobante_formateado === compFormat);
                        if (!existe) {
                            candidatasArray.push({
                                codigo: r.codigo || 0,
                                punto_venta: r.punto_venta || 0,
                                numero_comprobante: r.numero_comprobante || 0,
                                comprobante_formateado: compFormat,
                                tipo_comprobante: r.tipo_comprobante || 'N/C',
                                alerta_monto: alerta_monto,
                                fecha: r.fecha || r.fecha_emision,
                                importe_total: montoCandidato,
                                articulos: [{
                                    nombre: r.articulo || r.item_descripcion,
                                    cantidad: Math.abs(parseFloat(r.cantidad || r.item_cantidad || 0))
                                }]
                            });
                        } else {
                            const artNombre = r.articulo || r.item_descripcion;
                            const artExiste = existe.articulos.find(a => a.nombre === artNombre);
                            if (!artExiste) {
                                existe.articulos.push({
                                    nombre: artNombre,
                                    cantidad: Math.abs(parseFloat(r.cantidad || r.item_cantidad || 0))
                                });
                            }
                        }
                    });
            } catch (e) {
                console.error(`[LOMASOFT] Error consultando Lomasoft en GET /devoluciones:`, e);
                vigia.logica_match.push(`[CRASH HTTP] Fallo al intentar conectar con el endpoint: ${e.message}`);
            }
            totalCandidatas = candidatasArray.length;
            console.log(`✅ [LOMASOFT] Encontradas ${totalCandidatas} NCs filtradas.`);


        } else {
            // FLUJO ORIGINAL PARA VENTAS (Buscando Facturas)
            // 2. Armar el contrato estricto de Lomasoft
            const payloadLomasoft = {
                cliente_id: String(localData.id_cliente),
                monto_total: parseFloat(localData.monto_total || 0),
                fecha_creacion: new Date(localData.fecha).toISOString().split('T')[0], // YYYY-MM-DD
                articulos: localData.codigos_articulos || [] // Asegurados que son alfanuméricos mediante COALESCE
            };

            console.log("🚀 [LOMASOFT] Payload a enviar al ERP:", JSON.stringify(payloadLomasoft, null, 2));

            // 3. Obtener la URL del Túnel (Cloudflare)
            // El túnel que conecta con Lomasoft (Mantenimiento usa directamente api.lamdaser.com)
            const urlLomasoft = `${baseUrl}/api/facturas/candidatas`;

            // 4. Llamada al túnel usando la arquitectura de Mantenimiento local (Fetch Nativo de Node + AbortController)
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const lomaRes = await fetch(urlLomasoft, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payloadLomasoft)
            });
            clearTimeout(timeout);

            // Parseamos la respuesta de Lomasoft
            const jsonText = await lomaRes.text();
            
            // 🔍 LLENAR VIGÍA DEPURADOR PARA FLUJO VENTAS
            vigia.payload = payloadLomasoft;
            vigia.respuestas_crudas.push({
                endpoint_utilizado: urlLomasoft,
                http_status: lomaRes.status,
                body_crudo: jsonText
            });
            vigia.logica_match.push({
                fase: "Túnel Cloudflare",
                detalle: "El endpoint remoto /api/facturas/candidatas evaluó las candidatas internamente y retornó resultados pre-filtrados."
            });

            let lomasoftData;
            try {
                lomasoftData = JSON.parse(jsonText);
            } catch (e) {
                console.error(`[LOMASOFT] ❌ Error parseando respuesta (HTTP ${lomaRes.status}).`);
                console.error(`[LOMASOFT] Texto recibido (primeros 500 chars): ${jsonText.substring(0, 500)}`);
                throw new Error(`Respuesta inválida del ERP Lomasoft al buscar candidatas (HTTP ${lomaRes.status}). Revisa la consola del servidor.`);
            }

            if (!lomaRes.ok || lomasoftData.ok === false) {
                console.error(`[LOMASOFT] ❌ Respuesta de error desde Lomasoft (HTTP ${lomaRes.status}):`, lomasoftData);
                throw new Error(lomasoftData.message || 'Error del ERP Lomasoft al buscar candidatas');
            }

            console.log(`✅ [LOMASOFT] Encontradas ${lomasoftData.total} candidatas para pres. ${id}`);
            
            candidatasArray = lomasoftData.data || [];
            totalCandidatas = lomasoftData.total || candidatasArray.length;
        }

        // Función auxiliar para normalizar formatos de comprobante (ej: B0007-00000147 -> B7-147)
        // CRÍTICO: Debe conservar las letras para evitar falsos positivos entre Factura A y Factura B
        const normalizeComprobante = (str) => {
            if (!str) return '';
            // Extraemos solo la primera letra significativa para el tipo de comprobante (A, B, C, M)
            // Lomasoft suele enviar formatos como 'B0007-00000147'
            const typeMatch = str.toUpperCase().match(/([A-Z])/);
            const letter = typeMatch ? typeMatch[1] : '';
            
            const match = str.match(/(\d+)\D+(\d+)/);
            if (match) {
                return `${letter}${parseInt(match[1], 10)}-${parseInt(match[2], 10)}`;
            }
            const singleMatch = str.match(/(\d+)/);
            if (singleMatch) return `${letter}${parseInt(singleMatch[1], 10)}`;
            return str;
        };

        // Fase 3: Interceptor de facturas ya conciliadas (Bloqueo Global)
        if (candidatasArray.length > 0) {
            const checkSql = `
                SELECT 
                    p.id, 
                    p.id_cliente,
                    p.id_presupuesto_ext, 
                    p.comprobante_lomasoft,
                    p.fecha,
                    COALESCE(c.nombre || ' ' || c.apellido, c.nombre, c.apellido, c.otros, 'Sin cliente') as cliente_nombre,
                    COALESCE((
                        SELECT SUM(d.cantidad * d.precio1) 
                        FROM public.presupuestos_detalles d 
                        WHERE d.id_presupuesto = p.id
                    ), 0) * (1 - COALESCE(p.descuento, 0)) as total_final
                FROM presupuestos p
                LEFT JOIN clientes c ON c.cliente_id = CAST(NULLIF(TRIM(p.id_cliente), '') AS integer)
                WHERE p.comprobante_lomasoft IS NOT NULL
                  AND p.activo = true
                  AND p.estado != 'Anulado'
            `;
            const checkRes = await req.db.query(checkSql);

            const vinculados = {};
            checkRes.rows.forEach(row => {
                const norm = normalizeComprobante(row.comprobante_lomasoft);
                if (norm) {
                    // Si ya existe y pertenece a otro cliente, podríamos estar ante una colisión de IDs legados,
                    // pero guardamos el array de todos los vínculos que compartan este 'norm'
                    if (!vinculados[norm]) vinculados[norm] = [];
                    vinculados[norm].push({ 
                        id: row.id, 
                        hash: row.id_presupuesto_ext,
                        id_cliente: row.id_cliente,
                        fecha: row.fecha,
                        cliente: row.cliente_nombre,
                        total: row.total_final
                    });
                }
            });

            candidatasArray.forEach(c => {
                const normCand = normalizeComprobante(c.comprobante_formateado);
                if (normCand && vinculados[normCand]) {
                    // Encontrar el vínculo que realmente corresponda a este cliente o monto (Filtro Anti Falsos Positivos)
                    const candidataTotal = Math.abs(parseFloat(c.importe_total || c.monto_total || c.total || c.importe_neto || 0));
                    
                    const vinculoReal = vinculados[normCand].find(vinc => {
                        const isSameClient = String(vinc.id_cliente).trim() === String(localData.id_cliente).trim();
                        const isSameMonto = Math.abs(parseFloat(vinc.total || 0) - candidataTotal) < 100;
                        return isSameClient || isSameMonto;
                    });

                    if (vinculoReal) {
                        c.ya_conciliada = true;
                        c.id_presupuesto_local = vinculoReal.id;
                        c.hash_presupuesto_local = vinculoReal.hash;
                        c.fecha_presupuesto_local = vinculoReal.fecha;
                        c.cliente_presupuesto_local = vinculoReal.cliente;
                        c.total_presupuesto_local = vinculoReal.total;
                    } else {
                        c.ya_conciliada = false;
                    }
                } else {
                    c.ya_conciliada = false;
                }
            });
        }

        // 5. Devolver resultados limpios al Frontend
        return res.json({
            success: true,
            data: candidatasArray,
            total: totalCandidatas,
            vigia,
            localData: localData
        });

    } catch (error) {
        // En caso de Fetch, el error puede tener varias formas
        console.error(`❌ [LOMASOFT] Error CRÍTICO en buscarCandidatasLomasoft:`);
        console.error(`- Mensaje: ${error.message}`);
        if (error.cause) console.error(`- Causa:`, error.cause);

        res.status(500).json({ success: false, message: error.message });
    }
};

const confirmarConciliacion = async (req, res) => {
    const { id } = req.params;
    let { codigo, punto_venta, comprobante_formateado } = req.body;
    const usuario = req.user ? req.user.username : 'SISTEMA';

    if (!comprobante_formateado) {
        return res.status(400).json({ success: false, message: 'Faltan datos de la candidata (comprobante_formateado es requerido)' });
    }
    
    // Normalizar fallbacks si la API externa omitió los datos de orígen
    codigo = codigo || 0;
    punto_venta = punto_venta || 0;

    try {
        console.log(`🔗 [LOMASOFT] Confirmando conciliación de Presupuesto ${id} con ${comprobante_formateado} (Usu: ${usuario})`);

        const claveExterna = `${codigo}-${punto_venta}`;
        const sql = `
            WITH updated_pres AS (
                UPDATE presupuestos 
                SET 
                    id_factura_lomasoft = $1,
                    comprobante_lomasoft = $2
                WHERE id = $3
                RETURNING id, id_factura_lomasoft, comprobante_lomasoft, estado
            ),
            updated_mant AS (
                UPDATE mantenimiento_movimientos
                SET estado = 'CONCILIADO',
                    observaciones = observaciones || ' [Conciliado vía Lomasoft: ' || $2 || ']'
                WHERE id_presupuesto_origen = $3
                  AND tipo_movimiento = 'INGRESO'
                  AND (estado IS NULL OR estado != 'CONCILIADO')
                RETURNING articulo_numero, cantidad, id_presupuesto_origen
            ),
            stock_reversion AS (
                UPDATE public.stock_real_consolidado src
                SET stock_consolidado = src.stock_consolidado - agg.total_cantidad,
                    stock_ajustes = COALESCE(src.stock_ajustes, 0) - agg.total_cantidad,
                    ultima_actualizacion = NOW()
                FROM (
                    SELECT um.articulo_numero, SUM(um.cantidad) as total_cantidad
                    FROM updated_mant um
                    JOIN updated_pres up ON up.id = um.id_presupuesto_origen
                    WHERE up.estado != 'Administrativa NC'
                    GROUP BY um.articulo_numero
                ) agg
                WHERE src.articulo_numero = agg.articulo_numero
            ),
            insert_audit AS (
                INSERT INTO public.mantenimiento_movimientos 
                (articulo_numero, cantidad, tipo_movimiento, fecha_movimiento, usuario, observaciones, estado, id_presupuesto_origen)
                SELECT um.articulo_numero, um.cantidad, 'LIBERACION', NOW(), $4, '[Ajuste Automático] Reversión por Conciliación Lomasoft', 'FINALIZADO', um.id_presupuesto_origen
                FROM updated_mant um
                JOIN updated_pres up ON up.id = um.id_presupuesto_origen
                WHERE up.estado != 'Administrativa NC'
            )
            SELECT * FROM updated_pres;
        `;

        const dbResult = await req.db.query(sql, [claveExterna, comprobante_formateado, id, usuario]);

        if (dbResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Presupuesto no encontrado para actualizar' });
        }

        console.log(`✅ [LOMASOFT] Presupuesto ${id} conciliado exitosamente con ${comprobante_formateado}`);
        return res.json({ success: true, data: dbResult.rows[0] });

    } catch (error) {
        console.error(`❌ [LOMASOFT] Error en confirmarConciliacion:`, error);
        res.status(500).json({ success: false, message: 'Error interno guardando la conciliación' });
    }
};

const desconciliarLomasoft = async (req, res) => {
    const { id } = req.params;
    const usuario = req.user ? req.user.username : 'SISTEMA';

    try {
        console.log(`🔗 [LOMASOFT] Desconciliando Presupuesto ${id} (Usu: ${usuario})`);

        // Comprobamos el estado actual para saber si es NC o no
        const chkSql = `SELECT estado FROM presupuestos WHERE id = $1 AND comprobante_lomasoft IS NOT NULL`;
        const chkRes = await req.db.query(chkSql, [id]);
        if (chkRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'El presupuesto no se encuentra conciliado o no existe.' });
        }

        const sql = `
            WITH updated_pres AS (
                UPDATE presupuestos 
                SET 
                    id_factura_lomasoft = NULL,
                    comprobante_lomasoft = NULL
                WHERE id = $1
                RETURNING id, estado
            ),
            updated_mant AS (
                UPDATE mantenimiento_movimientos
                SET estado = NULL,
                    observaciones = observaciones || ' [Desconciliado vía Lomasoft]'
                WHERE id_presupuesto_origen = $1
                  AND tipo_movimiento = 'INGRESO'
                  AND estado = 'CONCILIADO'
                RETURNING articulo_numero, cantidad, id_presupuesto_origen
            ),
            stock_reversion AS (
                UPDATE public.stock_real_consolidado src
                SET stock_consolidado = src.stock_consolidado + agg.total_cantidad,
                    stock_ajustes = COALESCE(src.stock_ajustes, 0) + agg.total_cantidad,
                    ultima_actualizacion = NOW()
                FROM (
                    SELECT um.articulo_numero, SUM(um.cantidad) as total_cantidad
                    FROM updated_mant um
                    JOIN updated_pres up ON up.id = um.id_presupuesto_origen
                    WHERE up.estado != 'Administrativa NC'
                    GROUP BY um.articulo_numero
                ) agg
                WHERE src.articulo_numero = agg.articulo_numero
            ),
            insert_audit AS (
                INSERT INTO public.mantenimiento_movimientos 
                (articulo_numero, cantidad, tipo_movimiento, fecha_movimiento, usuario, observaciones, estado, id_presupuesto_origen)
                SELECT um.articulo_numero, um.cantidad, 'AJUSTE', NOW(), $2, '[Ajuste Automático] Reingreso por Desconciliación Lomasoft', 'FINALIZADO', um.id_presupuesto_origen
                FROM updated_mant um
                JOIN updated_pres up ON up.id = um.id_presupuesto_origen
                WHERE up.estado != 'Administrativa NC'
            )
            SELECT * FROM updated_pres;
        `;

        const dbResult = await req.db.query(sql, [id, usuario]);

        if (dbResult.rowCount === 0) {
            return res.status(400).json({ success: false, message: 'No se pudo revertir la conciliación' });
        }

        console.log(`✅ [LOMASOFT] Presupuesto ${id} desconciliado exitosamente`);
        return res.json({ success: true, message: 'Presupuesto desconciliado exitosamente', data: dbResult.rows[0] });

    } catch (error) {
        console.error(`❌ [LOMASOFT] Error en desconciliarLomasoft:`, error);
        res.status(500).json({ success: false, message: 'Error interno al desconciliar Lomasoft' });
    }
};

module.exports = {
    buscarCandidatasLomasoft,
    confirmarConciliacion,
    desconciliarLomasoft
};
