/**
 * App Móvil para Choferes
 * Gestión de rutas y entregas
 */

// Eliminar dependencia de IP o DNS para asegurar acceso local (Hairpin NAT agnostic)
const API_BASE_URL = "";

// Estado global de la aplicación
let state = {
    sesion: null,
    ruta: null,              // Ruta actualmente seleccionada
    entregas: [],            // Entregas de la ruta seleccionada
    rutasDisponibles: []     // Lista compacta de TODAS las rutas del chofer (para Context Switcher)
};

// ===== GESTIÓN DE SESIÓN =====

/**
 * Obtener sesión del localStorage o sessionStorage
 */
function obtenerSesion() {
    try {
        const sesionStr = localStorage.getItem('sesion_chofer') || sessionStorage.getItem('sesion_chofer');
        return sesionStr ? JSON.parse(sesionStr) : null;
    } catch (error) {
        console.error('[SESION] Error al obtener sesión:', error);
        return null;
    }
}

/**
 * Guardar sesión en el storage correspondiente
 */
function guardarSesion(sesion, persistente = true) {
    try {
        const sesionStr = JSON.stringify(sesion);
        if (persistente) {
            localStorage.setItem('sesion_chofer', sesionStr);
            sessionStorage.removeItem('sesion_chofer');
        } else {
            sessionStorage.setItem('sesion_chofer', sesionStr);
            localStorage.removeItem('sesion_chofer');
        }
        state.sesion = sesion;
        console.log(`[SESION] Sesión guardada (${persistente ? 'persistente' : 'volátil'}):`, sesion.usuario);
    } catch (error) {
        console.error('[SESION] Error al guardar sesión:', error);
    }
}

/**
 * Limpiar sesión
 */
function limpiarSesion() {
    localStorage.removeItem('sesion_chofer');
    sessionStorage.removeItem('sesion_chofer');
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
            // Determinar si el usuario pidió mantener iniciada la sesión
            const checkboxRecordarme = document.getElementById('recordarme');
            // Por defecto true para mayor compatibilidad si el checkbox no existe (autologin QR)
            const persistente = checkboxRecordarme ? checkboxRecordarme.checked : true;

            // Guardar sesión
            guardarSesion({
                token: result.data.token || 'mock-token',
                usuario: result.data.usuario || usuario,
                nombre: result.data.nombre_completo || usuario,
                id: result.data.id
            }, persistente);

            console.log('[LOGIN] Sesión iniciada exitosamente');

            // Redirigir a home
            window.location.href = 'home.html';

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
 * Cargar ruta activa del chofer desde el backend.
 * Flujo multigestión:
 * 1) Fetch /mis-rutas → poblar state.rutasDisponibles (para el selector)
 * 2) Determinar qué ruta cargar: activeRouteId (sessionStorage) o auto-prioridad
 * 3) Fetch /ruta-activa?id=X → poblar state.ruta + state.entregas
 * 4) Renderizar selector + entregas
 *
 * @param {number|null} rutaIdForzada - Si se pasa, fuerza la carga de esa ruta específica
 */
