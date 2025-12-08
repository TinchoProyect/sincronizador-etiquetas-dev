/**
 * App Móvil para Choferes
 * Gestión de rutas y entregas
 */

// Configuración
const API_BASE_URL = window.location.origin;

// Estado global
let state = {
    sesion: null,
    ruta: null,
    entregas: []
};

// ===== GESTIÓN DE SESIÓN =====

/**
 * Obtener sesión del localStorage
 */
function obtenerSesion() {
    try {
        const sesionStr = localStorage.getItem('sesion_chofer');
        return sesionStr ? JSON.parse(sesionStr) : null;
    } catch (error) {
        console.error('[SESION] Error al obtener sesión:', error);
        return null;
    }
}

/**
 * Guardar sesión en localStorage
 */
function guardarSesion(sesion) {
    try {
        localStorage.setItem('sesion_chofer', JSON.stringify(sesion));
        state.sesion = sesion;
        console.log('[SESION] Sesión guardada:', sesion.usuario);
    } catch (error) {
        console.error('[SESION] Error al guardar sesión:', error);
    }
}

/**
 * Limpiar sesión
 */
function limpiarSesion() {
    localStorage.removeItem('sesion_chofer');
    state.sesion = null;
    console.log('[SESION] Sesión limpiada');
}

/**
 * Verificar si hay sesión activa
 */
function verificarSesion() {
    const sesion = obtenerSesion();
    
    if (!sesion || !sesion.token) {
        console.log('[SESION] No hay sesión activa, redirigiendo a login');
        window.location.href = 'index.html';
        return false;
    }
    
    state.sesion = sesion;
    console.log('[SESION] Sesión activa:', sesion.usuario);
    return true;
}

/**
 * Iniciar sesión
 */
async function iniciarSesion() {
    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;
    
    if (!usuario || !password) {
        mostrarError('Por favor complete todos los campos');
        return;
    }
    
    const btnLogin = document.getElementById('btn-login');
    btnLogin.disabled = true;
    btnLogin.textContent = 'Iniciando sesión...';
    
    try {
        // Llamar a API de login móvil
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            // Guardar sesión
            guardarSesion({
                token: result.data.token || 'mock-token',
                usuario: result.data.usuario || usuario,
                nombre: result.data.nombre_completo || usuario,
                id: result.data.id
            });
            
            console.log('[LOGIN] Sesión iniciada exitosamente');
            
            // Redirigir a ruta
            window.location.href = 'ruta.html';
            
        } else {
            throw new Error(result.error || 'Credenciales inválidas');
        }
        
    } catch (error) {
        console.error('[LOGIN] Error:', error);
        mostrarError(error.message || 'Error al iniciar sesión. Verifique sus credenciales.');
        
        btnLogin.disabled = false;
        btnLogin.textContent = 'Iniciar Sesión';
    }
}

/**
 * Cerrar sesión
 */
function cerrarSesion() {
    if (confirm('¿Está seguro de cerrar sesión?')) {
        limpiarSesion();
        window.location.href = 'index.html';
    }
}

/**
 * Mostrar mensaje de error
 */
function mostrarError(mensaje) {
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.textContent = mensaje;
        errorDiv.style.display = 'block';
        
        // Ocultar después de 5 segundos
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    } else {
        alert('❌ ' + mensaje);
    }
}

/**
 * Mostrar mensaje de éxito
 */
function mostrarExito(mensaje) {
    alert('✅ ' + mensaje);
}

// ===== GESTIÓN DE RUTA ===== 

/**
 * Cargar ruta activa del chofer
 */
async function cargarRutaActiva() {
    const container = document.getElementById('entregas-container');
    
    if (!container) {
        console.warn('[RUTA] Contenedor de entregas no encontrado');
        return;
    }
    
    try {
        const sesion = obtenerSesion();
        
        if (!sesion) {
            window.location.href = 'index.html';
            return;
        }
        
        // Llamar a API de ruta activa
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/ruta-activa`, {
            headers: {
                'Authorization': `Bearer ${sesion.token}`
            }
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            state.ruta = result.data.ruta;
            state.entregas = result.data.entregas || [];
            
            // Actualizar header
            actualizarHeader();
            
            // Renderizar entregas
            renderizarEntregas();
            
            console.log('[RUTA] Ruta cargada:', state.ruta.nombre_ruta);
            console.log('[RUTA] Entregas:', state.entregas.length);
            
        } else {
            throw new Error(result.error || 'No se encontró ruta activa');
        }
        
    } catch (error) {
        console.error('[RUTA] Error al cargar ruta:', error);
        
        // Mostrar estado vacío
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <h2>Sin Ruta Asignada</h2>
                <p>No tienes una ruta activa para hoy.</p>
                <p class="mt-1">Contacta con el backoffice.</p>
            </div>
        `;
    }
}

/**
 * Actualizar información del header
 */
