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
                    orden_entrega: r.orden_entrega,
                    hash: r.hash,
                    id_orden_real: r.id_orden,
                    estado: 'Orden de Tratamiento',
                    estado_logistico: r.estado_logistico === 'EN_CAMINO' ? 'RETIRADO' : r.estado_logistico, // EN_CAMINO en el server es que ya viaja en camión, ergo RETIRADO visualmente.
                    estado_tratamiento: r.estado_tratamiento,
                    total: 0,
                    cliente: r.cliente,
                    domicilio: r.domicilio,
                    detalles: r.detalles 
                }));
                state.entregas = [...state.entregas, ...retirosAdaptados];
            }

            // FASE 4: Mezclar Sobres de Efectivo (Ensobrados) asignados a la ruta
            if (result.data.sobres && result.data.sobres.length > 0) {
                const sobresAdaptados = result.data.sobres.map(s => ({
                    id_presupuesto: `SOB-${s.id_sobre}`,
                    es_sobre_efectivo: true,
                    id_sobre_real: s.id_sobre,
                    codigo_sobre: s.codigo_sobre,
                    monto_declarado: s.monto_declarado,
                    foto_frente_url: s.foto_frente_url,
                    foto_dorso_url: s.foto_dorso_url,
                    orden_entrega: s.orden_entrega,
                    estado: 'Sobre de Efectivo',
                    estado_sobre: s.estado,
                    estado_logistico: s.estado_logistico,
                    total: 0,
                    cliente: s.cliente,
                    domicilio: s.domicilio
                }));
                state.entregas = [...state.entregas, ...sobresAdaptados];
            }

            // FASE 5: Mezclar Visitas Comerciales de Preventa asignadas a la ruta
            if (result.data.visitas_preventa && result.data.visitas_preventa.length > 0) {
                const visitasAdaptadas = result.data.visitas_preventa.map(v => ({
                    id_presupuesto: `PR-${v.id_prospecto}`,
                    es_visita_preventa: true,
                    id_prospecto_real: v.id_prospecto,
                    codigo_prospecto: v.codigo_prospecto,
                    origen_contacto: v.origen_contacto,
                    rubro: v.rubro,
                    contacto_nombre: v.contacto_nombre,
                    contacto_rol: v.contacto_rol,
                    telefono_whatsapp: v.telefono_whatsapp,
                    email: v.email,
                    notas: v.notas,
                    imagen_url: v.imagen_url,
                    web_redes: v.web_redes,
                    lista_precios_sugerida_id: v.lista_precios_sugerida_id,
                    orden_entrega: v.orden_entrega,
                    estado: 'Visita Comercial',
                    estado_prospecto: v.estado,
                    estado_ruta: v.estado_ruta,
                    estado_logistico: v.estado_logistico,
                    total: 0,
                    cliente: v.cliente,
                    domicilio: v.domicilio
                }));
                state.entregas = [...state.entregas, ...visitasAdaptadas];
            }

            // Consolidar y garantizar ordenamiento estricto
            state.entregas.sort((a, b) => (a.orden_entrega ?? 999) - (b.orden_entrega ?? 999));

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
    const completadas = state.entregas.filter(e => e.estado_logistico === 'ENTREGADO' || e.estado_logistico === 'RETIRADO').length;
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
 * Alternar modo Pausa
 */
window.togglePausaRuta = async function(pausar) {
    if (!state.ruta) return;

    if (pausar && !confirm('¿Desea pausar la ruta? No podrá realizar entregas ni retiros mientras esté pausada.')) return;
    if (!pausar && !confirm('¿Desea reanudar la ruta?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/pausa`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${sesion.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ en_pausa: pausar })
        });

        const result = await response.json();

        if (result.success) {
            mostrarExito(result.message);
            // Refrescar para obtener el nuevo estado e impedir confirmaciones en UI
            refrescarRuta();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('[PAUSA] Error:', error);
        mostrarError('No se pudo modificar el estado de pausa: ' + error.message);
    }
};

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
 * Ver fotos del sobre de efectivo en modal móvil
 */
window.verFotosSobreMovil = function(codigoSobre, frenteUrl, dorsoUrl) {
    let htmlFotos = '<div style="display:flex; flex-direction:column; gap:12px;">';
    if (frenteUrl) {
        htmlFotos += `<div><div style="font-size:0.8rem; font-weight:700; color:#475569; margin-bottom:4px;">📷 Frente del Sobre</div><img src="${frenteUrl}" style="width:100%; max-height:280px; object-fit:contain; border-radius:8px; border:1px solid #cbd5e1;"></div>`;
    }
    if (dorsoUrl) {
        htmlFotos += `<div><div style="font-size:0.8rem; font-weight:700; color:#475569; margin-bottom:4px;">📷 Dorso del Sobre</div><img src="${dorsoUrl}" style="width:100%; max-height:280px; object-fit:contain; border-radius:8px; border:1px solid #cbd5e1;"></div>`;
    }
    htmlFotos += '</div>';

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: `💵 Sobre #${codigoSobre}`,
            html: htmlFotos,
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#7c3aed'
        });
    }
};

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

