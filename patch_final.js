const fs = require('fs');
const path = 'src/presupuestos/controllers/presupuestosLomasoft.js';
let content = fs.readFileSync(path, 'utf8');

const replacement = \`const buscarCandidatasLomasoft = async (req, res) => {
    const { id } = req.params;

    try {
        console.log(\\\`🔍 [LOMASOFT] Buscando candidatas para el presupuesto ID: \${id}\\\`);
        const sql = \\\`
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
        \\\`;

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
                articulos_buscados: localData.codigos_articulos || []
            },
            respuestas_crudas: [],
            logica_match: []
        };

        if (esDevolucion) {
            console.log(\\\`🚀 [LOMASOFT] Presupuesto es Devolución (NC / Retiro). Buscando Notas de Crédito en /devoluciones\\\`);
            
            const payloadLomasoft = {
                cliente_id: String(localData.id_cliente),
                monto_total: parseFloat(localData.monto_total || 0),
                fecha_creacion: new Date(localData.fecha).toISOString().split('T')[0],
                articulos: localData.codigos_articulos || []
            };

            vigia.payload = payloadLomasoft;
            const urlLomasoft = \\\`\${baseUrl}/api/devoluciones/candidatas\\\`;

            try {
                console.log('\\n================ VIGÍA DEPURADOR TICKET 28: REQUEST UNIFICADO (DEVOLUCIÓN) ================');
                console.log(\\\`URL: POST \${urlLomasoft}\\\`);
                console.log(\\\`Payload: \${JSON.stringify(payloadLomasoft)}\\\`);
                console.log('=================================================================================\\n');

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const lomaRes = await fetch(urlLomasoft, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(payloadLomasoft)
                });
                clearTimeout(timeout);

                const jsonText = await lomaRes.text();

                vigia.respuestas_crudas.push({
                    endpoint_utilizado: urlLomasoft,
                    http_status: lomaRes.status,
                    body_crudo: jsonText
                });

                if (lomaRes.ok) {
                    let lomaData = [];
                    try {
                        lomaData = JSON.parse(jsonText);
                    } catch (e) {
                        console.error(\\\`[LOMASOFT] Error parseando respuesta unificada\\\`);
                    }

                    const resultadosRaw = Array.isArray(lomaData) ? lomaData : (lomaData.data || []);
                    
                    vigia.respuestas_crudas.push({
                        analisis_parseo: 'EXITOSO',
                        cantidad_resultados: resultadosRaw.length,
                        resultados_raw: resultadosRaw
                    });

                    const fechaRef = new Date(localData.fecha);
                    
                    const resultados = resultadosRaw.filter(r => {
                        const fCandidato = r.fecha || r.fecha_emision;
                        if (!fCandidato) return false;
                        const f2 = new Date(fCandidato);
                        const difDias = Math.abs(Math.round((f2 - fechaRef) / (1000 * 60 * 60 * 24)));
                        if (difDias > 30) return false;
                        return true;
                    });

                    resultados.forEach(r => {
                        let montoCandidato = Math.abs(parseFloat(r.importe_total || r.importe_neto || r.imp_neto || 0));
                        const ptoStr = String(r.punto_venta || 0).padStart(4, '0');
                        const numStr = String(r.numero_comprobante || 0).padStart(8, '0');
                        const compFormat = \\\`\${ptoStr}-\${numStr}\\\`;

                        const montoPresupuesto = Math.abs(parseFloat(localData.monto_total || 0));
                        if (montoPresupuesto > 100) {
                            const diferencia = Math.abs(montoCandidato - montoPresupuesto);
                            if (diferencia > 500) {
                                vigia.logica_match.push(\\\`[\${compFormat}] Descartado por monto: NC tiene $\${montoCandidato} vs Presupuesto esperado $\${montoPresupuesto}\\\`);
                                return;
                            }
                        }
                        
                        vigia.logica_match.push(\\\`[\${compFormat}] ¡Aprobado! (Monto: $\${montoCandidato}, Fecha: \${r.fecha || r.fecha_emision})\\\`);

                        const existe = candidatasArray.find(c => c.comprobante_formateado === compFormat);
                        if (!existe) {
                            candidatasArray.push({
                                codigo: r.codigo || 0,
                                punto_venta: r.punto_venta || 0,
                                numero_comprobante: r.numero_comprobante || 0,
                                comprobante_formateado: compFormat,
                                tipo_comprobante: r.tipo_comprobante || 'N/C',
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
                } else {
                    vigia.logica_match.push(\\\`[FALLO HTTP] Lomasoft devolvió un status \${lomaRes.status} para la URL \${urlLomasoft}\\\`);
                }
            } catch (e) {
                console.error(\\\`[LOMASOFT] Error en POST /api/devoluciones/candidatas:\\\`, e);
                vigia.logica_match.push(\\\`[CRASH HTTP] Fallo al intentar conectar con el endpoint: \${e.message}\\\`);
            }
            totalCandidatas = candidatasArray.length;
            console.log(\\\`✅ [LOMASOFT] Encontradas \${totalCandidatas} NCs filtradas.\\\`);

        } else {
            // FLUJO ORIGINAL PARA VENTAS (Buscando Facturas)
            const payloadLomasoft = {
                cliente_id: String(localData.id_cliente),
                monto_total: parseFloat(localData.monto_total || 0),
                fecha_creacion: new Date(localData.fecha).toISOString().split('T')[0],
                articulos: localData.codigos_articulos || []
            };

            vigia.payload = payloadLomasoft;
            console.log("🚀 [LOMASOFT] Payload a enviar al ERP:", JSON.stringify(payloadLomasoft, null, 2));

            const urlLomasoft = \\\`\${baseUrl}/api/facturas/candidatas\\\`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            try {
                const lomaRes = await fetch(urlLomasoft, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(payloadLomasoft)
                });
                clearTimeout(timeout);

                const jsonText = await lomaRes.text();

                vigia.respuestas_crudas.push({
                    endpoint_utilizado: urlLomasoft,
                    http_status: lomaRes.status,
                    body_crudo: jsonText
                });

                if (lomaRes.ok) {
                    let lomaData = [];
                    try {
                        lomaData = JSON.parse(jsonText);
                    } catch (e) {
                        console.error(\\\`[LOMASOFT] Error parseando JSON de respuesta\\\`);
                    }
                    
                    candidatasArray = lomaData.data || lomaData || [];
                    totalCandidatas = candidatasArray.length;
                } else {
                    vigia.logica_match.push(\\\`[FALLO HTTP] Lomasoft devolvió un status \${lomaRes.status} para la URL \${urlLomasoft}\\\`);
                }
            } catch (e) {
                console.error(\\\`[LOMASOFT] Error en POST /api/facturas/candidatas:\\\`, e);
                vigia.logica_match.push(\\\`[CRASH HTTP] Fallo al intentar conectar con el endpoint: \${e.message}\\\`);
            }
        }

        return res.json({
            success: true,
            data: candidatasArray,
            total: totalCandidatas,
            vigia
        });

    } catch (error) {
        console.error(\\\`❌ [LOMASOFT] Error CRÍTICO en buscarCandidatasLomasoft:\\\`, error);
        res.status(500).json({ success: false, message: 'Error interno en Mantenimiento Lomasoft' });
    }
};
\`

const regex = /const buscarCandidatasLomasoft = async \(req, res\) => \{[\s\S]*?\n\};\n/g;
content = content.replace(regex, replacement + '\n');
fs.writeFileSync(path, content, 'utf8');
console.log('PATCH_FINAL_APPLIED');
