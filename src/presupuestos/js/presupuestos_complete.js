/**
 * MÓDULO DE PRESUPUESTOS - FRONTEND COMPLETO
 * Gestiones Lamda - v2.0 con Google Sheets
 * 
 * Maneja la lógica del frontend para el módulo de presupuestos
 */

console.log('🔍 [PRESUPUESTOS-JS] Inicializando módulo frontend completo...');

// Configuración global
const CONFIG = {
    API_BASE_URL: '/api/presupuestos',
    MESSAGES_TIMEOUT: 5000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
};

// Estado global de la aplicación
let appState = {
    presupuestos: [],
    categorias: [],
    estadisticas: null,
    filtros: {
        categoria: '',
        concepto: ''
    },
    loading: false,
    syncInProgress: false,
    authStatus: null
};

/**
 * Inicialización de la aplicación
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 [PRESUPUESTOS-JS] DOM cargado, inicializando aplicación...');
    
    initializeApp();
    setupEventListeners();
    checkModuleHealth();
    checkAuthStatus();
});

/**
 * Inicializar la aplicación
 */
function initializeApp() {
    console.log('🔍 [PRESUPUESTOS-JS] Configurando aplicación...');
    
    // Actualizar indicador de estado
    updateStatusIndicator('loading', 'Inicializando módulo...');
    
    // Cargar estadísticas iniciales
    loadEstadisticas();
    
    console.log('✅ [PRESUPUESTOS-JS] Aplicación inicializada');
}

/**
 * Configurar event listeners
 */
function setupEventListeners() {
    console.log('🔍 [PRESUPUESTOS-JS] Configurando event listeners...');
    
    // Botones principales
    const btnCargarDatos = document.getElementById('btn-cargar-datos');
    const btnSincronizar = document.getElementById('btn-sincronizar');
    const btnConfiguracion = document.getElementById('btn-configuracion');
    
    if (btnCargarDatos) {
        btnCargarDatos.addEventListener('click', handleCargarDatos);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: btn-cargar-datos');
    }
    
    if (btnSincronizar) {
        btnSincronizar.addEventListener('click', handleSincronizar);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: btn-sincronizar');
    }
    
    if (btnConfiguracion) {
        btnConfiguracion.addEventListener('click', handleConfiguracion);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: btn-configuracion');
    }
    
    // Filtros
    const filtroCategoria = document.getElementById('filtro-categoria');
    const buscarConcepto = document.getElementById('buscar-concepto');
    
    if (filtroCategoria) {
        filtroCategoria.addEventListener('change', handleFiltroCategoria);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: filtro-categoria');
    }
    
    if (buscarConcepto) {
        buscarConcepto.addEventListener('input', debounce(handleBuscarConcepto, 300));
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: buscar-concepto');
    }
    
    console.log('✅ [PRESUPUESTOS-JS] Event listeners configurados');
}

/**
 * Verificar salud del módulo
 */
async function checkModuleHealth() {
    console.log('🔍 [PRESUPUESTOS-JS] Verificando salud del módulo...');
    
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/health`);
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ [PRESUPUESTOS-JS] Módulo funcionando correctamente');
            updateStatusIndicator('active', 'Módulo activo y funcionando');
        } else {
            throw new Error('Health check falló');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error en health check:', error);
        updateStatusIndicator('error', 'Error de conexión con el módulo');
        showMessage('Error de conexión con el servidor', 'error');
    }
}

/**
 * Verificar estado de autenticación con Google
 */
async function checkAuthStatus() {
    console.log('🔍 [PRESUPUESTOS-JS] Verificando estado de autenticación...');
    
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/sync/auth/status`);
        const data = await response.json();
        
        appState.authStatus = data;
        updateSyncButtonState(data);
        
        console.log('✅ [PRESUPUESTOS-JS] Estado de autenticación verificado:', data);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al verificar autenticación:', error);
        updateSyncButtonState({ authenticated: false, error: true });
    }
}

/**
 * Actualizar estado del botón de sincronización
 */
function updateSyncButtonState(authStatus) {
    const btnSincronizar = document.getElementById('btn-sincronizar');
    if (!btnSincronizar) return;
    
    if (authStatus.error) {
        btnSincronizar.textContent = '❌ Error de conexión';
        btnSincronizar.disabled = true;
        btnSincronizar.className = 'btn btn-secondary';
    } else if (authStatus.authenticated) {
        btnSincronizar.textContent = '🔄 Sincronizar Google Sheets';
        btnSincronizar.disabled = false;
        btnSincronizar.className = 'btn btn-primary';
    } else {
        btnSincronizar.textContent = '🔐 Autorizar Google Sheets';
        btnSincronizar.disabled = false;
        btnSincronizar.className = 'btn btn-warning';
    }
}

