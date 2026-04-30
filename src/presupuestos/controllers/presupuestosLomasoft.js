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
                ) FILTER (WHERE pd.articulo IS NOT NULL) as codigos_articulos
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

        // Fase 3: Interceptor de facturas ya conciliadas (Bloqueo 1-a-1)
        if (candidatasArray.length > 0) {
            const comprobantes = candidatasArray.map(c => c.comprobante_formateado).filter(Boolean);
            if (comprobantes.length > 0) {
                const checkSql = `
                    SELECT id, comprobante_lomasoft 
                    FROM presupuestos 
                    WHERE comprobante_lomasoft = ANY($1::text[]) 
                      AND comprobante_lomasoft IS NOT NULL
                      AND activo = true
                      AND estado != 'Anulado'
                `;
                const checkRes = await req.db.query(checkSql, [comprobantes]);

                const vinculados = {};
                checkRes.rows.forEach(row => {
                    vinculados[row.comprobante_lomasoft] = row.id;
                });

                candidatasArray.forEach(c => {
                    if (vinculados[c.comprobante_formateado]) {
                        c.ya_conciliada = true;
                        c.id_presupuesto_local = vinculados[c.comprobante_formateado];
                    } else {
                        c.ya_conciliada = false;
                    }
                });
            }
        }

        // 5. Devolver resultados limpios al Frontend
        return res.json({
            success: true,
            data: candidatasArray,
            total: totalCandidatas,
            vigia
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

module.exports = {
    buscarCandidatasLomasoft,
    confirmarConciliacion
};
