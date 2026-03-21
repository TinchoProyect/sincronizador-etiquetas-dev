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
        const isAdministrativaNC = localData.estado === 'Administrativa NC';
        const baseUrl = process.env.CLOUDFLARE_URL || "https://api.lamdaser.com";

        let candidatasArray = [];
        let totalCandidatas = 0;

        if (isAdministrativaNC) {
            console.log(`🚀 [LOMASOFT] Presupuesto es 'Administrativa NC'. Buscando Notas de Crédito en /devoluciones`);
            const articulos = localData.codigos_articulos ? localData.codigos_articulos.filter(a => a && a.toString().trim() !== '') : [];
            
            // Si no hay artículos específicos (ej. es un texto genérico de devolución), forzamos una búsqueda general para el cliente
            const busquedas = articulos.length > 0 ? articulos : ['TODOS'];
            
            // Buscar facturas/NC por cada artículo devuelto (o una vez general si no hay artículos)
            for (const articulo of busquedas) {
                const urlLomasoft = new URL(`${baseUrl}/devoluciones`);
                urlLomasoft.searchParams.append('cliente', localData.id_cliente);
                if (articulo !== 'TODOS') {
                    urlLomasoft.searchParams.append('articulo', articulo);
                }

                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);

                    const lomaRes = await fetch(urlLomasoft.toString(), {
                        signal: controller.signal,
                        headers: { 'Accept': 'application/json' }
                    });
                    clearTimeout(timeout);

                    if (lomaRes.ok) {
                        const jsonText = await lomaRes.text();
                        let lomaData = [];
                        try {
                            lomaData = JSON.parse(jsonText);
                        } catch (e) {
                            console.error(`[LOMASOFT] Error parseando respuesta de /devoluciones para art ${articulo}`);
                        }

                        // Lomasoft (/devoluciones) puede devolver un array directo o un objeto con data
                        const resultadosRaw = Array.isArray(lomaData) ? lomaData : (lomaData.data || []);
                        
                        // Fecha base del presupuesto (Límite temporal)
                        const fechaRef = new Date(localData.fecha);
                        
                        // Remover resultados muy antiguos (Más de 45 días de diferencia)
                        const resultados = resultadosRaw.filter(r => {
                            const fCandidato = r.fecha || r.fecha_emision;
                            if (!fCandidato) return false;
                            
                            const f2 = new Date(fCandidato);
                            const difDias = Math.abs(Math.round((f2 - fechaRef) / (1000 * 60 * 60 * 24)));
                            return difDias <= 45;
                        });
                        
                        // Mapear al formato que espera el Frontend de Presupuestos
                        resultados.forEach(r => {
                            let montoCandidato = Math.abs(parseFloat(r.importe_total || r.importe_neto || r.imp_neto || 0));
                            const isTipoA = (r.tipo_comprobante || '').toUpperCase().includes(' A');
                            if (isTipoA && !r.importe_total) {
                                montoCandidato = montoCandidato * 1.21; // Sumar IVA 21% a Facturas/NC A si Lomasoft solo dio neto
                            }

                            // Validar coincidencia estricta de montos (Tolerancia $500) para limpiar la tabla
                            const montoPresupuesto = Math.abs(parseFloat(localData.monto_total || 0));
                            if (montoPresupuesto > 100) {
                                const diferencia = Math.abs(montoCandidato - montoPresupuesto);
                                if (diferencia > 500) {
                                    return; // Ignorar candidata
                                }
                            }

                            // Validar que no hayamos agregado ya esta NC (evitar duplicados si trae la misma para distintos artículos)
                            const ptoStr = String(r.punto_venta || 0).padStart(4, '0');
                            const numStr = String(r.numero_comprobante || 0).padStart(8, '0');
                            const compFormat = `${ptoStr}-${numStr}`;
                            
                            const existe = candidatasArray.find(c => c.comprobante_formateado === compFormat);
                            
                            if (!existe) {
                                candidatasArray.push({
                                    codigo: r.codigo || 0, // Ajustar según respuesta real
                                    punto_venta: r.punto_venta || 0,
                                    numero_comprobante: r.numero_comprobante || 0,
                                    comprobante_formateado: compFormat,
                                    tipo_comprobante: r.tipo_comprobante || 'N/C',
                                    fecha: r.fecha || r.fecha_emision, // Presupuestos espera 'fecha'
                                    importe_total: montoCandidato,
                                    articulos: [{
                                        nombre: r.articulo || r.item_descripcion,
                                        cantidad: Math.abs(parseFloat(r.cantidad || r.item_cantidad || 0))
                                    }]
                                });
                            } else {
                                // Si ya existe el comprobante, agregarle el artículo al detalle
                                const artNombre = r.articulo || r.item_descripcion;
                                if (!existe.articulos.find(a => a.nombre === artNombre)) {
                                    existe.articulos.push({
                                        nombre: artNombre,
                                        cantidad: Math.abs(parseFloat(r.cantidad || r.item_cantidad || 0))
                                    });
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.error(`[LOMASOFT] Error buscando NCs para articulo ${articulo}:`, e);
                }
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
            total: totalCandidatas
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
