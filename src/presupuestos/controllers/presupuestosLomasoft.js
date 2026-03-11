const buscarCandidatasLomasoft = async (req, res) => {
    const { id } = req.params;

    try {
        console.log(`🔍 [LOMASOFT] Buscando candidatas para el presupuesto ID: ${id}`);
        // 1. Extraer el Presupuesto y sus Detalles convirtiendo los artículos al código principal (alfanumérico)
        const sql = `
            SELECT 
                p.id_cliente, 
                p.fecha, 
                SUM(pd.cantidad * COALESCE(pd.precio1, pd.valor1, 0)) * (1 - COALESCE(p.descuento, 0)) AS monto_total,
                json_agg(
                    COALESCE(a.numero, pd.articulo)
                ) FILTER (WHERE pd.articulo IS NOT NULL) as codigos_articulos
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles pd ON pd.id_presupuesto = p.id
            LEFT JOIN articulos a ON a.codigo_barras = pd.articulo OR a.numero = pd.articulo
            WHERE p.id = $1
            GROUP BY p.id, p.id_cliente, p.fecha, p.descuento
            LIMIT 1;
        `;

        const dbResult = await req.db.query(sql, [id]);
        if (dbResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
        }

        const localData = dbResult.rows[0];

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
        const baseUrl = process.env.CLOUDFLARE_URL || "https://api.lamdaser.com";
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

        // Fase 3: Interceptor de facturas ya conciliadas (Bloqueo 1-a-1)
        const candidatasArray = lomasoftData.data || [];
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
            total: lomasoftData.total || candidatasArray.length
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
    const { codigo, punto_venta, comprobante_formateado } = req.body;

    if (!codigo || !punto_venta || !comprobante_formateado) {
        return res.status(400).json({ success: false, message: 'Faltan datos de la candidata (código, pto vta o comprobante)' });
    }

    try {
        console.log(`🔗 [LOMASOFT] Confirmando conciliación de Presupuesto ${id} con Factura ${comprobante_formateado}`);

        const claveExterna = `${codigo}-${punto_venta}`;
        const sql = `
            UPDATE presupuestos 
            SET 
                id_factura_lomasoft = $1,
                comprobante_lomasoft = $2
            WHERE id = $3
            RETURNING id, id_factura_lomasoft, comprobante_lomasoft, estado
        `;

        const dbResult = await req.db.query(sql, [claveExterna, comprobante_formateado, id]);

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
