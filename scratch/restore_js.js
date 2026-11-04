const fs = require('fs');

const filePath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/logistica/js/listado-bunker.js';
console.log('Modifying file:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let jsCode = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to LF for safety
const hasCrlf = jsCode.includes('\r\n');
jsCode = jsCode.replace(/\r\n/g, '\n');

// 1. Edit 3: Save recipe logic
const saveTarget = `        if (window.gp_receta_hibrida_activa) {
            const datosReceta = {
                articulo_numero: articulo_id,
                descripcion: 'Receta externa calculada dinámicamente desde relación de producción',
                ingredientes: window.gp_receta_hibrida_ingredientes.map(i => ({
                    ingrediente_id: i.ingrediente_id,
                    nombre_ingrediente: i.nombre_ingrediente,
                    unidad_medida: i.unidad_medida,
                    cantidad: parseFloat(i.cantidad)
                })),
                articulos: [],
                esProduccionExternaConArticuloPrincipal: false,
                enlazado_externo: true
            };`.replace(/\r\n/g, '\n');

const saveReplacement = `        if (window.gp_receta_hibrida_activa) {
            const data = window.gp_current_articulo_data;
            const ingredientesParaGuardar = (data && data.receta_ingredientes) ? data.receta_ingredientes : window.gp_receta_hibrida_ingredientes;

            const datosReceta = {
                articulo_numero: articulo_id,
                descripcion: 'Receta externa calculada dinámicamente desde relación de producción',
                ingredientes: ingredientesParaGuardar.map(i => ({
                    ingrediente_id: i.ingrediente_id,
                    nombre_ingrediente: i.nombre_ingrediente,
                    unidad_medida: i.unidad_medida,
                    cantidad: parseFloat(i.cantidad)
                })),
                articulos: [],
                esProduccionExternaConArticuloPrincipal: false,
                enlazado_externo: true
            };`.replace(/\r\n/g, '\n');

if (jsCode.includes(saveTarget)) {
    jsCode = jsCode.replace(saveTarget, saveReplacement);
    console.log('Restored Edit 3: Save recipe logic.');
} else {
    console.log('Edit 3 target not found.');
}

// 2. Edit 6: Fusión on load
const loadTarget = `                    if (data.receta_enlazado_externo === true) {
                        if (switchEl) switchEl.checked = true;
                        window.gp_receta_hibrida_activa = true;
                        window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];
                        
                        if (btnEditarReceta) {
                            btnEditarReceta.innerHTML = '🔗 Ver Relación Externa';
                            btnEditarReceta.style.background = '#8e4785';
                        }
                    }`.replace(/\r\n/g, '\n');

const loadReplacement = `                    if (data.receta_enlazado_externo === true) {
                        if (switchEl) switchEl.checked = true;
                        window.gp_receta_hibrida_activa = true;
                        window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];
                        window.gp_receta_parent_codigo = dataRel.articulo_produccion_codigo || 'BFXP';
                        
                        // FUSIÓN: Conservar los ingredientes internos originales y mergear con los dinámicos externos
                        const originalIngs = (data.receta_ingredientes || []).map(i => ({...i, fase_produccion: 'interna'}));
                        const dynamicIngs = (dataRel.ingredientes || []).map(i => ({
                            ingrediente_id: i.ingrediente_id,
                            nombre_ingrediente: i.nombre_ingrediente,
                            unidad_medida: i.unidad_medida,
                            cantidad: parseFloat(i.cantidad),
                            costo_patron: parseFloat(i.costo_patron) || 0,
                            fase_produccion: 'externa'
                        }));
                        const dynamicIds = new Set(dynamicIngs.map(d => d.ingrediente_id));
                        const filteredOriginals = originalIngs.filter(o => !dynamicIds.has(o.ingrediente_id));
                        
                        // Guardar los internos puros en gp_original_receta_ingredientes para la desactivación
                        window.gp_original_receta_ingredientes = filteredOriginals.map(i => ({...i}));
                        
                        data.receta_id = data.receta_id || 'HIBRIDA_Dinamica';
                        data.receta_ingredientes = [...filteredOriginals, ...dynamicIngs];
                        
                        if (btnEditarReceta) {
                            btnEditarReceta.innerHTML = '🔗 Ver Relación Externa';
                            btnEditarReceta.style.background = '#8e4785';
                        }
                    }`.replace(/\r\n/g, '\n');

if (jsCode.includes(loadTarget)) {
    jsCode = jsCode.replace(loadTarget, loadReplacement);
    console.log('Restored Edit 6: Fusión on load.');
} else {
    console.log('Edit 6 target not found.');
}

// 3. Edit 1 & 10: Append toggleEnlaceProduccionExterna and refrescarUIEstructuraReceta
const endMarker = `    } catch (err) {
        console.error('[RECETA-MODAL] Error al guardar receta:', err);
        Swal.fire('Error', err.message || 'Error al guardar la receta', 'error');
    }
};`.replace(/\r\n/g, '\n');

const newFunctionsCode = `
window.toggleEnlaceProduccionExterna = async function(checked) {
    const artId = document.getElementById('gp-articulo-id').value;
    const artNombre = document.getElementById('gp-producto').innerText;
    
    if (checked) {
        Swal.fire({ title: 'Calculando Enlace...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const res = await fetch(\`/api/produccion/recetas/hibridas/calcular-desde-relacion/\${encodeURIComponent(artId)}\`);
            if (!res.ok) throw new Error('No se pudo resolver la relación de producción externa.');
            const dataRel = await res.json();
            
            window.gp_receta_hibrida_activa = true;
            window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];
            window.gp_receta_parent_codigo = dataRel.articulo_produccion_codigo || 'BFXP';
            
            // FUSIÓN: Conservar los ingredientes internos originales y mergear con los dinámicos externos
            const data = window.gp_current_articulo_data;
            if (data) {
                data.receta_id = data.receta_id || 'HIBRIDA_Dinamica';
                
                const originalIngs = (window.gp_original_receta_ingredientes || []).map(i => ({...i, fase_produccion: 'interna'}));
                const dynamicIngs = (dataRel.ingredientes || []).map(i => ({
                    ingrediente_id: i.ingrediente_id,
                    nombre_ingrediente: i.nombre_ingrediente,
                    unidad_medida: i.unidad_medida,
                    cantidad: parseFloat(i.cantidad),
                    costo_patron: parseFloat(i.costo_patron) || 0,
                    fase_produccion: 'externa'
                }));
                const dynamicIds = new Set(dynamicIngs.map(d => d.ingrediente_id));
                const filteredOriginals = originalIngs.filter(o => !dynamicIds.has(o.ingrediente_id));
                
                data.receta_ingredientes = [...filteredOriginals, ...dynamicIngs];
            }
            
            // Actualizar botones
            const btnEditarReceta = document.getElementById('gp-btn-editar-receta');
            if (btnEditarReceta) {
                btnEditarReceta.innerHTML = '🔗 Ver Relación Externa';
                btnEditarReceta.style.background = '#8e4785';
            }
            
            // Recalcular costos y refrescar UI
            window.refrescarUIEstructuraReceta();
            
            Swal.fire({
                icon: 'success',
                title: 'Enlace Activo',
                text: \`Ingredientes calculados dinámicamente desde \${dataRel.articulo_produccion_codigo}.\`,
                timer: 2000,
                showConfirmButton: false
            });
        } catch (err) {
            console.error('[ENLACE-TOGGLE] Error:', err);
            document.getElementById('gp-switch-enlace').checked = false;
            window.gp_receta_hibrida_activa = false;
            Swal.fire('Error', err.message || 'Error al enlazar producción', 'error');
        }
    } else {
        window.gp_receta_hibrida_activa = false;
        
        // Restaurar receta original
        const data = window.gp_current_articulo_data;
        if (data) {
            data.receta_ingredientes = (window.gp_original_receta_ingredientes || []).map(i => ({...i}));
            if (!window.gp_receta_id_existente) {
                data.receta_id = null;
            }
        }
        
        // Restaurar botones
        const btnEditarReceta = document.getElementById('gp-btn-editar-receta');
        if (btnEditarReceta) {
            btnEditarReceta.innerHTML = '✏️ Editar Receta';
            btnEditarReceta.style.background = '#0284c7';
        }
        
        // Recalcular costos y refrescar UI
        window.refrescarUIEstructuraReceta();
        
        Swal.fire({
            icon: 'info',
            title: 'Enlace Desactivado',
            text: 'Se ha restaurado el flujo de receta manual.',
            timer: 2000,
            showConfirmButton: false
        });
    }
};

window.onClickBotonReceta = function() {
    if (window.gp_receta_hibrida_activa) {
        window.verRelacionExternaInfo();
    } else {
        abrirModalRecetaBunker();
    }
};

window.verRelacionExternaInfo = function() {
    const parentCodigo = window.gp_receta_parent_codigo || 'BFXP';
    const parentDesc = gp_parentDescripcion || 'Barra Flor';
    
    Swal.fire({
        title: 'Enlace de Producción Activo',
        html: \`
            <div style="text-align: left; font-size: 0.95em; line-height: 1.5; color: #334155;">
                <p>Este artículo se encuentra enlazado a la unidad productiva padre:</p>
                <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px; padding: 12px; margin: 12px 0; font-family: monospace; font-size: 0.9em; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);">
                    <strong style="color: #6b21a8;">SKU Padre:</strong> \${parentCodigo}<br>
                    <strong style="color: #6b21a8;">Descripción:</strong> \${parentDesc}
                </div>
                <p style="font-size: 0.88em; color: #64748b; margin-top: 10px;">
                    💡 Los insumos satélite (fase externa) se importan y escalan automáticamente en tiempo real basándose en la receta de fabricación del producto de planta mencionado.
                </p>
            </div>
        \`,
        icon: 'info',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#8e4785'
    });
};

window.refrescarUIEstructuraReceta = function() {
    const data = window.gp_current_articulo_data;
    if (!data) return;

    // 1. Recalcular Costo de Ingrediente en Vivo
    let rawIngredienteCost = 0;
    if (data.receta_id && data.receta_ingredientes && data.receta_ingredientes.length > 0) {
        let recipeTotalCost = 0;
        data.receta_ingredientes.forEach(ing => {
            const cKilo = parseFloat(ing.costo_patron || ing.costo_kilo_lote || 0);
            const qty = parseFloat(ing.cantidad || 0);
            recipeTotalCost += cKilo * qty;
        });
        rawIngredienteCost = recipeTotalCost / gp_factorPresentacion;
    }
    if (rawIngredienteCost === 0) {
        if (data.lote) {
            rawIngredienteCost = parseFloat(data.lote.costo_kilo_al_momento) || 0;
        } else {
            rawIngredienteCost = (parseFloat(data.costo_base_manual) || 0) / gp_factorPresentacion;
        }
    }
    gp_liveIngredienteCost = rawIngredienteCost;

    // 2. Actualizar Tarjeta 3 (Costo Compuesto)
    const recKiloEl = document.getElementById('gp-costo-receta-kilo');
    const recBultoEl = document.getElementById('gp-costo-receta-bulto');
    const recTipoEl = document.getElementById('gp-receta-tipo-val');
    const recBadgeEl = document.getElementById('gp-receta-origen-badge');
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

    if (recKiloEl && recBultoEl && recTipoEl && recBadgeEl) {
        const hasRecipe = !!data.receta_id;
        if (hasRecipe) {
            const recBultoVal = gp_liveIngredienteCost * gp_factorPresentacion;
            recKiloEl.innerText = gp_liveIngredienteCost > 0 ? currencyFormatter.format(gp_liveIngredienteCost) : 'N/A';
            recBultoEl.innerText = recBultoVal > 0 ? currencyFormatter.format(recBultoVal) : 'N/A';
            recTipoEl.innerText = window.gp_receta_hibrida_activa ? 'Enlace Externo' : 'Receta';
            recBadgeEl.innerText = window.gp_receta_hibrida_activa ? 'DINÁMICA' : \`ID: \${data.receta_id}\`;
            
            recKiloEl.style.color = '#0284c7';
            recBultoEl.style.color = '#0284c7';
            recTipoEl.style.color = '#0284c7';
        } else {
            recKiloEl.innerText = 'Sin registros';
            recBultoEl.innerText = 'Sin registros';
            recTipoEl.innerText = 'N/A';
            recBadgeEl.innerText = 'Sin registros';
            
            recKiloEl.style.color = '#64748b';
            recBultoEl.style.color = '#64748b';
            recTipoEl.style.color = '#64748b';
        }
    }

    // 3. Renderizar la Receta Activa de Origen
    const recetaInfoBadge = document.getElementById('gp-receta-info-badge');
    const recetaIngredientes = document.getElementById('gp-receta-ingredientes');
    if (recetaInfoBadge && recetaIngredientes) {
        if (data.receta_id) {
            recetaInfoBadge.innerText = window.gp_receta_hibrida_activa ? 'ENLACE ACTIVO' : \`RECETA ID: \${data.receta_id}\`;
            recetaInfoBadge.style.background = window.gp_receta_hibrida_activa ? '#faf5ff' : '#dbeafe';
            recetaInfoBadge.style.color = window.gp_receta_hibrida_activa ? '#6b21a8' : '#1e40af';
            
            let html = '';
            if (data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                let recipeTotalCost = 0;
                
                // Clasificar ingredientes en fase interna y externa
                const internas = data.receta_ingredientes.filter(ing => ing.fase_produccion !== 'externa');
                const externas = data.receta_ingredientes.filter(ing => ing.fase_produccion === 'externa');
                
                const renderRow = (ing) => {
                    const costoUnitario = parseFloat(ing.costo_patron || ing.costo_kilo_lote || 0);
                    const cantidad = parseFloat(ing.cantidad || 0);
                    const subtotal = cantidad * costoUnitario;
                    recipeTotalCost += subtotal;
                    
                    const isExt = (window.gp_receta_hibrida_activa && ing.fase_produccion === 'externa');
                    const rowStyle = isExt ? 'background-color: #faf5ff;' : '';
                    const colStyle = isExt ? 'color: #6b21a8;' : '';
                    
                    return \`
                        <tr style="border-bottom: 1px solid #cbd5e1; \${rowStyle}">
                            <td style="padding: 10px 12px; text-align: left; font-weight: 600; color: #1e293b; \${colStyle}">
                                \${isExt ? '🔌 ' : '🥣 '} \${ing.nombre_ingrediente}
                            </td>
                            <td style="padding: 10px 12px; text-align: center; font-family: monospace; font-weight: bold; color: #475569; \${isExt ? 'background: #faf5ff;' : 'background: #f8fafc;'}">
                                \${cantidad.toLocaleString('es-AR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} \${ing.unidad_medida}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; font-family: monospace; color: #475569;">
                                \${costoUnitario > 0 ? currencyFormatter.format(costoUnitario) + '/' + (ing.unidad_medida === 'u' ? 'u' : 'kg') : 'N/A'}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-weight: bold; color: #1e3a8a; \${isExt ? 'background: #faf5ff; color: #6b21a8;' : 'background: #f8fafc;'}">
                                \${subtotal > 0 ? currencyFormatter.format(subtotal) : 'N/A'}
                            </td>
                        </tr>
                    \`;
                };

                let tbodyHtml = '';
                if (window.gp_receta_hibrida_activa) {
                    // Agrupado ordenadamente con sub-cabeceras para separar las fases
                    if (internas.length > 0) {
                        tbodyHtml += \`
                            <tr style="background-color: #f8fafc; font-weight: bold; border-bottom: 1px solid #cbd5e1;">
                                <td colspan="4" style="padding: 8px 12px; font-size: 0.82em; color: #475569; letter-spacing: 0.05em; text-transform: uppercase; border-bottom: 1px solid #cbd5e1;">
                                    🏭 Fase Interna / Planta (LAMDA)
                                </td>
                            </tr>
                        \`;
                        internas.forEach(ing => { tbodyHtml += renderRow(ing); });
                    }
                    if (externas.length > 0) {
                        tbodyHtml += \`
                            <tr style="background-color: #faf5ff; font-weight: bold; border-top: 2px solid #e9d5ff; border-bottom: 1px solid #e9d5ff;">
                                <td colspan="4" style="padding: 8px 12px; font-size: 0.82em; color: #6b21a8; letter-spacing: 0.05em; text-transform: uppercase; border-bottom: 1px solid #e9d5ff;">
                                    🔌 Fase Externa / Simulación Domicilio (Insumos Satélite)
                                </td>
                            </tr>
                        \`;
                        externas.forEach(ing => { tbodyHtml += renderRow(ing); });
                    }
                } else {
                    // Vista tradicional plana cuando el switch está apagado
                    data.receta_ingredientes.forEach(ing => { tbodyHtml += renderRow(ing); });
                }
                
                const costoRealKilo = recipeTotalCost / gp_factorPresentacion;
                
                recetaIngredientes.style.display = 'block'; // Asegurar formato de bloque para la tabla
                html = \`
                    <table class="tabla-financiera" style="width: 100%; border-collapse: collapse; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <thead>
                            <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                                <th style="text-align: left; padding: 10px 12px; color: #475569; font-weight: 700; font-size: 0.88em;">Componente</th>
                                <th style="text-align: center; padding: 10px 12px; width: 130px; color: #475569; font-weight: 700; font-size: 0.88em;">Cantidad</th>
                                <th style="text-align: right; padding: 10px 12px; width: 165px; color: #475569; font-weight: 700; font-size: 0.88em;">Costo Unitario</th>
                                <th style="text-align: right; padding: 10px 12px; width: 170px; color: #475569; font-weight: 700; font-size: 0.88em;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${tbodyHtml}
                        </tbody>
                        <tfoot>
                            <tr style="background-color: #f8fafc; font-weight: bold; border-top: 2px solid #cbd5e1; font-size: 1.0em;">
                                <td colspan="3" style="text-align: left; padding: 10px 12px; color: #475569;">
                                    💰 Costo Total del Bulto (\${gp_factorPresentacion.toFixed(2)} kg)
                                </td>
                                <td style="text-align: right; padding: 10px 12px; color: #1e293b; font-family: monospace; font-size: 1.1em;">
                                    \${currencyFormatter.format(recipeTotalCost)}
                                </td>
                            </tr>
                            <tr style="background-color: #f0fdf4; font-weight: 800; border-top: 1px solid #bbf7d0; font-size: 1.05em;">
                                <td colspan="3" style="text-align: left; padding: 10px 12px; color: #166534;">
                                    🎯 Costo Real por Kilo
                                </td>
                                <td id="gp-receta-total-cost-origen" onclick="window.aplicarCostoBaseManual(\${costoRealKilo})" class="clickable-cost-val receta" style="text-align: right; padding: 10px 12px; color: #15803d; font-family: monospace; font-size: 1.2em; cursor: pointer;" title="Haga clic para inyectar este costo equivalente (\$\${costoRealKilo.toFixed(2)}/kg) en la calculadora">
                                    \${currencyFormatter.format(costoRealKilo)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                \`;
            } else {
                html = '<div style="text-align: center; color: #64748b; font-style: italic; font-size: 0.9em; padding: 15px; border: 1px dashed #cbd5e1; border-radius: 6px; background: white;">La receta no tiene ingredientes registrados.</div>';
            }
            recetaIngredientes.innerHTML = html;
        } else {
            recetaInfoBadge.innerText = 'Sin Receta';
            recetaInfoBadge.style.background = '#cbd5e1';
            recetaInfoBadge.style.color = '#475569';
            recetaIngredientes.innerHTML = '<div style="text-align: center; color: #64748b; font-style: italic; font-size: 0.9em; padding: 15px; border: 1px dashed #cbd5e1; border-radius: 6px; background: white;">Este artículo no cuenta con una receta de producción.</div>';
        }
    }

    recalcularPreciosGestor();
};

window.recargarPreciosYDetalleGestor = window.refrescarUIEstructuraReceta;
`;

if (jsCode.includes(endMarker)) {
    jsCode = jsCode.replace(endMarker, endMarker + '\n' + newFunctionsCode);
    console.log('Restored helper functions & refrescarUI.');
} else {
    console.error('End marker not found in normalized jsCode');
    process.exit(1);
}

// 4. Edit 3: Replace manual rendering loop with refrescarUIEstructuraReceta()
const renderBlockStart = `            // Renderizar la Receta Activa de Origen
            const recetaInfoBadge = document.getElementById('gp-receta-info-badge');`.replace(/\r\n/g, '\n');

const startIdx = jsCode.indexOf(renderBlockStart);
if (startIdx !== -1) {
    const endAnchor = `            window.gp_receta_id_existente = data.receta_id || null;`.replace(/\r\n/g, '\n');
    const endIdx = jsCode.indexOf(endAnchor);
    if (endIdx !== -1 && endIdx > startIdx) {
        jsCode = jsCode.substring(0, startIdx) + `            // Renderizar la Receta Activa de Origen\n            window.refrescarUIEstructuraReceta();\n\n` + jsCode.substring(endIdx);
        console.log('Restored Edit 3: Replaced manual rendering with refrescarUIEstructuraReceta.');
    } else {
        console.error('End anchor not found for manual render block replacement.');
    }
} else {
    console.log('Manual render block already replaced.');
}

// Restore CRLF line endings if original file had them
if (hasCrlf) {
    jsCode = jsCode.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, jsCode, 'utf8');
console.log('Restored listado-bunker.js successfully.');
