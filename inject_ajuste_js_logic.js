const fs = require('fs');

const jsContent = `
// ==========================================
// MÓDULO DE AJUSTE PUNTUAL DE STOCK FÍSICO
// ==========================================

window.modoAjusteActivo = false;
window.usuarioAjusteGlobal = null;
window.ingredientesAjusteSeleccionados = new Map(); // Mapa id => {nombre, stock_actual}

// FASE 1: INICIAR Y ELEGIR USUARIO
window.iniciarFlujoAjuste = async () => {
    if (window.vistaActual !== 'deposito') {
        Swal.fire('Atención', 'El ajuste puntual solo puede iniciarse desde la vista de Inventario General.', 'warning');
        return;
    }

    try {
        const response = await fetch('http://localhost:3002/api/usuarios');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        const usuarios = await response.json();
        
        const select = document.getElementById('ajuste-usuario-select');
        select.innerHTML = '<option value="">-- Seleccione el operario --</option>';
        usuarios.forEach(u => {
            if (u.activo) {
                select.innerHTML += \`<option value="\${u.id}">\${u.nombre_completo} (\${u.usuario})</option>\`;
            }
        });
        
        document.getElementById('modal-seleccion-usuario').style.display = 'flex';
    } catch (e) {
        Swal.fire('Error', 'No se pudieron cargar los responsables. ' + e.message, 'error');
    }
};

window.confirmarUsuarioYPasarAFase2 = () => {
    const select = document.getElementById('ajuste-usuario-select');
    if (!select.value) {
        Swal.fire('Inválido', 'Debe seleccionar un responsable.', 'warning');
        return;
    }
    
    window.usuarioAjusteGlobal = { id: select.value, nombre: select.options[select.selectedIndex].text };
    document.getElementById('modal-seleccion-usuario').style.display = 'none';
    
    // Activar FASE 2
    window.modoAjusteActivo = true;
    window.ingredientesAjusteSeleccionados.clear();
    
    document.body.classList.add('modo-ajuste-general');
    
    document.getElementById('ajuste-usuario-label').textContent = 'Resp: ' + window.usuarioAjusteGlobal.nombre;
    document.getElementById('contador-seleccion-ajuste').textContent = '0';
    document.getElementById('sticky-header-ajuste').style.display = 'flex';
    
    // Resetear estados visuales
    document.querySelectorAll('.tarjeta-ingrediente').forEach(t => t.classList.remove('tarjeta-seleccionada'));
    document.querySelectorAll('.checkbox-ajuste').forEach(cb => cb.checked = false);
};

// FASE 2: SELECCIÓN DE TARJETAS
window.cancelarModoAjuste = () => {
    window.modoAjusteActivo = false;
    window.usuarioAjusteGlobal = null;
    document.body.classList.remove('modo-ajuste-general');
    document.getElementById('sticky-header-ajuste').style.display = 'none';
    
    document.querySelectorAll('.tarjeta-ingrediente').forEach(t => t.classList.remove('tarjeta-seleccionada'));
    document.querySelectorAll('.checkbox-ajuste').forEach(cb => cb.checked = false);
};

window.toggleSeleccionAjuste = (checkbox) => {
    const ingredienteId = parseInt(checkbox.dataset.id);
    const tarjeta = checkbox.closest('.tarjeta-ingrediente');
    
    if (checkbox.checked) {
        tarjeta.classList.add('tarjeta-seleccionada');
        // Buscar y cachear el stock_actual y nombre para la Fase 3
        const ingredienteRaw = window.ingredientesOriginales.find(i => i.id === ingredienteId || i.ingrediente_id === ingredienteId);
        window.ingredientesAjusteSeleccionados.set(ingredienteId, {
            id: ingredienteId,
            nombre: ingredienteRaw.nombre_ingrediente || ingredienteRaw.nombre,
            stock_actual: parseFloat(ingredienteRaw.stock_actual) || 0
        });
    } else {
        tarjeta.classList.remove('tarjeta-seleccionada');
        window.ingredientesAjusteSeleccionados.delete(ingredienteId);
    }
    
    document.getElementById('contador-seleccion-ajuste').textContent = window.ingredientesAjusteSeleccionados.size.toString();
};

// FASE 3: VISTA DE EJECUCIÓN (MODAL)
window.confirmarSeleccionAjuste = () => {
    if (window.ingredientesAjusteSeleccionados.size === 0) {
        Swal.fire('Inválido', 'Debe seleccionar al menos un ingrediente.', 'info');
        return;
    }
    
    const tbody = document.getElementById('ajuste-ejecucion-tbody');
    tbody.innerHTML = '';
    
    window.ingredientesAjusteSeleccionados.forEach(ing => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        tr.innerHTML = \`
            <td style="padding: 12px; font-weight: 500;">\${ing.nombre}</td>
            <td style="padding: 12px; color: #64748b;">\${ing.stock_actual.toFixed(3)}</td>
            <td style="padding: 12px;">
                <input type="number" step="0.001" class="ajuste-input-nuevo-stock" data-id="\${ing.id}" data-stock-actual="\${ing.stock_actual}" placeholder="Escriba..." style="width: 100%; padding: 8px; border: 1px solid #94a3b8; border-radius: 4px;" oninput="window.calcularDiferencialAjuste(this)">
            </td>
            <td style="padding: 12px; font-weight: bold;" class="ajuste-diff-cell" id="diff-\${ing.id}">-</td>
        \`;
        tbody.appendChild(tr);
    });
    
    document.getElementById('ajuste-observacion').value = '';
    document.getElementById('modal-ejecucion-ajuste').style.display = 'flex';
};

window.calcularDiferencialAjuste = (input) => {
    const id = input.dataset.id;
    const actual = parseFloat(input.dataset.stockActual);
    const nuevo = parseFloat(input.value);
    const diffCell = document.getElementById('diff-' + id);
    
    if (isNaN(nuevo)) {
        diffCell.textContent = '-';
        diffCell.style.color = 'black';
        return;
    }
    
    const diff = nuevo - actual;
    if (diff > 0) {
        diffCell.textContent = '+' + diff.toFixed(3);
        diffCell.style.color = '#10b981'; // Verde
    } else if (diff < 0) {
        diffCell.textContent = diff.toFixed(3);
        diffCell.style.color = '#ef4444'; // Rojo
    } else {
        diffCell.textContent = '0.000';
        diffCell.style.color = '#3b82f6'; // Azul
    }
};

window.procesarAjustes = async () => {
    const inputs = document.querySelectorAll('.ajuste-input-nuevo-stock');
    const observacion = document.getElementById('ajuste-observacion').value.trim();
    
    if (!observacion) {
        Swal.fire('Inválido', 'Debe escribir una observación de ajuste obligatoria.', 'warning');
        return;
    }
    
    let ajustesValidar = [];
    let errores = false;
    
    inputs.forEach(input => {
        const id = parseInt(input.dataset.id);
        const nuevo = parseFloat(input.value);
        if (isNaN(nuevo)) {
            errores = true;
        } else {
            ajustesValidar.push({ ingrediente_id: id, nuevo_stock: nuevo, observacion: observacion });
        }
    });
    
    if (errores || ajustesValidar.length === 0) {
        Swal.fire('Inválido', 'Falta cargar el nuevo stock en uno o más ítems.', 'error');
        return;
    }
    
    const boton = document.getElementById('btn-procesar-ajuste');
    boton.disabled = true;
    boton.textContent = '⏱️ Procesando...';
    
    try {
        const res = await fetch('http://localhost:3002/api/produccion/ingredientes/ajustar-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario_id: window.usuarioAjusteGlobal.id,
                ajustes: ajustesValidar
            })
        });
        
        if (!res.ok) throw new Error((await res.json()).error || 'Error en servidor');
        
        Swal.fire('Éxito', 'Ajustes de inventario impactados correctamente.', 'success');
        
        // Cerrar modales y cancelar modo
        document.getElementById('modal-ejecucion-ajuste').style.display = 'none';
        window.cancelarModoAjuste();
        
        // Recargar grilla simulando click en deposito
        document.getElementById('filtro-nombre').value = '';
        await window.cargarIngredientes();
        
    } catch(e) {
        Swal.fire('Error Fatal', e.message, 'error');
    } finally {
        boton.disabled = false;
        boton.textContent = '⚠️ Impactar Ajuste';
    }
};
`;

fs.appendFileSync('src/produccion/js/ingredientes.js', '\n' + jsContent);
console.log('Frontend logic scripts appended successfully.');
