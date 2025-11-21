// Modal para derivar artículos a compras

let datosArticuloActual = null;

function abrirModalDerivarCompras(articulo) {
    datosArticuloActual = articulo;
    
    const modal = document.getElementById('modal-derivar-compras');
    if (!modal) return;
    
    document.getElementById('derivar-articulo-numero').value = articulo.articulo_numero || '';
    document.getElementById('derivar-codigo-barras').value = articulo.codigo_barras || '';
    document.getElementById('derivar-id-presupuesto-local').value = articulo.id_presupuesto_local || '';
    document.getElementById('derivar-id-presupuesto-ext').value = articulo.id_presupuesto_ext || '';
    document.getElementById('derivar-cantidad-faltante').value = parseFloat(articulo.cantidad_faltante || articulo.faltante || 0).toFixed(2);
    document.getElementById('derivar-nota').value = '';
    
    const mensajeEl = document.getElementById('derivar-mensaje');
    if (mensajeEl) {
        mensajeEl.style.display = 'none';
        mensajeEl.textContent = '';
    }
    
    modal.style.display = 'flex';
}

function cerrarModalDerivarCompras() {
    const modal = document.getElementById('modal-derivar-compras');
    if (modal) {
        modal.style.display = 'none';
    }
    datosArticuloActual = null;
}

async function confirmarDerivarCompras() {
    const btnConfirmar = document.getElementById('btn-confirmar-derivar');
    const mensajeEl = document.getElementById('derivar-mensaje');
    
    if (!datosArticuloActual) {
        if (mensajeEl) {
            mensajeEl.className = 'mensaje-error';
            mensajeEl.textContent = 'Error: No hay datos del artículo';
            mensajeEl.style.display = 'block';
        }
        return;
    }
    
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Derivando...';
    
    try {
        const payload = {
            articulo_numero: document.getElementById('derivar-articulo-numero').value,
            codigo_barras: document.getElementById('derivar-codigo-barras').value || null,
            id_presupuesto_local: parseInt(document.getElementById('derivar-id-presupuesto-local').value),
            id_presupuesto_ext: document.getElementById('derivar-id-presupuesto-ext').value || null,
            cantidad_faltante: parseFloat(document.getElementById('derivar-cantidad-faltante').value),
            nota: document.getElementById('derivar-nota').value || null
        };
        
        const response = await fetch('/api/produccion/compras/pendientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Error al derivar a compras');
        }
        
        if (mensajeEl) {
            mensajeEl.className = 'mensaje-exito';
            mensajeEl.textContent = '✅ Artículo derivado a compras correctamente';
            mensajeEl.style.display = 'block';
        }
        
        setTimeout(() => {
            cerrarModalDerivarCompras();
            if (typeof window.actualizarResumenFaltantes === 'function') {
                window.actualizarResumenFaltantes();
            }
        }, 1500);
        
    } catch (error) {
        console.error('Error al derivar a compras:', error);
        if (mensajeEl) {
            mensajeEl.className = 'mensaje-error';
            mensajeEl.textContent = `❌ ${error.message}`;
            mensajeEl.style.display = 'block';
        }
        btnConfirmar.disabled = false;
        btnConfirmar.textContent = 'Confirmar Derivación';
    }
}

window.abrirModalDerivarCompras = abrirModalDerivarCompras;
window.cerrarModalDerivarCompras = cerrarModalDerivarCompras;
window.confirmarDerivarCompras = confirmarDerivarCompras;