/**
 * Cargar estadísticas
 */
async function loadEstadisticas() {
    console.log('🔍 [PRESUPUESTOS-JS] Cargando estadísticas...');
    
    try {
        const response = await fetchWithRetry(`${CONFIG.API_BASE_URL}/estadisticas`);
        const data = await response.json();
        
        if (data.success) {
            appState.estadisticas = data.estadisticas;
            updateStatsDisplay(data.estadisticas);
            console.log('✅ [PRESUPUESTOS-JS] Estadísticas cargadas:', data.estadisticas);
        } else {
            throw new Error(data.message || 'Error al cargar estadísticas');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al cargar estadísticas:', error);
        showMessage('Error al cargar estadísticas', 'error');
    }
}

/**
 * Actualizar display de estadísticas
 */
function updateStatsDisplay(stats) {
    console.log('🔍 [PRESUPUESTOS-JS] Actualizando display de estadísticas...');
    
    const elements = {
        'total-registros': stats.total_registros || 0,
        'total-categorias': stats.total_categorias || 0,
        'monto-total': `$${formatNumber(stats.monto_total || 0)}`,
        'ultima-sync': stats.ultima_sincronizacion ? 
            formatDate(stats.ultima_sincronizacion) : 'Nunca'
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
            element.classList.add('fade-in');
        }
    });
    
    console.log('✅ [PRESUPUESTOS-JS] Display de estadísticas actualizado');
}

/**
 * Handler: Cargar datos
 */