/* ===== SIDEBAR / MENÚ GLOBAL UNIVERSAL ===== */

window.inicializarSidebarUniversal = () => {
    let overlay = document.getElementById('sidebar-overlay');
    let sidebar = document.getElementById('sidebar-menu');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebar-overlay';
        overlay.className = 'sidebar-overlay';
        overlay.onclick = () => window.cerrarSidebar();
        document.body.appendChild(overlay);
    }

    const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
    const userName = (sesion && (sesion.nombre || sesion.usuario)) ? (sesion.nombre || sesion.usuario) : 'Usuario LAMDA';
    const userRole = (sesion && sesion.rol) ? sesion.rol : 'Operador';
    const initial = userName.charAt(0).toUpperCase() || 'L';

    // Determinar la página activa
    const currentPath = window.location.pathname.toLowerCase();
    const isHome = currentPath.endsWith('home.html') || currentPath.endsWith('/mobile/') || currentPath.endsWith('/mobile');
    const isRuta = currentPath.includes('ruta.html');
    const isPresupuestos = currentPath.includes('presupuestos.html') && !currentPath.includes('crear-presupuesto');
    const isCotizador = currentPath.includes('crear-presupuesto-movil.html');
    const isClientes = currentPath.includes('clientes.html') && !currentPath.includes('crear-cliente');
    const isCrearCliente = currentPath.includes('crear-cliente-movil.html');
    const isProspectos = currentPath.includes('prospectos.html');
    const isFotosDeposito = currentPath.includes('fotos-deposito.html');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (!sidebar) {
        sidebar = document.createElement('div');
        sidebar.id = 'sidebar-menu';
        sidebar.className = 'sidebar-menu';
        document.body.appendChild(sidebar);
    }

    sidebar.innerHTML = `
        <div class="sidebar-header">
            <div class="sidebar-brand-box">
                <div class="sidebar-brand-avatar">${initial}</div>
                <div>
                    <h2>${userName}</h2>
                    <p><span>🟢</span> ${userRole}</p>
                </div>
            </div>
            <button class="sidebar-close-btn" onclick="window.cerrarSidebar()" title="Cerrar Menú">✕</button>
        </div>
        <div class="sidebar-content">
            <div class="sidebar-nav-title">Principal</div>
            
            <a href="home.html" class="sidebar-item ${isHome ? 'active-module' : ''}">
                <span class="sidebar-icon">🏠</span>
                <span>Inicio</span>
            </a>

            <div class="sidebar-nav-title">Módulos de Gestión</div>
            
            <a href="prospectos.html" class="sidebar-item ${isProspectos ? 'active-module' : ''}">
                <span class="sidebar-icon">🎯</span>
                <span>Contacto Calle</span>
                <span class="sidebar-badge" style="border-color:rgba(234,88,12,0.4); color:#fdba74; background:rgba(234,88,12,0.15);">Calle</span>
            </a>

            <a href="ruta.html" class="sidebar-item ${isRuta ? 'active-module' : ''}">
                <span class="sidebar-icon">🚚</span>
                <span>Logística (Hoja de Ruta)</span>
                <span class="sidebar-badge" style="border-color:rgba(59,130,246,0.4); color:#93c5fd; background:rgba(59,130,246,0.15);">Rutas</span>
            </a>
            
            <a href="presupuestos.html" class="sidebar-item ${isPresupuestos ? 'active-module' : ''}">
                <span class="sidebar-icon">💰</span>
                <span>Ventas / Presupuestos</span>
                <span class="sidebar-badge" style="border-color:rgba(16,185,129,0.4); color:#6ee7b7; background:rgba(16,185,129,0.15);">Búnker</span>
            </a>

            <a href="clientes.html" class="sidebar-item ${isClientes ? 'active-module' : ''}">
                <span class="sidebar-icon">👥</span>
                <span>Clientes</span>
                <span class="sidebar-badge">Directorio</span>
            </a>

            <a href="fotos-deposito.html" class="sidebar-item ${isFotosDeposito ? 'active-module' : ''}">
                <span class="sidebar-icon">📸</span>
                <span>Fotos Depósito (B2B)</span>
                <span class="sidebar-badge" style="border-color:rgba(13,148,136,0.4); color:#99f6e4; background:rgba(13,148,136,0.15);">Lotes</span>
            </a>

            <div class="sidebar-nav-title">Accesos Directos</div>

            <a href="crear-presupuesto-movil.html" class="sidebar-item ${isCotizador ? 'active-module' : ''}">
                <span class="sidebar-icon">➕</span>
                <span>Nueva Cotización</span>
            </a>

            <a href="crear-cliente-movil.html" class="sidebar-item ${isCrearCliente ? 'active-module' : ''}">
                <span class="sidebar-icon">➕</span>
                <span>Alta de Cliente</span>
            </a>

            <a href="#" onclick="window.cerrarSidebar(); if (typeof window.abrirAsistenteInmunizacionChofer === 'function') { window.abrirAsistenteInmunizacionChofer(); } else { window.location.href = 'ruta.html'; }" class="sidebar-item">
                <span class="sidebar-icon">🦠</span>
                <span>Registro de Tratamiento</span>
            </a>

            ${(() => {
                const isLab = Boolean(window.__LAMDA_IS_LABORATORIO__) || Boolean(window.__LAMDA_ENV_STATUS__ && window.__LAMDA_ENV_STATUS__.isLaboratorio);
                const iconSrc = isLab ? '/mobile/icon-lab-192.png' : '/mobile/icon-192.png';
                const labelTxt = isLab ? 'Instalar "LAMDA Móvil Lab"' : 'Instalar "LAMDA Móvil"';
                return `
            <a href="#" onclick="window.cerrarSidebar(); if (typeof window.instalarAccesoDirecto === 'function') { window.instalarAccesoDirecto(); }" class="sidebar-item" style="background: rgba(124, 58, 237, 0.16); border: 1px solid rgba(167, 139, 250, 0.4); color: #f8fafc; margin-top: 4px;">
                <span class="sidebar-icon" style="display:inline-flex;align-items:center;justify-content:center;"><img src="${iconSrc}" alt="${labelTxt}" style="width:20px;height:20px;border-radius:5px;"></span>
                <span style="font-weight: 800;">${labelTxt}</span>
                <span class="sidebar-badge" style="border-color: rgba(167, 139, 250, 0.5); color: #ddd6fe; background: rgba(109, 40, 217, 0.35);">App</span>
            </a>
            <a href="/gw/3000/?desktop=1" class="sidebar-item" style="color: #cbd5e1; margin-top: 2px;">
                <span class="sidebar-icon">🖥️</span>
                <span>Ir a Pantalla Principal (PC)</span>
            </a>`;
            })()}
        </div>
        <div class="sidebar-footer">
            <button class="sidebar-logout" onclick="cerrarSesion()">
                <span>🚪</span> Cerrar Sesión
            </button>
        </div>
    `;

    // Cerrar al pulsar Escape
    if (!window._sidebarEscBound) {
        window._sidebarEscBound = true;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.cerrarSidebar();
        });
    }
};

