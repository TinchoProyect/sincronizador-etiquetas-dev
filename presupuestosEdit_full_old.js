console.log('🔍 [PRESUPUESTOS-EDIT] Cargando módulo de edición de presupuestos...');

// Variables globales
let presupuestoId = null;
let presupuestoData = null;

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    console.log('📋 [PRESUPUESTOS-EDIT] Inicializando página de edición...');
    
    // Obtener ID del presupuesto desde URL
    const urlParams = new URLSearchParams(window.location.search);
    presupuestoId = urlParams.get('id');
    
    if (!presupuestoId) {
        mostrarMensaje('❌ No se especificó el ID del presupuesto a editar', 'error');
        setTimeout(() => {
            window.location.href = '/presupuestos/pages/presupuestos.html';
        }, 3000);
        return;
    }
    
    console.log(`📋 [PRESUPUESTOS-EDIT] ID del presupuesto: ${presupuestoId}`);
    
    // Configurar formulario
    const form = document.getElementById('form-editar-presupuesto');
    form.addEventListener('submit', handleSubmit);
    
    // Cargar datos del presupuesto
    cargarPresupuesto();
    
    console.log('✅ [PRESUPUESTOS-EDIT] Página inicializada correctamente');
});

/**
 * Cargar datos del presupuesto
 */
async function cargarPresupuesto() {
    console.log(`📥 [PRESUPUESTOS-EDIT] Cargando datos del presupuesto ${presupuestoId}...`);
    
    try {
        // Obtener datos del presupuesto
        const response = await fetch(`/api/presupuestos/${presupuestoId}`);
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Error al cargar el presupuesto');
        }
        
        presupuestoData = result.data;
        console.log('📋 [PRESUPUESTOS-EDIT] Datos del presupuesto cargados:', presupuestoData);
        
        // Llenar información de solo lectura
        llenarInformacionPresupuesto();
        
        // Llenar campos editables
        llenarCamposEditables();
        
        // Obtener detalles del presupuesto
        await cargarDetallesPresupuesto();
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al cargar presupuesto:', error);
        mostrarMensaje(`❌ Error al cargar el presupuesto: ${error.message}`, 'error');
    }
}

/**
 * Cargar detalles del presupuesto
 */
async function cargarDetallesPresupuesto() {
    console.log(`📦 [PRESUPUESTOS-EDIT] Cargando detalles del presupuesto ${presupuestoId}...`);
    
    try {
        const response = await fetch(`/api/presupuestos/${presupuestoId}/detalles`);
        const result = await response.json();
        
        if (response.ok && result.success) {
            const detallesCount = result.data ? result.data.length : 0;
            document.getElementById('info-detalles').textContent = `${detallesCount} artículos`;
            console.log(`📦 [PRESUPUESTOS-EDIT] Detalles cargados: ${detallesCount} artículos`);
        } else {
            console.warn('⚠️ [PRESUPUESTOS-EDIT] No se pudieron cargar los detalles');
            document.getElementById('info-detalles').textContent = 'No disponible';
        }
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al cargar detalles:', error);
        document.getElementById('info-detalles').textContent = 'Error al cargar';
    }
}

/**
 * Llenar información de solo lectura
 */
function llenarInformacionPresupuesto() {
    console.log('📋 [PRESUPUESTOS-EDIT] Llenando información del presupuesto...');
    
    document.getElementById('info-id').textContent = presupuestoData.id_presupuesto_ext || presupuestoData.id || '-';
    document.getElementById('info-cliente').textContent = presupuestoData.id_cliente || '-';
    document.getElementById('info-fecha').textContent = formatearFecha(presupuestoData.fecha) || '-';
    document.getElementById('info-estado').textContent = presupuestoData.estado || '-';
    document.getElementById('info-tipo').textContent = presupuestoData.tipo_comprobante || '-';
}

/**
 * Llenar campos editables con datos actuales
 */