async function handleCargarDatos() {
    console.log('🔍 [PRESUPUESTOS-JS] Iniciando carga de datos...');
    
    if (appState.loading) {
        console.log('⚠️ [PRESUPUESTOS-JS] Ya hay una operación en curso');
        return;
    }
    
    setLoading(true);
    
    try {
        const response = await fetchWithRetry(`${CONFIG.API_BASE_URL}/`);
        const data = await response.json();
        
        if (data.success) {
            appState.presupuestos = data.data;
            appState.categorias = data.categorias || [];
            
            updatePresupuestosTable(data.data);
            updateCategoriasFilter(data.categorias);
            loadEstadisticas(); // Actualizar estadísticas
            
            showMessage(`Datos cargados: ${data.total} registros`, 'success');
            console.log(`✅ [PRESUPUESTOS-JS] Datos cargados: ${data.total} registros`);
        } else {
            throw new Error(data.message || 'Error al cargar datos');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al cargar datos:', error);
        showMessage('Error al cargar los datos', 'error');
    } finally {
        setLoading(false);
    }
}

/**
 * Handler: Sincronizar con Google Sheets
 */
async function handleSincronizar() {
    console.log('🔍 [PRESUPUESTOS-JS] Iniciando proceso de sincronización...');
    
    if (appState.syncInProgress) {
        console.log('⚠️ [PRESUPUESTOS-JS] Sincronización ya en progreso');
        return;
    }
    
    // Verificar si necesita autenticación
    if (!appState.authStatus || !appState.authStatus.authenticated) {
        await handleGoogleAuth();
        return;
    }
    
    // Ejecutar sincronización
    await executeSyncronization();
}

/**
 * Manejar autenticación con Google
 */
async function handleGoogleAuth() {
    console.log('🔍 [PRESUPUESTOS-JS] Iniciando autenticación con Google...');
    
    try {
        setSyncLoading(true, 'Iniciando autenticación...');
        
        // Solicitar URL de autorización
        const response = await fetch(`${CONFIG.API_BASE_URL}/sync/auth/iniciar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success && data.authUrl) {
            // Mostrar modal con URL de autorización
            showAuthModal(data.authUrl);
        } else {
            throw new Error(data.message || 'Error al obtener URL de autorización');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error en autenticación:', error);
        showMessage('Error al iniciar autenticación con Google', 'error');
    } finally {
        setSyncLoading(false);
    }
}

/**
 * Mostrar modal de autorización
 */
function showAuthModal(authUrl) {
    console.log('🔍 [PRESUPUESTOS-JS] Mostrando modal de autorización...');
    
    const modal = document.createElement('div');
    modal.className = 'auth-modal';
    modal.innerHTML = `
        <div class="auth-modal-content">
            <div class="auth-modal-header">
                <h3>🔐 Autorización de Google Sheets</h3>
                <button class="auth-modal-close" onclick="this.closest('.auth-modal').remove()">&times;</button>
            </div>
            <div class="auth-modal-body">
                <p><strong>Paso 1:</strong> Haga clic en el siguiente enlace para autorizar el acceso:</p>
                <a href="${authUrl}" target="_blank" class="auth-link">
                    🔗 Autorizar acceso a Google Sheets
                </a>
                <p><strong>Paso 2:</strong> Copie el código de autorización y péguelo aquí:</p>
                <input type="text" id="auth-code" placeholder="Pegue el código aquí..." class="auth-input">
                <div class="auth-modal-actions">
                    <button onclick="this.closest('.auth-modal').remove()" class="btn btn-secondary">Cancelar</button>
                    <button onclick="completeAuth()" class="btn btn-primary">Completar Autorización</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus en el input
    setTimeout(() => {
        const input = document.getElementById('auth-code');
        if (input) input.focus();
    }, 100);
}

/**
 * Completar autorización
 */
async function completeAuth() {
    const authCode = document.getElementById('auth-code')?.value?.trim();
    
    if (!authCode) {
        showMessage('Por favor ingrese el código de autorización', 'warning');
        return;
    }
    
    console.log('🔍 [PRESUPUESTOS-JS] Completando autorización...');
    
    try {
        setSyncLoading(true, 'Completando autorización...');
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/sync/auth/completar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: authCode })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Cerrar modal
            document.querySelector('.auth-modal')?.remove();
            
            // Actualizar estado de autenticación
            appState.authStatus = { authenticated: true };
            updateSyncButtonState(appState.authStatus);
            
            showMessage('Autorización completada exitosamente', 'success');
            console.log('✅ [PRESUPUESTOS-JS] Autorización completada');
            
            // Ejecutar sincronización automáticamente
            setTimeout(() => executeSyncronization(), 1000);
        } else {
            throw new Error(data.message || 'Error al completar autorización');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al completar autorización:', error);
        showMessage('Error al completar la autorización', 'error');
    } finally {
        setSyncLoading(false);
    }
}

/**
 * Ejecutar sincronización
 */
async function executeSyncronization() {
    console.log('🔍 [PRESUPUESTOS-JS] Ejecutando sincronización...');
    
    try {
        setSyncLoading(true, 'Sincronizando con Google Sheets...');
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/sync/ejecutar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage(`Sincronización exitosa: ${data.registros_procesados} registros`, 'success');
            console.log('✅ [PRESUPUESTOS-JS] Sincronización completada:', data);
            
            // Recargar datos y estadísticas
            await loadEstadisticas();
            await handleCargarDatos();
        } else {
            throw new Error(data.message || 'Error en la sincronización');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error en sincronización:', error);
        showMessage('Error durante la sincronización', 'error');
    } finally {
        setSyncLoading(false);
    }
}

/**
 * Controlar estado de loading de sincronización
 */
function setSyncLoading(loading, message = '') {
    appState.syncInProgress = loading;
    
    const btnSincronizar = document.getElementById('btn-sincronizar');
    if (btnSincronizar) {
        btnSincronizar.disabled = loading;
        if (loading) {
            btnSincronizar.textContent = `⏳ ${message}`;
            btnSincronizar.className = 'btn btn-secondary';
        } else {
            updateSyncButtonState(appState.authStatus);
        }
    }
    
    console.log(`🔍 [PRESUPUESTOS-JS] Sync loading state: ${loading} - ${message}`);
}

/**
 * Handler: Configuración
 */
function handleConfiguracion() {
    console.log('🔍 [PRESUPUESTOS-JS] Abriendo configuración...');
    
    showMessage('Panel de configuración en desarrollo', 'info');
}

/**
 * Handler: Filtro por categoría
 */
function handleFiltroCategoria(event) {
    const categoria = event.target.value;
    console.log(`🔍 [PRESUPUESTOS-JS] Filtrando por categoría: ${categoria || 'todas'}`);
    
    appState.filtros.categoria = categoria;
    applyFilters();
}

/**
 * Handler: Buscar concepto
 */
function handleBuscarConcepto(event) {
    const concepto = event.target.value;
    console.log(`🔍 [PRESUPUESTOS-JS] Buscando concepto: ${concepto}`);
    
    appState.filtros.concepto = concepto;
    applyFilters();
}

/**
 * Aplicar filtros
 */
function applyFilters() {
    console.log('🔍 [PRESUPUESTOS-JS] Aplicando filtros:', appState.filtros);
    
    let filteredData = [...appState.presupuestos];
    
    // Filtro por categoría
    if (appState.filtros.categoria) {
        filteredData = filteredData.filter(item => 
            item.categoria && item.categoria.toLowerCase() === appState.filtros.categoria.toLowerCase()
        );
    }
    
    // Filtro por concepto
    if (appState.filtros.concepto) {
        const searchTerm = appState.filtros.concepto.toLowerCase();
        filteredData = filteredData.filter(item =>
            item.concepto && item.concepto.toLowerCase().includes(searchTerm)
        );
    }
    
    updatePresupuestosTable(filteredData);
    console.log(`✅ [PRESUPUESTOS-JS] Filtros aplicados: ${filteredData.length} registros mostrados`);
}

/**
 * Actualizar tabla de presupuestos
 */
function updatePresupuestosTable(data) {
    console.log(`🔍 [PRESUPUESTOS-JS] Actualizando tabla con ${data.length} registros...`);
    
    const tbody = document.getElementById('tbody-presupuestos');
    if (!tbody) {
        console.error('❌ [PRESUPUESTOS-JS] No se encontró tbody-presupuestos');
        return;
    }
    
    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="no-data">
                    ${appState.presupuestos.length === 0 ? 
                        'Haga clic en "Cargar Presupuestos" para ver los datos' : 
                        'No se encontraron registros con los filtros aplicados'}
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = data.map(item => `
        <tr class="slide-up">
            <td>${escapeHtml(item.categoria || 'Sin categoría')}</td>
            <td>${escapeHtml(item.concepto || 'Sin concepto')}</td>
            <td class="text-right">$${formatNumber(item.monto || 0)}</td>
            <td>${formatDate(item.fecha_registro)}</td>
            <td>${formatDate(item.fecha_sincronizacion)}</td>
        </tr>
    `).join('');
    
    console.log('✅ [PRESUPUESTOS-JS] Tabla actualizada');
}

/**
 * Actualizar filtro de categorías
 */
function updateCategoriasFilter(categorias) {
    // Validar que categorias sea un array
    if (!Array.isArray(categorias)) {
        console.log('⚠️ [PRESUPUESTOS-JS] Categorías no es un array válido:', categorias);
        categorias = []; // Usar array vacío como fallback
    }
    
    console.log(`🔍 [PRESUPUESTOS-JS] Actualizando filtro de categorías: ${categorias.length} categorías`);
    
    const select = document.getElementById('filtro-categoria');
    if (!select) {
        console.log('⚠️ [PRESUPUESTOS-JS] No se encontró elemento filtro-categoria');
        return;
    }
    
    // Limpiar opciones existentes (excepto la primera)
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }
    
    // Agregar nuevas opciones
    categorias.forEach(categoria => {
        if (categoria) {
            const option = document.createElement('option');
            option.value = categoria;
            option.textContent = categoria;
            select.appendChild(option);
        }
    });
    
    console.log('✅ [PRESUPUESTOS-JS] Filtro de categorías actualizado');
}