window.abrirSidebar = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();

    let sidebar = document.getElementById('sidebar-menu');
    let overlay = document.getElementById('sidebar-overlay');

    if (!sidebar || !overlay) {
        window.inicializarSidebarUniversal();
        sidebar = document.getElementById('sidebar-menu');
        overlay = document.getElementById('sidebar-overlay');
    }

    if (sidebar && overlay) {
        sidebar.classList.add('active');
        overlay.classList.add('active');
        sidebar.style.transform = 'translateX(0)';
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        document.body.style.overflow = 'hidden';
    }
};

window.cerrarSidebar = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) {
        sidebar.classList.remove('active');
        sidebar.style.transform = '';
    }
    if (overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '';
        overlay.style.pointerEvents = '';
    }
    document.body.style.overflow = '';
};

// Captura global del prompt de instalación PWA en todas las pantallas móviles
window.__deferredMobilePwaPrompt = window.__deferredMobilePwaPrompt || null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__deferredMobilePwaPrompt = e;
});

window.instalarAccesoDirecto = async function() {
    const promptEv = window.__deferredMobilePwaPrompt || window.__LAMDA_DEFERRED_PWA_PROMPT__ || null;
    if (promptEv) {
        window.__deferredMobilePwaPrompt = null;
        window.__LAMDA_DEFERRED_PWA_PROMPT__ = null;
        promptEv.prompt();
        try {
            await promptEv.userChoice;
        } catch (_) {}
        return;
    }

    const isLab = Boolean(window.__LAMDA_IS_LABORATORIO__) || Boolean(window.__LAMDA_ENV_STATUS__ && window.__LAMDA_ENV_STATUS__.isLaboratorio);
    const appTitle = isLab ? 'LAMDA Móvil Lab' : 'LAMDA Móvil';
    const iconUrl = isLab ? '/mobile/icon-lab-192.png' : '/mobile/icon-192.png';
    const preferMobileActive = localStorage.getItem('lamda_prefer_mobile_home') === '1';
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    const scheme = window.location.protocol.replace(':', '');
    const chromeIntentUrl = 'intent://' + window.location.host + '/mobile/home.html?install=1#Intent;scheme=' + scheme + ';package=com.android.chrome;end';

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: '📲 Acceso Directo "' + appTitle + '"',
            html:
                '<div style="text-align: left; font-size: 0.91rem; line-height: 1.5; color: #e2e8f0;">' +
                    '<div style="display: flex; align-items: center; gap: 12px; background: rgba(15, 23, 42, 0.75); border: 1px solid #8b5cf6; border-radius: 12px; padding: 10px 12px; margin-bottom: 0.9rem;">' +
                        '<img src="' + iconUrl + '" alt="' + appTitle + '" style="width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;">' +
                        '<div>' +
                            '<div style="font-weight: 800; color: #f8fafc; font-size: 0.98rem;">' + appTitle + '</div>' +
                            '<div style="font-size: 0.76rem; color: #cbd5e1;">' + (isLab ? 'Ícono en escala de grises (Laboratorio)' : 'Ícono oficial a color de Producción') + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 12px; margin-bottom: 0.85rem;">' +
                        '<div style="font-weight: 800; color: #6ee7b7; margin-bottom: 4px;">⚡ Opción 1 (Inmediata — 1 toque):</div>' +
                        '<div style="font-size: 0.84rem; color: #e2e8f0; margin-bottom: 8px;">Si ya tenés el ícono de <b>LAMDA</b> en tu pantalla, activá este botón para que en este celular <b>abra siempre directo en LAMDA Móvil</b>:</div>' +
                        '<button type="button" id="swal-btn-prefer-mobile" style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid ' + (preferMobileActive ? '#10b981' : '#34d399') + '; background: ' + (preferMobileActive ? '#065f46' : '#059669') + '; color: #ffffff; font-weight: 800; font-size: 0.85rem; cursor: pointer;">' +
                            (preferMobileActive ? '✅ Activado: este celular inicia directo en LAMDA Móvil' : '📌 Iniciar siempre en LAMDA Móvil en este celular') +
                        '</button>' +
                    '</div>' +
                    (isAndroid ? (
                        '<div style="background: rgba(124, 58, 237, 0.14); border: 1px solid rgba(167, 139, 250, 0.4); border-radius: 12px; padding: 12px;">' +
                            '<div style="font-weight: 800; color: #ddd6fe; margin-bottom: 4px;">📲 Opción 2 (Crear ícono en pantalla de Android):</div>' +
                            '<div style="font-size: 0.83rem; color: #cbd5e1; margin-bottom: 8px;">Si estás en pantalla completa y no se ven los 3 puntitos de Chrome, tocá abajo para abrir esta pantalla en Chrome con barra superior y elegir <b>⋮ → Agregar a pantalla principal</b>:</div>' +
                            '<a href="' + chromeIntentUrl + '" style="display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 10px 12px; border-radius: 8px; background: #6d28d9; color: #ffffff; font-weight: 800; font-size: 0.85rem; text-decoration: none;">🌐 Abrir en Chrome con Barra Superior</a>' +
                        '</div>'
                    ) : '') +
                '</div>',
            background: '#1e293b',
            color: '#f8fafc',
            showConfirmButton: true,
            confirmButtonText: 'Listo',
            confirmButtonColor: '#475569',
            didOpen: () => {
                const btnPref = document.getElementById('swal-btn-prefer-mobile');
                if (btnPref) {
                    btnPref.onclick = () => {
                        const cur = localStorage.getItem('lamda_prefer_mobile_home') === '1';
                        if (cur) {
                            localStorage.removeItem('lamda_prefer_mobile_home');
                            btnPref.style.background = '#059669';
                            btnPref.textContent = '📌 Iniciar siempre en LAMDA Móvil en este celular';
                        } else {
                            localStorage.setItem('lamda_prefer_mobile_home', '1');
                            btnPref.style.background = '#065f46';
                            btnPref.textContent = '✅ Activado: este celular inicia directo en LAMDA Móvil';
                            Swal.fire({
                                toast: true,
                                position: 'top',
                                icon: 'success',
                                title: '¡Listo! En este celular abrirá siempre LAMDA Móvil',
                                showConfirmButton: false,
                                timer: 2400,
                                background: '#0f172a',
                                color: '#fff'
                            });
                        }
                    };
                }
            }
        });
    }
};

// Auto-inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.inicializarSidebarUniversal());
} else {
    window.inicializarSidebarUniversal();
}