function actualizarHeader() {
    const sesion = obtenerSesion();
    
    // Nombre del chofer
    const choferNombre = document.getElementById('chofer-nombre');
    if (choferNombre) {
        choferNombre.textContent = sesion.nombre || sesion.usuario;
    }
    
    // Nombre de la ruta
    const rutaNombre = document.getElementById('ruta-nombre');
    if (rutaNombre && state.ruta) {
        rutaNombre.textContent = state.ruta.nombre_ruta || `Ruta #${state.ruta.id}`;
    }
    
    // Estadísticas
    const totalEntregas = state.entregas.length;
    const completadas = state.entregas.filter(e => e.estado_logistico === 'ENTREGADO').length;
    const pendientes = totalEntregas - completadas;
    
    const totalEl = document.getElementById('total-entregas');
    const completadasEl = document.getElementById('entregas-completadas');
    const pendientesEl = document.getElementById('entregas-pendientes');
    
    if (totalEl) totalEl.textContent = totalEntregas;
    if (completadasEl) completadasEl.textContent = completadas;
    if (pendientesEl) pendientesEl.textContent = pendientes;
}

/**
 * Renderizar lista de entregas
 */
function renderizarEntregas() {
    const container = document.getElementById('entregas-container');
    
    if (!state.entregas || state.entregas.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <h2>Ruta Sin Entregas</h2>
                <p>Esta ruta no tiene entregas asignadas.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.entregas.map((entrega, index) => {
        const esCompletada = entrega.estado_logistico === 'ENTREGADO';
        const claseCard = esCompletada ? 'entrega-card completada' : 'entrega-card';
        const claseBadge = esCompletada ? 'entrega-badge badge-completada' : 'entrega-badge badge-pendiente';
        const textoBadge = esCompletada ? 'Completada' : 'Pendiente';
        
        return `
            <div class="${claseCard}" data-id="${entrega.id_presupuesto}">
                <div class="entrega-header">
                    <div class="entrega-numero">${entrega.orden_entrega || index + 1}</div>
                    <div class="${claseBadge}">${textoBadge}</div>
                </div>
                
                <div class="entrega-cliente">
                    👤 ${entrega.cliente.nombre || 'Cliente sin nombre'}
                </div>
                
                <div class="entrega-direccion">
                    📍 ${entrega.domicilio.direccion || 'Sin dirección'}
                    ${entrega.domicilio.localidad ? `<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${entrega.domicilio.localidad}` : ''}
                </div>
                
                ${entrega.total ? `
                    <div class="entrega-monto">
                        💰 $${parseFloat(entrega.total).toFixed(2)}
                    </div>
                ` : ''}
                
                ${entrega.domicilio.instrucciones_entrega ? `
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.75rem; padding: 0.5rem; background-color: #fef3c7; border-radius: 0.375rem;">
                        💡 ${entrega.domicilio.instrucciones_entrega}
                    </div>
                ` : ''}
                
                <div class="entrega-actions">
                    <button class="btn-navegar" onclick="navegarAEntrega(${entrega.domicilio.latitud}, ${entrega.domicilio.longitud}, '${encodeURIComponent(entrega.domicilio.direccion || '')}')">
                        🗺️ Navegar
                    </button>
                    <button class="btn-confirmar" onclick="confirmarEntrega(${entrega.id_presupuesto})" ${esCompletada ? 'disabled' : ''}>
                        ${esCompletada ? '✅ Entregado' : '✅ Confirmar'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Agregar clase de animación
    container.classList.add('fade-in');
}

/**
 * Navegar a una entrega usando Google Maps
 */
function navegarAEntrega(latitud, longitud, direccion) {
    if (!latitud || !longitud) {
        mostrarError('Esta entrega no tiene coordenadas GPS');
        return;
    }
    
    // Generar link de Google Maps con navegación
    const direccionEncoded = encodeURIComponent(decodeURIComponent(direccion));
    const link = `https://www.google.com/maps/dir/?api=1&destination=${latitud},${longitud}&destination_place_id=${direccionEncoded}`;
    
    console.log('[NAVEGACION] Abriendo Google Maps:', link);
    
    // Abrir en nueva pestaña/app
    window.open(link, '_blank');
}

/**
 * Confirmar entrega (placeholder)
 */
function confirmarEntrega(presupuestoId) {
    console.log('[ENTREGA] Confirmar entrega de presupuesto:', presupuestoId);
    
    // TODO: Implementar modal de confirmación con foto y firma
    alert('Funcionalidad de confirmación de entrega en desarrollo.\n\nPróximamente podrás:\n- Tomar foto del remito\n- Capturar firma del receptor\n- Registrar datos de quien recibe');
}

/**
 * Refrescar ruta
 */
async function refrescarRuta() {
    const btn = event?.target;
    if (btn) {
        btn.textContent = '⏳';
        btn.disabled = true;
    }
    
    await cargarRutaActiva();
    
    if (btn) {
        btn.textContent = '🔄';
        btn.disabled = false;
    }
}

/**
 * Cerrar modal de entrega
 */
function cerrarModalEntrega() {
    const modal = document.getElementById('modal-confirmar-entrega');
    if (modal) {
        modal.style.display = 'none';
    }
}

// ===== UTILIDADES =====

/**
 * Formatear fecha
 */
function formatearFecha(fecha) {
    const date = new Date(fecha);
    return date.toLocaleDateString('es-AR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Formatear hora
 */
function formatearHora(fecha) {
    const date = new Date(fecha);
    return date.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ===== AUTOLOGIN DESDE QR =====

/**
 * Procesar autologin desde parámetros URL
 */
async function procesarAutologin() {
    const urlParams = new URLSearchParams(window.location.search);
    const autologin = urlParams.get('autologin');
    const usuario = urlParams.get('u');
    const password = urlParams.get('p');
    
    if (autologin === 'true' && usuario && password) {
        console.log('[AUTOLOGIN] Detectados parámetros de autologin');
        console.log('[AUTOLOGIN] Usuario:', usuario);
        console.log('[AUTOLOGIN] API Base URL:', API_BASE_URL);
        
        // Limpiar URL (quitar parámetros sensibles)
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Ejecutar login automático
        try {
            // Construir URL completa para debugging
            const loginUrl = `${API_BASE_URL}/api/logistica/movil/login`;
            console.log('[AUTOLOGIN] Llamando a:', loginUrl);
            
            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ 
                    usuario: decodeURIComponent(usuario), 
                    password: decodeURIComponent(password) 
                })
            });
            
            console.log('[AUTOLOGIN] Response status:', response.status);
            console.log('[AUTOLOGIN] Response ok:', response.ok);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('[AUTOLOGIN] Result:', result);
            
            if (result.success && result.data) {
                // Guardar sesión
                guardarSesion({
                    token: result.data.token || 'mock-token',
                    usuario: result.data.usuario || usuario,
                    nombre: result.data.nombre_completo || usuario,
                    id: result.data.id
                });
                
                console.log('[AUTOLOGIN] Login automático exitoso');
                
                // Pequeño delay para que el usuario vea el éxito
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Redirigir a ruta
                window.location.href = 'ruta.html';
                
            } else {
                throw new Error(result.error || 'Autologin falló: respuesta inválida');
            }
            
        } catch (error) {
            console.error('[AUTOLOGIN] Error completo:', error);
            
            // Quitar overlay
            const overlay = document.getElementById('autologin-overlay');
            if (overlay) {
                overlay.remove();
            }
            
            // Restaurar formulario
            const loginForm = document.querySelector('.login-form');
            if (loginForm) {
                loginForm.style.opacity = '1';
                loginForm.style.pointerEvents = 'auto';
            }
            
            // Mostrar error detallado
            const errorMsg = `❌ Error en Auto-Login:\n\n${error.message}\n\nAPI: ${API_BASE_URL}\n\nPor favor inicie sesión manualmente.`;
            alert(errorMsg);
            mostrarError(error.message);
        }
    }
}

// ===== INICIALIZACIÓN =====

console.log('[MOBILE-APP] App móvil inicializada');
console.log('[MOBILE-APP] API Base URL:', API_BASE_URL);

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    console.log('[MOBILE-APP] DOM cargado');
    
    // Procesar autologin si está en la página de login
    const esLogin = window.location.pathname.includes('index.html') || 
                    window.location.pathname.endsWith('/mobile/') ||
                    window.location.pathname.endsWith('/mobile');
    
    if (esLogin) {
        const urlParams = new URLSearchParams(window.location.search);
        const autologin = urlParams.get('autologin');
        
        if (autologin === 'true') {
            // Mostrar feedback visual
            mostrarFeedbackAutologin();
            
            // Ejecutar autologin
            procesarAutologin();
        }
    }
});