async function cargarRutaActiva(rutaIdForzada = null) {
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

        // Paso 1: Obtener listado de TODAS las rutas activas del chofer
        const resRutas = await fetch(`${API_BASE_URL}/api/logistica/movil/mis-rutas`, {
            cache: 'no-store',
            headers: { 'Authorization': `Bearer ${sesion.token}` }
        });
        const resultRutas = await resRutas.json();

        if (resultRutas.success) {
            state.rutasDisponibles = resultRutas.data || [];
        } else {
            state.rutasDisponibles = [];
        }

        console.log('[RUTA] Rutas disponibles:', state.rutasDisponibles.length);

        // Paso 2: Determinar qué ruta cargar
        // Prioridad: parámetro forzado > sessionStorage > auto (primera del array)
        let rutaIdACargar = rutaIdForzada
            || parseInt(sessionStorage.getItem('activeRouteId'))
            || null;

        // Validar que el ID almacenado siga existiendo en las rutas disponibles
        if (rutaIdACargar && !state.rutasDisponibles.some(r => r.id === rutaIdACargar)) {
            console.log('[RUTA] activeRouteId', rutaIdACargar, 'ya no existe, reseteando');
            rutaIdACargar = null;
            sessionStorage.removeItem('activeRouteId');
        }

        // Si no hay rutas disponibles, mostrar empty state
        if (state.rutasDisponibles.length === 0 && !rutaIdACargar) {
            state.ruta = null;
            state.entregas = [];
            // Renderizar selector vacío (mostrará solo el botón de crear)
            if (typeof renderizarSelectorRuta === 'function') renderizarSelectorRuta();
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <h2>Sin Ruta Asignada</h2>
                    <p>No tienes una ruta activa para hoy.</p>
                    <button onclick="abrirModalNuevaRuta()" style="margin-top: 1.5rem; padding: 14px 20px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem; width: 100%; box-shadow: 0 4px 6px rgba(37,99,235,0.3);">
                        🛣️ Crear Nueva Ruta
                    </button>
                </div>
            `;
            return;
        }

        // Paso 3: Fetch la ruta específica o la primera disponible
        const queryParam = rutaIdACargar ? `?id=${rutaIdACargar}` : '';
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/ruta-activa${queryParam}`, {
            cache: 'no-store',
            headers: { 'Authorization': `Bearer ${sesion.token}` }
        });
        const result = await response.json();

        if (result.success && result.data) {
            state.ruta = result.data.ruta;
            state.entregas = result.data.entregas || [];

            // FASE 3: Mezclar Retiros de Mantenimiento como entregas especiales
            if (result.data.retiros && result.data.retiros.length > 0) {
                const retirosAdaptados = result.data.retiros.map(r => ({
                    id_presupuesto: `RT-${r.id_orden}`,
                    es_retiro_tratamiento: true,
                    hash: r.hash,
                    id_orden_real: r.id_orden,
                    estado: 'Orden de Tratamiento',
                    estado_logistico: r.estado_logistico === 'EN_CAMINO' ? 'RETIRADO' : r.estado_logistico, // EN_CAMINO en el server es que ya viaja en camión, ergo RETIRADO visualmente.
                    total: 0,
                    cliente: r.cliente,
                    domicilio: r.domicilio,
                    detalles: r.detalles 
                }));
                state.entregas = [...state.entregas, ...retirosAdaptados];
            }

            // Persistir la ruta seleccionada para sobrevivir F5
            sessionStorage.setItem('activeRouteId', state.ruta.id);

            // Paso 4: Renderizar UI
            if (typeof renderizarSelectorRuta === 'function') renderizarSelectorRuta();
            actualizarHeader();
            renderizarEntregas();

            console.log('[RUTA] Ruta cargada:', state.ruta.nombre_ruta, '(ID:', state.ruta.id, ')');
            console.log('[RUTA] Entregas:', state.entregas.length);

        } else {
            throw new Error(result.error || 'No se encontró ruta activa');
        }

    } catch (error) {
        console.error('[RUTA] Error al cargar ruta:', error);

        // Resetear estado local
        state.ruta = null;
        state.entregas = [];

        // Renderizar selector (puede haber rutas disponibles aunque la seleccionada falló)
        if (typeof renderizarSelectorRuta === 'function') renderizarSelectorRuta();

        // Estado vacío con botón de creación directa
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <h2>Sin Ruta Asignada</h2>
                <p>No tienes una ruta activa para hoy.</p>
                <button onclick="abrirModalNuevaRuta()" style="margin-top: 1.5rem; padding: 14px 20px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 1.1rem; width: 100%; box-shadow: 0 4px 6px rgba(37,99,235,0.3);">
                    🛣️ Crear Nueva Ruta
                </button>
            </div>
        `;
    }
}

/**
 * Actualizar información del header (nombre del chofer, ruta y estadísticas)
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
 * Renderizar lista de entregas (delegado a RutaActivaUI.js)
 */

/**
 * Agrupar entregas por Cliente + Domicilio (delegado a RutaActivaUI.js)
 */

/**
 * Navegar a una entrega usando Google Maps (delegado a RutaActivaUI.js)
 */

/**
 * Confirmar entrega (delegado a módulo de confirmación)
 */

/**
 * Refrescar ruta (delega a módulo de ruta)
 */
async function refrescarRuta() {
    import('./modules/ruta.js').then(module => {
        module.refrescarRuta();
    }).catch(error => {
        console.error('[RUTA] Error al cargar módulo:', error);
    });
}

/**
 * Finalizar ruta del día (delegado a módulo de ruta)
 */

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
 * Formatear fecha en formato legible (español argentino)
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
 * Formatear hora en formato HH:MM
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

                // Redirigir a home
                window.location.href = 'home.html';

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
document.addEventListener('DOMContentLoaded', function () {
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

// ===== DASHBOARD & TABS =====

let currentTab = 'ruta';

/**
 * Arranca la lógica multi-pestañas
 */
function iniciarDashboard() {
    console.log('[DASHBOARD] Inicializando dashboard...');
    switchTab('ruta'); // Inicia cargando la ruta activa por defecto
}

/**
 * Cambia la pestaña de navegación
 */
function switchTab(tabId) {
    if (!verificarSesion()) return;
    
    // Ocultar todas las tabs
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    // Deseleccionar items del nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    // Mostrar tab seleccionada
    const tabElement = document.getElementById(`tab-${tabId}`);
    const navElement = document.getElementById(`nav-${tabId}`);
    
    if(tabElement) tabElement.classList.add('active');
    if(navElement) navElement.classList.add('active');
    
    currentTab = tabId;
    
    // Cambiar título header principal
    const titles = {
        'pendientes': 'Pedidos Pendientes',
        'ruta': 'Mi Ruta Activa',
        'historial': 'Mis Rutas Cerradas'
    };
    const mainTitle = document.getElementById('main-title');
    if(mainTitle) mainTitle.textContent = titles[tabId];
    
    // Ocultar botón flotante de finalizar si no es ruta activa
    const btnFlotante = document.getElementById('btn-finalizar-flotante');
    if(btnFlotante) {
        btnFlotante.style.display = (tabId === 'ruta' && state.ruta) ? 'flex' : 'none';
    }
    
    // Ocultar panel de estadísticas de ruta y el mini-header de ruta si no estamos en ruta
    const headerStats = document.getElementById('header-stats');
    if(headerStats) headerStats.style.display = tabId === 'ruta' ? 'flex' : 'none';
    
    const infoRutaActiva = document.getElementById('info-ruta-activa');
    if(infoRutaActiva) infoRutaActiva.style.display = tabId === 'ruta' ? 'flex' : 'none';
    
    // Cargar datos asíncronos según la pestaña focalizada
    if (tabId === 'ruta') {
        cargarRutaActiva();
    } else if (tabId === 'pendientes') {
        cargarPendientes();
    } else if (tabId === 'historial') {
        cargarHistorial();
    }
}

/**
 * Forzar actualización de la Data de la pestaña en pantalla
 */
function refrescarTabActual() {
    switchTab(currentTab);
}

// ===== PENDIENTES =====

/**
 * Extrae y renderiza el listado global de Pedidos sin Asignar
 * (Implementado en PendientesUI.js)
 */

// ===== HISTORIAL =====

/**
 * Extrae y renderiza el listado de Rutas Finalizadas por este Chofer
 * (Implementado en HistorialUI.js)
 */

// ==========================================
// FUNCIONES CRUD DE RUTAS (APP GERENCIAL)
// ==========================================

/* ===== SIDEBAR / MENÚ GLOBAL ===== */
window.abrirSidebar = () => {
    const isReady = document.getElementById('sidebar-menu');
    if(isReady) {
        isReady.classList.add('active');
        document.getElementById('sidebar-overlay').classList.add('active');
    }
};

window.cerrarSidebar = () => {
    const isReady = document.getElementById('sidebar-menu');
    if(isReady) {
        isReady.classList.remove('active');
        document.getElementById('sidebar-overlay').classList.remove('active');
    }
};
