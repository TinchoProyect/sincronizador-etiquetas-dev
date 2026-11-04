const fs = require('fs');

const filePath = 'c:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/logistica/js/listado-bunker.js';
console.log('Modifying file:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

// Edit 1 & 2: Set gp_receta_parent_codigo when loading enlazado and toggle ON
const targetLoadStr = `                    if (data.receta_enlazado_externo === true) {
                        if (switchEl) switchEl.checked = true;
                        window.gp_receta_hibrida_activa = true;
                        window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];`;

const replacementLoadStr = `                    if (data.receta_enlazado_externo === true) {
                        if (switchEl) switchEl.checked = true;
                        window.gp_receta_hibrida_activa = true;
                        window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];
                        window.gp_receta_parent_codigo = dataRel.articulo_produccion_codigo || 'BFXP';`;

if (content.includes(targetLoadStr)) {
    content = content.replace(targetLoadStr, replacementLoadStr);
    console.log('Edit 1: Successfully added gp_receta_parent_codigo on load.');
} else {
    console.warn('Edit 1 warning: target load string not found.');
}

const targetToggleStr = `            window.gp_receta_hibrida_activa = true;
            window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];`;

const replacementToggleStr = `            window.gp_receta_hibrida_activa = true;
            window.gp_receta_hibrida_ingredientes = dataRel.ingredientes || [];
            window.gp_receta_parent_codigo = dataRel.articulo_produccion_codigo || 'BFXP';`;

if (content.includes(targetToggleStr)) {
    content = content.replace(targetToggleStr, replacementToggleStr);
    console.log('Edit 2: Successfully added gp_receta_parent_codigo on toggle.');
} else {
    console.warn('Edit 2 warning: target toggle string not found.');
}


// Edit 3: Replace manual rendering loop with refrescarUIEstructuraReceta
// Find the start of rendering block
const renderBlockStart = `            // Renderizar la Receta Activa de Origen
            const recetaInfoBadge = document.getElementById('gp-receta-info-badge');`;

// Let's search for this block and find where it ends.
// In the file, the manual rendering ends with:
/*
                    recetaIngredientes.style.display = 'block'; // Quitar grid
                    recetaIngredientes.innerHTML = `
                        <div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 6px; color: #b45309; font-weight: 500; font-size: 0.9em;">
                            ⚠️ Este artículo no posee una receta de producción activa.
                        </div>
                    `;
                }
            }
*/

const targetRenderSnippet = `            // Renderizar la Receta Activa de Origen
            const recetaInfoBadge = document.getElementById('gp-receta-info-badge');
            const recetaIngredientes = document.getElementById('gp-receta-ingredientes');
            if (recetaInfoBadge && recetaIngredientes) {
                if (data.receta_id) {
                    recetaInfoBadge.innerText = \`RECETA ID: \${data.receta_id}\`;
                    recetaInfoBadge.style.background = '#dbeafe';
                    recetaInfoBadge.style.color = '#1e40af';
                    
                    let html = '';
                    if (data.receta_ingredientes && data.receta_ingredientes.length > 0) {
                        const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
                        let rowsHtml = '';
                        let recetaTotalCost = 0;
                        
                        data.receta_ingredientes.forEach(ing => {
                            const costoUnitario = parseFloat(ing.costo_patron || 0);
                            const cantidad = parseFloat(ing.cantidad || 0);
                            const subtotal = cantidad * costoUnitario;
                            recetaTotalCost += subtotal;
                            
                            rowsHtml += \`
                                <tr style="border-bottom: 1px solid #cbd5e1;">
                                    <td style="padding: 10px 12px; text-align: left; font-weight: 600; color: #1e293b;">
                                        \${ing.nombre_ingrediente}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: center; font-family: monospace; font-weight: bold; color: #475569; background: #f8fafc;">
                                        \${cantidad.toLocaleString('es-AR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} \${ing.unidad_medida}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: right; font-family: monospace; color: #475569;">
                                        \${costoUnitario > 0 ? currencyFormatter.format(costoUnitario) + '/' + (ing.unidad_medida === 'u' ? 'u' : 'kg') : 'N/A'}
                                    </td>
                                    <td style="padding: 10px 12px; text-align: right; font-family: monospace; font-weight: bold; color: #1e3a8a; background: #f8fafc;">
                                        \${subtotal > 0 ? currencyFormatter.format(subtotal) : 'N/A'}
                                    </td>
                                </tr>
                            \`;
                        });

                        recetaIngredientes.style.display = 'block'; // Quitar grid layout para compatibilidad de tabla
                        html = \`
                            <table class="tabla-financiera" style="width: 100%; border-collapse: collapse; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                                <thead>
                                    <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                                        <th style="text-align: left; padding: 10px 12px; color: #475569; font-weight: 700; font-size: 0.88em;">Componente de Receta</th>
                                        <th style="text-align: center; padding: 10px 12px; width: 130px; color: #475569; font-weight: 700; font-size: 0.88em;">Cantidad</th>
                                        <th style="text-align: right; padding: 10px 12px; width: 165px; color: #475569; font-weight: 700; font-size: 0.88em;">Costo Unitario (Patrón)</th>
                                        <th style="text-align: right; padding: 10px 12px; width: 170px; color: #475569; font-weight: 700; font-size: 0.88em;">Subtotal de Línea</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    \${rowsHtml}
                                </tbody>
                                <tfoot>
                                    <tr style="background-color: #e2e8f0; font-weight: 800; border-top: 2px solid #94a3b8; font-size: 1.02em;">
                                        <td colspan="3" style="text-align: left; padding: 12px; color: #1e293b;">
                                            💰 Costo Total de Producción (Origen)
                                        </td>
                                        <td id="gp-receta-total-cost-origen" onclick="window.aplicarCostoBaseManual(\${recetaTotalCost / gp_factorPresentacion})" class="clickable-cost-val receta" style="text-align: right; padding: 12px; color: #1e3a8a; font-family: monospace; font-size: 1.15em; cursor: pointer;" title="Haga clic para inyectar este costo equivalente (\$\${(recetaTotalCost / gp_factorPresentacion).toFixed(2)}/kg) en la calculadora">
                                            \${currencyFormatter.format(recetaTotalCost)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        \`;
                    }
                    recetaIngredientes.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-style: italic; padding: 10px;">La receta no posee ingredientes configurados.</div>';
                } else {
                    recetaInfoBadge.innerText = 'Sin Receta';
                    recetaInfoBadge.style.background = '#fef3c7';
                    recetaInfoBadge.style.color = '#d97706';
                    recetaIngredientes.style.display = 'block'; // Quitar grid
                    recetaIngredientes.innerHTML = \`
                        <div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 6px; color: #b45309; font-weight: 500; font-size: 0.9em;">
                            ⚠️ Este artículo no posee una receta de producción activa.
                        </div>
                    \`;
                }
            }`;

const replacementRenderSnippet = `            // Renderizar la Receta Activa de Origen
            window.refrescarUIEstructuraReceta();`;

if (content.includes(targetRenderSnippet)) {
    content = content.replace(targetRenderSnippet, replacementRenderSnippet);
    console.log('Edit 3: Successfully replaced manual rendering loop.');
} else {
    // Let's do a fallback: find the index of renderBlockStart and block end
    const startIdx = content.indexOf(renderBlockStart);
    if (startIdx !== -1) {
        // Find the index of the next `window.gp_receta_id_existente`
        const endAnchor = `            window.gp_receta_id_existente = data.receta_id || null;`;
        const endIdx = content.indexOf(endAnchor);
        if (endIdx !== -1 && endIdx > startIdx) {
            content = content.substring(0, startIdx) + replacementRenderSnippet + '\n\n' + content.substring(endIdx);
            console.log('Edit 3: Successfully replaced manual rendering loop using indices.');
        } else {
            console.warn('Edit 3 warning: end anchor not found.');
        }
    } else {
        console.warn('Edit 3 warning: start snippet not found.');
    }
}


// Edit 4: Insert onClickBotonReceta and verRelacionExternaInfo before refrescarUIEstructuraReceta
const targetRefrescarStart = `window.refrescarUIEstructuraReceta = function() {`;

const newFunctionsStr = `window.onClickBotonReceta = function() {
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

`;

if (content.includes(targetRefrescarStart)) {
    content = content.replace(targetRefrescarStart, newFunctionsStr + targetRefrescarStart);
    console.log('Edit 4: Successfully added new click handler functions.');
} else {
    console.warn('Edit 4 warning: targetRefrescarStart not found.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished all modifications.');