/**
 * Mostrar feedback visual durante autologin
 */
function mostrarFeedbackAutologin() {
    const loginForm = document.querySelector('.login-form');
    
    if (loginForm) {
        // Ocultar formulario
        loginForm.style.opacity = '0.5';
        loginForm.style.pointerEvents = 'none';
        
        // Crear overlay de carga
        const overlay = document.createElement('div');
        overlay.id = 'autologin-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 20px;
        `;
        
        overlay.innerHTML = `
            <div style="text-align: center; max-width: 90%;">
                <div style="font-size: 3rem; margin-bottom: 1rem; animation: spin 1s linear infinite;">
                    🔄
                </div>
                <h2 style="color: #1e40af; margin-bottom: 0.5rem; font-size: 1.5rem;">
                    Iniciando sesión automáticamente...
                </h2>
                <p style="color: #64748b; font-size: 0.875rem;">
                    Por favor espere
                </p>
                <p style="color: #94a3b8; font-size: 0.75rem; margin-top: 1rem;">
                    Conectando a: ${API_BASE_URL}
                </p>
            </div>
            <style>
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            </style>
        `;
        
        document.body.appendChild(overlay);
        
        console.log('[AUTOLOGIN] Feedback visual mostrado');
        console.log('[AUTOLOGIN] API Base URL:', API_BASE_URL);
    }
}