/**
 * Actualizar indicador de estado
 */
function updateStatusIndicator(status, message) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    
    if (indicator && text) {
        indicator.className = `status-indicator ${status}`;
        text.textContent = message;
        
        console.log(`🔍 [PRESUPUESTOS-JS] Estado actualizado: ${status} - ${message}`);
    }
}

/**
 * Controlar estado de loading
 */
function setLoading(loading) {
    appState.loading = loading;
    
    const loadingIndicator = document.getElementById('loading-indicator');
    const btnCargarDatos = document.getElementById('btn-cargar-datos');
    
    if (loadingIndicator) {
        loadingIndicator.style.display = loading ? 'flex' : 'none';
    }
    
    if (btnCargarDatos) {
        btnCargarDatos.disabled = loading;
        btnCargarDatos.textContent = loading ? '⏳ Cargando...' : '📊 Cargar Presupuestos';
    }
    
    console.log(`🔍 [PRESUPUESTOS-JS] Loading state: ${loading}`);
}

/**
 * Mostrar mensaje al usuario
 */
function showMessage(message, type = 'info') {
    console.log(`🔍 [PRESUPUESTOS-JS] Mostrando mensaje: ${type} - ${message}`);
    
    const container = document.getElementById('message-container');
    if (!container) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `
        ${escapeHtml(message)}
        <button class="message-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    container.appendChild(messageDiv);
    
    // Auto-remove después del timeout
    setTimeout(() => {
        if (messageDiv.parentElement) {
            messageDiv.remove();
        }
    }, CONFIG.MESSAGES_TIMEOUT);
}

/**
 * Fetch con reintentos
 */
async function fetchWithRetry(url, options = {}, attempts = CONFIG.RETRY_ATTEMPTS) {
    console.log(`🔍 [PRESUPUESTOS-JS] Fetch: ${url} (intentos restantes: ${attempts})`);
    
    try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
    } catch (error) {
        if (attempts > 1) {
            console.log(`⚠️ [PRESUPUESTOS-JS] Reintentando en ${CONFIG.RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return fetchWithRetry(url, options, attempts - 1);
        }
        throw error;
    }
}

/**
 * Utilidades
 */

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Formatear números
function formatNumber(num) {
    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

// Formatear fechas
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al formatear fecha:', error);
        return 'Fecha inválida';
    }
}

// Escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

console.log('✅ [PRESUPUESTOS-JS] Módulo frontend completo cargado');