function llenarCamposEditables() {
    console.log('✏️ [PRESUPUESTOS-EDIT] Llenando campos editables...');
    
    document.getElementById('agente').value = presupuestoData.agente || '';
    document.getElementById('punto_entrega').value = presupuestoData.punto_entrega || '';
    document.getElementById('descuento').value = presupuestoData.descuento || '';
    document.getElementById('nota').value = presupuestoData.nota || '';
    
    // Fecha de entrega (convertir formato si es necesario)
    if (presupuestoData.fecha_entrega) {
        const fechaEntrega = new Date(presupuestoData.fecha_entrega);
        if (!isNaN(fechaEntrega.getTime())) {
            document.getElementById('fecha_entrega').value = fechaEntrega.toISOString().split('T')[0];
        }
    }
}

/**
 * Formatear fecha para mostrar
 */
function formatearFecha(fecha) {
    if (!fecha) return null;
    
    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) return fecha; // Si no es válida, devolver original
        
        return date.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    } catch (error) {
        return fecha;
    }
}

/**
 * Manejar envío del formulario
 */
async function handleSubmit(event) {
    event.preventDefault();
    
    console.log('📤 [PRESUPUESTOS-EDIT] Iniciando envío de formulario...');
    
    const btnGuardar = document.getElementById('btn-guardar');
    const spinner = btnGuardar.querySelector('.loading-spinner');
    
    // Mostrar loading
    btnGuardar.disabled = true;
    spinner.style.display = 'inline-block';
    
    try {
        // Recopilar datos del formulario
        const formData = new FormData(event.target);
        const data = {};
        
        // Solo incluir campos que tienen valor
        const agente = formData.get('agente');
        if (agente !== null && agente !== '') {
            data.agente = agente;
        }
        
        const puntoEntrega = formData.get('punto_entrega');
        if (puntoEntrega !== null && puntoEntrega !== '') {
            data.punto_entrega = puntoEntrega;
        }
        
        const descuento = formData.get('descuento');
        if (descuento !== null && descuento !== '') {
            data.descuento = parseFloat(descuento);
        }
        
        const fechaEntrega = formData.get('fecha_entrega');
        if (fechaEntrega !== null && fechaEntrega !== '') {
            data.fecha_entrega = fechaEntrega;
        }
        
        const nota = formData.get('nota');
        if (nota !== null && nota !== '') {
            data.nota = nota;
        }
        
        // Verificar que hay al menos un campo para actualizar
        if (Object.keys(data).length === 0) {
            throw new Error('No se han modificado campos para actualizar');
        }
        
        console.log('📋 [PRESUPUESTOS-EDIT] Datos a enviar:', data);
        
        // Enviar a la API
        const response = await fetch(`/api/presupuestos/${presupuestoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        console.log('📥 [PRESUPUESTOS-EDIT] Respuesta recibida:', result);
        
        if (response.ok && result.success) {
            // Éxito
            mostrarMensaje('✅ Presupuesto actualizado exitosamente', 'success');
            
            console.log('✅ [PRESUPUESTOS-EDIT] Presupuesto actualizado correctamente');
            
            // Actualizar datos locales
            presupuestoData = { ...presupuestoData, ...data };
            
            // Redirigir después de 2 segundos
            setTimeout(() => {
                window.location.href = '/presupuestos/pages/presupuestos.html';
            }, 2000);
            
        } else {
            // Error
            const errorMsg = result.error || result.message || 'Error desconocido';
            throw new Error(errorMsg);
        }
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-EDIT] Error al actualizar presupuesto:', error);
        
        mostrarMensaje(`❌ Error al actualizar presupuesto: ${error.message}`, 'error');
        
    } finally {
        // Ocultar loading
        btnGuardar.disabled = false;
        spinner.style.display = 'none';
    }
}

/**
 * Mostrar mensaje al usuario
 */
function mostrarMensaje(texto, tipo = 'info') {
    console.log(`💬 [PRESUPUESTOS-EDIT] Mostrando mensaje: ${texto}`);
    
    const container = document.getElementById('message-container');
    
    // Limpiar mensajes anteriores
    container.innerHTML = '';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${tipo}`;
    messageDiv.textContent = texto;
    messageDiv.style.display = 'block';
    
    container.appendChild(messageDiv);
    
    // Auto-ocultar después de 5 segundos (excepto errores)
    if (tipo !== 'error') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }
}

console.log('✅ [PRESUPUESTOS-EDIT] Módulo de edición cargado correctamente');
