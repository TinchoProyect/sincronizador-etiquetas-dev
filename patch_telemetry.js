const fs = require('fs');

const path = 'src/presupuestos/controllers/presupuestosLomasoft.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /if \(lomaRes\.ok\) \{([\s\S]*?)catch \(e\) \{/m;

const newBlock = `
                const jsonText = await lomaRes.text();
                
                // [TICKET #029] TELEMETRÍA ABSOLUTA: Guardar SIEMPRE la respuesta, sea 200, 404 o 500
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
                        console.error(\`[LOMASOFT] Error parseando respuesta unificada\`);
                    }

                    const resultadosRaw = Array.isArray(lomaData) ? lomaData : (lomaData.data || []);
                    
                    vigia.respuestas_crudas.push({
                        analisis_parseo: 'EXITOSO',
                        cantidad_resultados: resultadosRaw.length,
                        resultados_raw: resultadosRaw
                    });

                    // Mapeo (Misma logica que la original)
                    const fechaRef = new Date(localData.fecha);
                    
                    const resultados = resultadosRaw.filter(r => {
                        const compKey = \`\${String(r.punto_venta || 0).padStart(4, '0')}-\${String(r.numero_comprobante || 0).padStart(8, '0')}\`;
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
                        const compFormat = \`\${ptoStr}-\${numStr}\`;

                        // Tolerancia $500
                        const montoPresupuesto = Math.abs(parseFloat(localData.monto_total || 0));
                        if (montoPresupuesto > 100) {
                            const diferencia = Math.abs(montoCandidato - montoPresupuesto);
                            if (diferencia > 500) {
                                vigia.logica_match.push(\`[\${compFormat}] Descartado por monto: NC tiene $\${montoCandidato} vs Presupuesto esperado $\${montoPresupuesto}\`);
                                return;
                            }
                        }
                        
                        vigia.logica_match.push(\`[\${compFormat}] ¡Aprobado! (Monto: $\${montoCandidato}, Fecha: \${r.fecha || r.fecha_emision})\`);

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
                    vigia.logica_match.push(\`[FALLO HTTP] Lomasoft devolvió un status \${lomaRes.status} para la URL \${urlLomasoft}\`);
                }
            } catch (e) {`;

content = content.replace(regex, newBlock);
fs.writeFileSync(path, content, 'utf8');
console.log('PATCHED_TELEMETRY');
