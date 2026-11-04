const fs = require('fs');

const filePath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/logistica/js/listado-bunker.js';
console.log('Modifying file:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let jsCode = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to LF for safe manipulation
const hasCrlf = jsCode.includes('\r\n');
jsCode = jsCode.replace(/\r\n/g, '\n');

// 1. abrirGestorPrecios relation load and ON check
const initTarget = `            gp_factorPresentacion = parseFloat(data.kilos_unidad) > 0 ? parseFloat(data.kilos_unidad) : 1.00;
            
            const factorEl = document.getElementById('gp-factor-presentacion');
            if (factorEl) {
                factorEl.innerText = \`\${gp_factorPresentacion.toFixed(2)} kg\`;
            }
            
            // Calcular Costo de Ingrediente en Vivo por KILO (Costo de Producción Origen) (Comentarios en español)`.replace(/\r\n/g, '\n');

const initReplacement = `            gp_factorPresentacion = parseFloat(data.kilos_unidad) > 0 ? parseFloat(data.kilos_unidad) : 1.00;
            
            const factorEl = document.getElementById('gp-factor-presentacion');
            if (factorEl) {
                factorEl.innerText = \`\${gp_factorPresentacion.toFixed(2)} kg\`;
            }
            
            // Seteos iniciales de Enlace de Producción Externa
            window.gp_current_articulo_data = data;
            window.gp_receta_hibrida_activa = false;
            window.gp_receta_hibrida_ingredientes = [];
            window.gp_original_receta_ingredientes = (data.receta_ingredientes || []).map(i => ({...i}));
            window.gp_original_enlazado_externo = data.receta_enlazado_externo === true;
            window.gp_receta_id_existente = data.receta_id || null;
            
            const switchContainer = document.getElementById('gp-switch-enlace-container');
            const switchEl = document.getElementById('gp-switch-enlace');
            const btnEditarReceta = document.getElementById('gp-btn-editar-receta');
            
            if (switchContainer) switchContainer.style.display = 'none';
            if (switchEl) switchEl.checked = false;
            if (btnEditarReceta) {
                btnEditarReceta.innerHTML = '✏️ Editar Receta';
                btnEditarReceta.style.background = '#0284c7';
            }

            try {
                // Consultar si posee relación de mezcla mixta
                const resRel = await fetch(\`/api/produccion/recetas/hibridas/calcular-desde-relacion/\${encodeURIComponent(articulo_id)}\`);
                if (resRel.ok) {
                    const dataRel = await resRel.json();
                    
                    // Mostrar Switch
                    if (switchContainer) switchContainer.style.display = 'flex';
                    
                    // Si la receta en BD ya tiene enlazado_externo = true, activar Switch en ON automáticamente
                    if (data.receta_enlazado_externo === true) {
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
                    }
                }
            } catch (errRel) {
                console.warn('[ENLACE-EXTERNO] Error al consultar relación de mezcla:', errRel);
            }
            
            // Calcular Costo de Ingrediente en Vivo por KILO (Costo de Producción Origen) (Comentarios en español)`.replace(/\r\n/g, '\n');

if (jsCode.includes(initTarget)) {
    jsCode = jsCode.replace(initTarget, initReplacement);
    console.log('Modified opening block for Switch check & auto-ON.');
} else {
    console.error('Init target not found in listado-bunker.js!');
}

// 2. guardarEstructuraFinanciera recipe enlazado save/desacoplar payload
const saveTarget = `    Swal.fire({ title: 'Guardando Estructuras Financieras...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        const res = await fetch(\`/api/logistica/bunker/finanzas/\${encodeURIComponent(articulo_id)}\`, {`.replace(/\r\n/g, '\n');

const saveReplacement = `    Swal.fire({ title: 'Guardando Estructuras Financieras...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        // Guardar/Desactivar Receta de Enlace de Producción Externa si corresponde
        if (window.gp_receta_hibrida_activa) {
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
            };
            const urlReceta = window.gp_receta_id_existente
                ? \`/api/produccion/recetas/\${encodeURIComponent(articulo_id)}\`
                : '/api/produccion/recetas';
            const methodReceta = window.gp_receta_id_existente ? 'PUT' : 'POST';
            
            const resReceta = await fetch(urlReceta, {
                method: methodReceta,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datosReceta)
            });
            
            if (!resReceta.ok) {
                const errReceta = await resReceta.json();
                throw new Error(errReceta.error || 'Error al guardar la receta enlazada');
            }
        } else if (window.gp_original_enlazado_externo === true && !window.gp_receta_hibrida_activa) {
            // Si estaba enlazado y el usuario lo desactivó, guardar la receta tradicional con enlazado_externo = false
            const datosReceta = {
                articulo_numero: articulo_id,
                descripcion: 'Receta de Búnker para ' + document.getElementById('gp-producto').innerText,
                ingredientes: (window.gp_original_receta_ingredientes || []).map(i => ({
                    ingrediente_id: i.ingrediente_id,
                    nombre_ingrediente: i.nombre_ingrediente,
                    unidad_medida: i.unidad_medida,
                    cantidad: parseFloat(i.cantidad)
                })),
                articulos: [],
                esProduccionExternaConArticuloPrincipal: false,
                enlazado_externo: false
            };
            const urlReceta = \`/api/produccion/recetas/\${encodeURIComponent(articulo_id)}\`;
            const resReceta = await fetch(urlReceta, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datosReceta)
            });
            if (!resReceta.ok) {
                const errReceta = await resReceta.json();
                throw new Error(errReceta.error || 'Error al desactivar el enlace de receta');
            }
        }

        const res = await fetch(\`/api/logistica/bunker/finanzas/\${encodeURIComponent(articulo_id)}\`, {`.replace(/\r\n/g, '\n');

if (jsCode.includes(saveTarget)) {
    jsCode = jsCode.replace(saveTarget, saveReplacement);
    console.log('Modified saving block for external recipe link.');
} else {
    console.error('Save target not found in listado-bunker.js!');
}

// 3. abrirModalRecetaBunker controls disabling
const modalTarget = `window.abrirModalRecetaBunker = async function() {
    const artId = document.getElementById('gp-articulo-id').value;
    const artNombre = document.getElementById('gp-producto').innerText;
    
    document.getElementById('gp-receta-modal-articulo-nombre').innerText = artNombre;
    window.gp_receta_modal_state = [];
    window.gp_ingredientes_disponibles = [];
    
    // Resetear inputs de carga
    document.getElementById('gp-receta-modal-selected-id').value = '';
    document.getElementById('gp-receta-modal-selected-nombre').value = '';
    document.getElementById('gp-receta-modal-selected-unidad').value = '';
    document.getElementById('gp-receta-modal-buscar-input').value = '';
    document.getElementById('gp-receta-modal-cantidad-input').value = '';
    
    const tbody = document.getElementById('gp-receta-modal-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #64748b; font-style: italic;">Cargando ingredientes...</td></tr>';
    }
    
    document.getElementById('gp-modal-receta').style.display = 'flex';`.replace(/\r\n/g, '\n');

const modalReplacement = `window.abrirModalRecetaBunker = async function() {
    const artId = document.getElementById('gp-articulo-id').value;
    const artNombre = document.getElementById('gp-producto').innerText;
    
    document.getElementById('gp-receta-modal-articulo-nombre').innerText = artNombre;
    window.gp_receta_modal_state = [];
    window.gp_ingredientes_disponibles = [];
    
    // Resetear inputs de carga
    document.getElementById('gp-receta-modal-selected-id').value = '';
    document.getElementById('gp-receta-modal-selected-nombre').value = '';
    document.getElementById('gp-receta-modal-selected-unidad').value = '';
    document.getElementById('gp-receta-modal-buscar-input').value = '';
    document.getElementById('gp-receta-modal-cantidad-input').value = '';
    
    const isEnlazado = window.gp_receta_hibrida_activa === true;
    const bannerInfo = document.getElementById('gp-receta-modal-vinculo-info');
    const inputBuscar = document.getElementById('gp-receta-modal-buscar-input');
    const inputCantidad = document.getElementById('gp-receta-modal-cantidad-input');
    
    if (bannerInfo) {
        if (isEnlazado) {
            const parentCodigo = window.gp_receta_parent_codigo || 'BFXP';
            const parentDesc = window.gp_parentDescripcion || gp_parentDescripcion || 'Barra Flor';
            bannerInfo.innerHTML = \`<span>🔌</span> <span>Relación Externa con SKU: \${parentCodigo} (\${parentDesc})</span>\`;
            bannerInfo.style.display = 'flex';
            bannerInfo.style.background = '#faf5ff';
            bannerInfo.style.border = '1px solid #e9d5ff';
            bannerInfo.style.color = '#6b21a8';
        } else {
            bannerInfo.style.display = 'none';
        }
    }
    
    if (inputBuscar) {
        inputBuscar.disabled = isEnlazado;
        inputBuscar.placeholder = isEnlazado 
            ? 'Artículo enlazado a Producción Externa (Solo lectura)' 
            : 'Escriba para buscar ingrediente o packaging...';
    }
    if (inputCantidad) inputCantidad.disabled = isEnlazado;
    
    const btnConfirmarReceta = document.querySelector('#gp-modal-receta-content button[onclick="guardarRecetaBunker()"]');
    if (btnConfirmarReceta) {
        btnConfirmarReceta.style.display = isEnlazado ? 'none' : 'inline-block';
    }
    
    const tbody = document.getElementById('gp-receta-modal-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #64748b; font-style: italic;">Cargando ingredientes...</td></tr>';
    }
    
    document.getElementById('gp-modal-receta').style.display = 'flex';`.replace(/\r\n/g, '\n');

if (jsCode.includes(modalTarget)) {
    jsCode = jsCode.replace(modalTarget, modalReplacement);
    console.log('Modified abrirModalRecetaBunker for custom enlazado message & disable.');
} else {
    console.error('Modal target not found in listado-bunker.js!');
}

// 4. renderRecetaModalTable inputs/buttons disabling
const tableTarget = `window.renderRecetaModalTable = function() {
    const tbody = document.getElementById('gp-receta-modal-tbody');
    if (!tbody) return;
    
    if (!window.gp_receta_modal_state || window.gp_receta_modal_state.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8; font-style: italic;">Sin ingredientes en la receta</td></tr>';
        return;
    }
    
    tbody.innerHTML = window.gp_receta_modal_state.map((ing, index) => \`
        <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 8px 10px; color: #1e293b; font-weight: 500;">\${ing.nombre_ingrediente}</td>
            <td style="padding: 8px 10px; text-align: center;">
                <input type="number" step="0.0001" min="0.0001" value="\${ing.cantidad}" oninput="window.actualizarCantidadIngrediente(\${index}, this.value)" style="width: 90px; text-align: center; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;">
            </td>
            <td style="padding: 8px 10px; text-align: center; color: #64748b; font-size: 0.9em; font-weight: bold;">\${ing.unidad_medida}</td>
            <td style="padding: 8px 10px; text-align: center;">
                <button type="button" onclick="window.eliminarIngredienteModal(\${index})" style="background: transparent; border: none; color: #ef4444; font-size: 1.1em; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">🗑️</button>
            </td>
        </tr>
    \`).join('');
};`.replace(/\r\n/g, '\n');

const tableReplacement = `window.renderRecetaModalTable = function() {
    const tbody = document.getElementById('gp-receta-modal-tbody');
    if (!tbody) return;
    
    if (!window.gp_receta_modal_state || window.gp_receta_modal_state.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8; font-style: italic;">Sin ingredientes en la receta</td></tr>';
        return;
    }
    
    const isEnlazado = window.gp_receta_hibrida_activa === true;
    
    tbody.innerHTML = window.gp_receta_modal_state.map((ing, index) => \`
        <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 8px 10px; color: #1e293b; font-weight: 500;">\${ing.nombre_ingrediente}</td>
            <td style="padding: 8px 10px; text-align: center;">
                <input type="number" step="0.0001" min="0.0001" value="\${ing.cantidad}" \${isEnlazado ? 'disabled' : ''} oninput="window.actualizarCantidadIngrediente(\${index}, this.value)" style="width: 90px; text-align: center; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;">
            </td>
            <td style="padding: 8px 10px; text-align: center; color: #64748b; font-size: 0.9em; font-weight: bold;">\${ing.unidad_medida}</td>
            <td style="padding: 8px 10px; text-align: center;">
                <button type="button" \${isEnlazado ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : 'onclick="window.eliminarIngredienteModal(' + index + ')" style="background: transparent; border: none; color: #ef4444; font-size: 1.1em; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background=\\'#fef2f2\\'" onmouseout="this.style.background=\\'transparent\\'"'} >🗑️</button>
            </td>
        </tr>
    \`).join('');
};`.replace(/\r\n/g, '\n');

if (jsCode.includes(tableTarget)) {
    jsCode = jsCode.replace(tableTarget, tableReplacement);
    console.log('Modified renderRecetaModalTable to disable rows in enlazado mode.');
} else {
    console.error('Table target not found in listado-bunker.js!');
}

// Convert back to CRLF if required
if (hasCrlf) {
    jsCode = jsCode.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, jsCode, 'utf8');
console.log('Finished modifying listado-bunker.js.');
