/**
 * MÓDULO DE PRESUPUESTOS - FRONTEND COMPLETO
 * Gestiones Lamda - v2.0 con Google Sheets
 * 
 * Maneja la lógica del frontend para el módulo de presupuestos
 */

console.log('🔍 [PRESUPUESTOS-JS] Inicializando módulo frontend completo...');

// Autocarga inicial de la grilla al abrir la pantalla
const AUTOLOAD_ON_START = true;
function autoCargarAlAbrir() {
    if (window.__presupuestosAutocargados) return;
    window.__presupuestosAutocargados = true;
    console.log('[PRESUPUESTOS-JS] Autocarga inicial → cargando datos con filtros restaurados');
    // Pequeño defer para asegurar que los listeners ya están bindeados
    // Si hay filtros guardados, cargar con maintainFilters=true para aplicarlos
    const hayFiltrosGuardados = sessionStorage.getItem('presupuestos_filtros_activos');
    setTimeout(() => {
        handleCargarDatos(1, hayFiltrosGuardados ? true : false);
    }, 100);
}

// Configuración global
const CONFIG = {
    API_BASE_URL: '/api/presupuestos',
    MESSAGES_TIMEOUT: 5000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000
};

// ===== ENDPOINTS SEGUROS (NO TOCAR ORDEN) =====
try { window.CONFIG = window.CONFIG || {}; } catch (_) { /* ignore en no-browser */ }

const API_BASE = (
    (typeof window !== 'undefined' &&
        window.CONFIG &&
        typeof window.CONFIG.API_BASE_URL === 'string' &&
        window.CONFIG.API_BASE_URL.trim())
        ? window.CONFIG.API_BASE_URL
        : (typeof CONFIG !== 'undefined' &&
            typeof CONFIG.API_BASE_URL === 'string' &&
            CONFIG.API_BASE_URL.trim()
            ? CONFIG.API_BASE_URL
            : '/api/presupuestos')
).replace(/\/+$/, '');

const URLS = {
    HEALTH: API_BASE + '/health',
    AUTH_STATUS: API_BASE + '/sync/auth/status',
    ESTADISTICAS: API_BASE + '/estadisticas',
    ESTADOS: API_BASE + '/estados',
    CORREGIR_FECHAS: API_BASE + '/sync/corregir-fechas',
    PUSH_ALTAS: API_BASE + '/sync/push-altas',
    SYNC_BIDIRECCIONAL: API_BASE + '/sync/bidireccional-safe',  // NUEVO: endpoint tolerante a cuotas
    LIST: (qs) => API_BASE + '/?' + (qs || ''),
    DETALLES: (id) => API_BASE + '/' + id + '/detalles',
    PRESUPUESTO: (id) => API_BASE + '/' + id,
    CLIENTES_SUG: (q) => API_BASE + '/clientes/sugerencias?q=' + encodeURIComponent(q || '')
};

console.log('[PRESUPUESTOS-JS] API_BASE →', API_BASE);
console.log('[PRESUPUESTOS-JS] URL corregir-fechas →', URLS.CORREGIR_FECHAS);



// Estado global de la aplicación - Orden por fecha DESC + paginación + Estado – 2024-12-19
// Estado global de la aplicación
const PRESET_FILTROS_EMPTY = {
    categoria: '',
    concepto: '',
    clienteId: '',
    clienteName: '',
    estado: []
};

let appState = {
    presupuestos: [],
    categorias: [],
    estados: [],
    estadisticas: null,

    // Estado de Tabs
    activeTab: 'ventas', // 'ventas' | 'retiros'

    // Filtros activos (se sobrescriben al cambiar de tab)
    filtros: { ...PRESET_FILTROS_EMPTY },

    // Persistencia de filtros por tab
    tabStates: {
        ventas: {
            filtros: { ...PRESET_FILTROS_EMPTY }
        },
        retiros: {
            filtros: { ...PRESET_FILTROS_EMPTY }
        }
    },

    pagination: {
        currentPage: 1,
        pageSize: 100,
        totalPages: 0,
        totalRecords: 0,
        hasNext: false,
        hasPrev: false
    },
    sorting: {
        sortBy: 'fecha',
        order: 'desc'
    },
    loading: false,
    syncInProgress: false,
    authStatus: null,
    autoUpdatePolling: {
        intervalId: null,
        isActive: false,
        lastSyncTimestamp: null,
        pollIntervalSeconds: 30
    }
};

/**
 * Inicialización de la aplicación
 */
// Exponer función switchTab globalmente
window.switchTab = switchTab;

document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 [PRESUPUESTOS-JS] DOM cargado, inicializando aplicación...');

    initializeApp();
    setupEventListeners();
    checkModuleHealth();
    checkAuthStatus();
    loadEstados();
});

/**
 * Cambiar de solapa (Ventas <-> Retiros)
 */
function switchTab(tabName) {
    if (appState.activeTab === tabName) return;

    console.log(`🔄 [TABS] Cambiando a solapa: ${tabName}`);

    // 1. Guardar estado actual
    appState.tabStates[appState.activeTab].filtros = { ...appState.filtros };

    // 2. Cambiar tab activo
    appState.activeTab = tabName;

    // 3. Restaurar estado del nuevo tab
    appState.filtros = { ...appState.tabStates[tabName].filtros };

    // 4. Actualizar UI de tabs
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.id === `tab-${tabName}`) {
            btn.classList.add('active');
        }
    });

    // 5. Actualizar UI de filtros (restaurar inputs visuales)
    // Nota: Esto requiere refactorizar restoreFilterControls para que use appState.filtros
    restoreFilterControls({ ...appState.filtros, buscarClienteText: appState.filtros.clienteName }); // Helper rápido

    // Regenerar botones de estado según contexto
    updateEstadosFilter(appState.estados);

    // 6. Recargar datos
    handleCargarDatos(1);

    // 7. Guardar preferencia en sessionStorage (opcional, para persistir tab)
    sessionStorage.setItem('active_tab_presupuestos', tabName);
}

/**
 * Inicializar la aplicación
 */
function initializeApp() {
    console.log('🔍 [PRESUPUESTOS-JS] Configurando aplicación...');

    // Restaurar tab activo
    const savedTab = sessionStorage.getItem('active_tab_presupuestos');
    if (savedTab && ['ventas', 'retiros'].includes(savedTab)) {
        appState.activeTab = savedTab;
        console.log(`📑 [TABS] Tab restaurado: ${savedTab}`);
    }

    // Actualizar UI de tabs inicial
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.id === `tab-${appState.activeTab}`) {
            btn.classList.add('active');
        }
    });

    // Actualizar indicador de estado
    updateStatusIndicator('loading', 'Inicializando módulo...');

    // Restaurar filtros guardados si existen
    restoreFiltersFromStorage();

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
    const btnNuevoPresupuesto = document.getElementById('btn-nuevo-presupuesto');

    if (btnCargarDatos) {
        btnCargarDatos.addEventListener('click', () => handleCargarDatos(1));
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: btn-cargar-datos');
    }

    if (btnSincronizar) {
        btnSincronizar.addEventListener('click', handleSincronizar);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: btn-sincronizar');
    }

    if (btnNuevoPresupuesto) {
        btnNuevoPresupuesto.addEventListener('click', handleNuevoPresupuesto);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: btn-nuevo-presupuesto');
    }

    // Configuración: usar el modal de sync_config_modal.js
    if (btnConfiguracion) {
        // El event listener se bindea en bindSyncConfigUI() del modal
        console.log('✅ [PRESUPUESTOS-JS] Botón configuración encontrado - será bindeado por sync_config_modal.js');
    }

    // Bindear eventos del modal de configuración
    if (typeof bindSyncConfigUI === 'function') {
        bindSyncConfigUI();
        console.log('✅ [PRESUPUESTOS-JS] Modal de configuración bindeado');
    } else {
        console.log('⚠️ [PRESUPUESTOS-JS] bindSyncConfigUI no disponible - modal no bindeado');
    }

    // Filtros
    const filtroCategoria = document.getElementById('filtro-categoria');
    const buscarCliente = document.getElementById('buscar-cliente');

    if (filtroCategoria) {
        filtroCategoria.addEventListener('change', handleFiltroCategoria);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: filtro-categoria');
    }

    if (buscarCliente) {
        buscarCliente.addEventListener('input', debounce(handleBuscarCliente, 300));
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: buscar-cliente');
    }

    // Los botones de estado se crean dinámicamente en updateEstadosFilter()
    console.log('✅ [PRESUPUESTOS-JS] Botones de estado se configurarán dinámicamente');

    console.log('✅ [PRESUPUESTOS-JS] Event listeners configurados');
    if (AUTOLOAD_ON_START) autoCargarAlAbrir();
}

/**
 * Verificar salud del módulo
 */
async function checkModuleHealth() {
    console.log('🔍 [PRESUPUESTOS-JS] Verificando salud del módulo...');

    try {
        const response = await fetch(URLS.HEALTH);
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
        const response = await fetch(URLS.AUTH_STATUS);
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
        btnSincronizar.textContent = '🔄 SINCRONIZAR CON SHEET';
        btnSincronizar.disabled = false;
        btnSincronizar.className = 'btn-warning btn-sync';
    } else {
        btnSincronizar.textContent = '🔄 SINCRONIZAR CON SHEET';
        btnSincronizar.disabled = false;
        btnSincronizar.className = 'btn-warning btn-sync';
    }
}

/**
 * Cargar estadísticas
 */
async function loadEstadisticas() {
    console.log('🔍 [PRESUPUESTOS-JS] Cargando estadísticas...');

    try {
        const response = await fetchWithRetry(URLS.ESTADISTICAS);
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
 * Cargar estados distintos - Filtro por Estado – 2024-12-19
 */
async function loadEstados() {
    console.log('🔍 [PRESUPUESTOS-JS] Cargando estados distintos...');

    try {
        const response = await fetchWithRetry(URLS.ESTADOS);
        const data = await response.json();

        if (data.success) {
            appState.estados = data.estados || [];
            updateEstadosFilter(appState.estados);
            console.log(`✅ [PRESUPUESTOS-JS] Estados cargados: ${appState.estados.length} estados`);
            console.log('🔍 [PRESUPUESTOS-JS] Actualizando filtro de estados:', appState.estados.length, 'estados');
        } else {
            throw new Error(data.message || 'Error al cargar estados');
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al cargar estados:', error);
        // No mostrar mensaje de error para no molestar al usuario
        appState.estados = [];
        updateEstadosFilter([]);
    }
}

/**
 * Actualizar display de estadísticas (línea compacta)
 */
function updateStatsDisplay(stats) {
    console.log('🔍 [PRESUPUESTOS-JS] Actualizando display de estadísticas...');
    console.log('[PRESUP/KPIS] stats=', stats);

    // Solo actualizar los dos valores que se muestran en la línea compacta
    const elements = {
        'total-registros': stats.total_registros || 0,
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

    console.log('✅ [PRESUPUESTOS-JS] Display de estadísticas actualizado (línea compacta)');
}

/**
 * Handler: Cargar datos con paginación - Orden por fecha DESC + paginación – 2024-12-19
 */
async function handleCargarDatos(page = 1, maintainFilters = false) {
    console.log(`🔍 [PRESUPUESTOS-JS] Iniciando carga de datos - Página: ${page}...`);

    // Si vino por autocarga, permitimos que el usuario vuelva a recargar manualmente
    window.__presupuestosAutocargados = false;

    if (appState.loading) {
        console.log('⚠️ [PRESUPUESTOS-JS] Ya hay una operación en curso');
        return;
    }

    setLoading(true);

    try {
        // Construir parámetros de consulta con paginación y ordenamiento
        const queryParams = new URLSearchParams({
            page: page,
            pageSize: appState.pagination.pageSize,
            sortBy: appState.sorting.sortBy,
            order: appState.sorting.order
        });

        // Agregar filtros si están activos y se deben mantener
        if (maintainFilters || page > 1) {
            if (appState.filtros.categoria) {
                queryParams.append('categoria', appState.filtros.categoria);
            }
            if (appState.filtros.clienteId) {
                queryParams.append('clienteId', appState.filtros.clienteId);
            } else if (appState.filtros.clienteName) {
                queryParams.append('clienteName', appState.filtros.clienteName);
            } else if (appState.filtros.concepto) {
                queryParams.append('concepto', appState.filtros.concepto);
            }
            // Agregar filtro por estado - Filtro por Estado – 2024-12-19
            if (appState.filtros.estado && appState.filtros.estado.length > 0) {
                appState.filtros.estado.forEach(estado => {
                    queryParams.append('estado', estado);
                });
                console.log(`🔍 [PRESUPUESTOS-JS] Aplicando filtros: { estado: [${appState.filtros.estado.join(', ')}] }`);
            }
        }

        // --- LÓGICA DE SOLAPAS (TABS) ---
        if (appState.activeTab === 'ventas') {
            // En Ventas, EXCLUIMOS TODOS los estados de retiro
            ESTADOS_RETIRO.forEach(estadoRetiro => {
                queryParams.append('estado_exclude', estadoRetiro);
            });
        } else if (appState.activeTab === 'retiros') {
            // En Retiros, si el usuario NO filtró nada, traemos todos los estados de retiro
            if (!appState.filtros.estado || appState.filtros.estado.length === 0) {
                ESTADOS_RETIRO.forEach(estadoRetiro => {
                    queryParams.append('estado', estadoRetiro);
                });
            }
            // Si el usuario SÍ filtró, ya se agregaron arriba (y como la UI solo muestra botones de retiro,
            // el filtro del usuario ya es un subconjunto válido).
        }

        // AUDITORÍA DE FECHAS - Activar logs si está habilitado
        const auditoriaDeFechas = localStorage.getItem('DEBUG_FECHAS') === 'true' ||
            new URLSearchParams(window.location.search).get('debug_fechas') === 'true';

        if (auditoriaDeFechas) {
            queryParams.append('debug_fechas', 'true');
        }

        const response = await fetchWithRetry(URLS.LIST(queryParams.toString()));
        const data = await response.json();

        // AUDITORÍA DE FECHAS - PASO 4: Recepción en el frontend
        if (auditoriaDeFechas && data.success && data.data && data.data.length > 0) {
            const requestId = data.auditRequestId || 'NO-ID';
            console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 4: RECEPCIÓN EN FRONTEND (${requestId}) =====`);

            // Analizar fechas recibidas desde la API (muestra máximo 10 registros)
            const fechasRecibidas = data.data.filter(item => item.fecha_registro);
            const muestraRecepcion = fechasRecibidas.slice(0, 10);

            if (fechasRecibidas.length > 0) {
                const fechasOrdenadas = fechasRecibidas
                    .map(item => ({ ...item, fechaObj: new Date(item.fecha_registro) }))
                    .sort((a, b) => a.fechaObj - b.fechaObj);

                const fechaMinima = fechasOrdenadas[0];
                const fechaMaxima = fechasOrdenadas[fechasOrdenadas.length - 1];

                // Detectar tipos y formatos recibidos en el navegador
                const tiposRecibidos = new Set();
                const formatosRecibidos = new Set();
                const fechasFuturasRecibidas = [];
                const ahora = new Date();
                const unAñoFuturo = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());

                fechasRecibidas.forEach(item => {
                    const fechaValue = item.fecha_registro;
                    const tipoDetectado = typeof fechaValue;
                    tiposRecibidos.add(tipoDetectado);

                    // Detectar formato específico en recepción
                    if (fechaValue instanceof Date) {
                        formatosRecibidos.add('Date object');
                    } else if (typeof fechaValue === 'string') {
                        if (fechaValue.includes('T') && fechaValue.includes('Z')) {
                            formatosRecibidos.add('ISO UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');
                        } else if (fechaValue.includes('T')) {
                            formatosRecibidos.add('ISO con hora (YYYY-MM-DDTHH:mm:ss)');
                        } else if (fechaValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            formatosRecibidos.add('YYYY-MM-DD (solo fecha)');
                        } else if (fechaValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                            formatosRecibidos.add('DD/MM/YYYY');
                        } else {
                            formatosRecibidos.add('Otro formato string');
                        }
                    } else if (typeof fechaValue === 'number') {
                        formatosRecibidos.add('Timestamp numérico');
                    }

                    // Detectar fechas futuras en recepción
                    const fechaObj = new Date(fechaValue);
                    if (fechaObj > unAñoFuturo) {
                        fechasFuturasRecibidas.push({ id: item.id, fecha: fechaValue, fechaObj });
                    }
                });

                // PASO 4: RESUMEN DE RECEPCIÓN EN FRONTEND
                console.log(`[AUDITORÍA-FECHAS] 📥 RESUMEN PASO 4 - RECEPCIÓN FRONTEND (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Total registros recibidos: ${data.data.length}`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha mínima recibida: ${fechaMinima.fecha_registro} (ID: ${fechaMinima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Fecha máxima recibida: ${fechaMaxima.fecha_registro} (ID: ${fechaMaxima.id})`);
                console.log(`[AUDITORÍA-FECHAS] - Tipos recibidos en navegador: ${Array.from(tiposRecibidos).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Formatos recibidos en navegador: ${Array.from(formatosRecibidos).join(', ')}`);
                console.log(`[AUDITORÍA-FECHAS] - Fechas futuras recibidas: ${fechasFuturasRecibidas.length}`);

                // Ejemplos de fechas futuras recibidas (máximo 5)
                if (fechasFuturasRecibidas.length > 0) {
                    console.log(`[AUDITORÍA-FECHAS] ⚠️ EJEMPLOS DE FECHAS FUTURAS RECIBIDAS (hasta 5):`);
                    fechasFuturasRecibidas.slice(0, 5).forEach((item, idx) => {
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, fecha_futura_recibida="${item.fecha}", año=${item.fechaObj.getFullYear()}`);
                    });
                }

                // Ejemplos de lo que se recibió (máximo 10)
                console.log(`[AUDITORÍA-FECHAS] 📥 EJEMPLOS PASO 4 - VALORES RECIBIDOS (hasta 10):`);
                muestraRecepcion.forEach((item, idx) => {
                    const fechaValue = item.fecha_registro;
                    console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, valor_recibido="${fechaValue}", tipo=${typeof fechaValue}, formato_detectado=${fechaValue instanceof Date ? 'Date object' :
                        typeof fechaValue === 'string' && fechaValue.includes('T') ? 'ISO con hora' :
                            typeof fechaValue === 'string' && fechaValue.match(/^\d{4}-\d{2}-\d{2}$/) ? 'YYYY-MM-DD' :
                                'Otro'
                        }`);
                });

                // Guardar datos para análisis de pasos posteriores
                window.auditFechasData = {
                    requestId,
                    paso4: {
                        totalRecibidos: data.data.length,
                        fechaMinima: fechaMinima.fecha_registro,
                        fechaMaxima: fechaMaxima.fecha_registro,
                        tiposRecibidos: Array.from(tiposRecibidos),
                        formatosRecibidos: Array.from(formatosRecibidos),
                        fechasFuturasRecibidas: fechasFuturasRecibidas.length,
                        ejemplosFechasFuturas: fechasFuturasRecibidas.slice(0, 5),
                        muestraRecibida: muestraRecepcion.slice(0, 10)
                    }
                };
            }
        }

        if (data.success) {
            appState.presupuestos = data.data || data.items || [];
            appState.categorias = data.categorias || [];

            // Fix fechas: diagnóstico + parse seguro + ORDER BY en BD – YYYY-MM-DD
            // Diagnóstico estricto - loguear primeros 5 items del frontend
            if (appState.presupuestos.length > 0) {
                console.log('[DEBUG-FECHA-FE] Diagnóstico de fechas en primeros 5 registros del frontend:');
                appState.presupuestos.slice(0, 5).forEach(item => {
                    console.log('[DEBUG-FECHA-FE]', {
                        id: item.id,
                        fechaRaw: item.fecha_registro,
                        typeof: typeof item.fecha_registro
                    });
                });
            }

            // Actualizar estado de paginación - Orden por fecha DESC + paginación – 2024-12-19
            appState.pagination = {
                currentPage: data.page || page,
                pageSize: data.pageSize || appState.pagination.pageSize,
                totalPages: data.pagination?.pages || Math.ceil((data.total || 0) / (data.pageSize || appState.pagination.pageSize)),
                totalRecords: data.total || 0,
                hasNext: data.pagination?.hasNext || false,
                hasPrev: data.pagination?.hasPrev || false
            };

            // AUDITORÍA DE FECHAS - PASO 5: Transformaciones en frontend (si las hay)
            if (auditoriaDeFechas && appState.presupuestos.length > 0) {
                const requestId = window.auditFechasData?.requestId || 'NO-ID';
                console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 5: TRANSFORMACIONES EN FRONTEND (${requestId}) =====`);

                // En este punto, verificamos si hay transformaciones entre la recepción y el procesamiento
                // Como estamos usando los datos tal como llegan del backend sin transformaciones adicionales,
                // documentamos que no hay transformaciones en el frontend
                console.log(`[AUDITORÍA-FECHAS] 📋 ANÁLISIS PASO 5 - TRANSFORMACIONES FRONTEND (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Motivo: Sin transformaciones - datos procesados tal como se reciben`);
                console.log(`[AUDITORÍA-FECHAS] - Proceso: Los valores de fecha se mantienen en su formato original`);
                console.log(`[AUDITORÍA-FECHAS] - Parseo: Sin parseo adicional de fechas aplicado`);
                console.log(`[AUDITORÍA-FECHAS] - Conversión: Sin conversión de zona horaria`);
                console.log(`[AUDITORÍA-FECHAS] ✅ No se detectaron transformaciones en el procesamiento frontend`);

                // Actualizar datos de auditoría
                if (window.auditFechasData) {
                    window.auditFechasData.paso5 = {
                        transformacionesDetectadas: false,
                        motivo: 'Sin transformaciones - datos procesados tal como se reciben',
                        procesoAplicado: 'Ninguno',
                        parseoAplicado: 'Ninguno',
                        conversionAplicada: 'Ninguna'
                    };
                }
            }

            // AUDITORÍA DE FECHAS - PASO 6: Ordenamiento en frontend (si ordena)
            if (auditoriaDeFechas && appState.presupuestos.length > 0) {
                const requestId = window.auditFechasData?.requestId || 'NO-ID';
                console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 6: ORDENAMIENTO EN FRONTEND (${requestId}) =====`);

                // Analizar el ordenamiento aplicado
                const sortBy = appState.sorting.sortBy;
                const order = appState.sorting.order;

                console.log(`[AUDITORÍA-FECHAS] 📋 ANÁLISIS PASO 6 - ORDENAMIENTO FRONTEND (${requestId}):`);
                console.log(`[AUDITORÍA-FECHAS] - Campo de ordenamiento: ${sortBy}`);
                console.log(`[AUDITORÍA-FECHAS] - Dirección de ordenamiento: ${order}`);
                console.log(`[AUDITORÍA-FECHAS] - Método de ordenamiento: Realizado en el servidor (ORDER BY en SQL)`);
                console.log(`[AUDITORÍA-FECHAS] - Comparación en frontend: No se realiza - datos ya ordenados por el servidor`);
                console.log(`[AUDITORÍA-FECHAS] - Criterio de comparación: ${sortBy === 'fecha' ? 'Fecha como DATE en PostgreSQL' : 'Otro campo'}`);

                if (sortBy === 'fecha' || sortBy === 'fecha_registro') {
                    // Verificar que los datos estén efectivamente ordenados
                    const fechasConDatos = appState.presupuestos.filter(item => item.fecha_registro);
                    if (fechasConDatos.length > 1) {
                        const primeraFecha = new Date(fechasConDatos[0].fecha_registro);
                        const ultimaFecha = new Date(fechasConDatos[fechasConDatos.length - 1].fecha_registro);

                        const ordenCorrecto = order === 'desc' ?
                            primeraFecha >= ultimaFecha :
                            primeraFecha <= ultimaFecha;

                        console.log(`[AUDITORÍA-FECHAS] - Verificación de orden: ${ordenCorrecto ? '✅ Correcto' : '❌ Incorrecto'}`);
                        console.log(`[AUDITORÍA-FECHAS] - Primera fecha mostrada: ${fechasConDatos[0].fecha_registro} (ID: ${fechasConDatos[0].id})`);
                        console.log(`[AUDITORÍA-FECHAS] - Última fecha mostrada: ${fechasConDatos[fechasConDatos.length - 1].fecha_registro} (ID: ${fechasConDatos[fechasConDatos.length - 1].id})`);

                        // Actualizar datos de auditoría
                        if (window.auditFechasData) {
                            window.auditFechasData.paso6 = {
                                campoOrdenamiento: sortBy,
                                direccionOrdenamiento: order,
                                metodoOrdenamiento: 'Servidor (ORDER BY SQL)',
                                ordenCorrecto: ordenCorrecto,
                                primeraFecha: fechasConDatos[0].fecha_registro,
                                ultimaFecha: fechasConDatos[fechasConDatos.length - 1].fecha_registro
                            };
                        }
                    }
                } else {
                    console.log(`[AUDITORÍA-FECHAS] - Ordenamiento por campo no-fecha: ${sortBy}`);
                    console.log(`[AUDITORÍA-FECHAS] ✅ Ordenamiento no afecta las fechas directamente`);
                }
            }

            // AUDITORÍA DE FECHAS - PASO 7: Previo a renderizar en la grilla
            if (auditoriaDeFechas && appState.presupuestos.length > 0) {
                const requestId = window.auditFechasData?.requestId || 'NO-ID';
                console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== PASO 7: PREVIO A RENDERIZAR EN LA GRILLA (${requestId}) =====`);
                let transformacionDetectada = false;
                // Analizar fechas que se van a mostrar (muestra máximo 10 registros)
                const fechasParaMostrar = appState.presupuestos.filter(item => item.fecha_registro);
                const muestraRender = fechasParaMostrar.slice(0, 10);

                if (fechasParaMostrar.length > 0) {
                    const fechasOrdenadas = fechasParaMostrar
                        .map(item => ({ ...item, fechaObj: new Date(item.fecha_registro) }))
                        .sort((a, b) => a.fechaObj - b.fechaObj);

                    const fechaMinima = fechasOrdenadas[0];
                    const fechaMaxima = fechasOrdenadas[fechasOrdenadas.length - 1];

                    // Detectar tipos y formatos previo al render
                    const tiposParaMostrar = new Set();
                    const formatosParaMostrar = new Set();
                    const fechasFuturasParaMostrar = [];
                    const ahora = new Date();
                    const unAñoFuturo = new Date(ahora.getFullYear() + 1, ahora.getMonth(), ahora.getDate());

                    fechasParaMostrar.forEach(item => {
                        const fechaValue = item.fecha_registro;
                        const tipoDetectado = typeof fechaValue;
                        tiposParaMostrar.add(tipoDetectado);

                        // Detectar formato específico previo al render
                        if (fechaValue instanceof Date) {
                            formatosParaMostrar.add('Date object');
                        } else if (typeof fechaValue === 'string') {
                            if (fechaValue.includes('T') && fechaValue.includes('Z')) {
                                formatosParaMostrar.add('ISO UTC (YYYY-MM-DDTHH:mm:ss.sssZ)');
                            } else if (fechaValue.includes('T')) {
                                formatosParaMostrar.add('ISO con hora (YYYY-MM-DDTHH:mm:ss)');
                            } else if (fechaValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                formatosParaMostrar.add('YYYY-MM-DD (solo fecha)');
                            } else if (fechaValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                                formatosParaMostrar.add('DD/MM/YYYY');
                            } else {
                                formatosParaMostrar.add('Otro formato string');
                            }
                        } else if (typeof fechaValue === 'number') {
                            formatosParaMostrar.add('Timestamp numérico');
                        }

                        // Detectar fechas futuras previo al render
                        const fechaObj = new Date(fechaValue);
                        if (fechaObj > unAñoFuturo) {
                            fechasFuturasParaMostrar.push({ id: item.id, fecha: fechaValue, fechaObj });
                        }
                    });

                    // PASO 7: RESUMEN PREVIO AL RENDER
                    console.log(`[AUDITORÍA-FECHAS] 🎨 RESUMEN PASO 7 - PREVIO AL RENDER (${requestId}):`);
                    console.log(`[AUDITORÍA-FECHAS] - Total registros a mostrar: ${appState.presupuestos.length}`);
                    console.log(`[AUDITORÍA-FECHAS] - Fecha mínima a mostrar: ${fechaMinima.fecha_registro} (ID: ${fechaMinima.id})`);
                    console.log(`[AUDITORÍA-FECHAS] - Fecha máxima a mostrar: ${fechaMaxima.fecha_registro} (ID: ${fechaMaxima.id})`);
                    console.log(`[AUDITORÍA-FECHAS] - Tipos previo al render: ${Array.from(tiposParaMostrar).join(', ')}`);
                    console.log(`[AUDITORÍA-FECHAS] - Formatos previo al render: ${Array.from(formatosParaMostrar).join(', ')}`);
                    console.log(`[AUDITORÍA-FECHAS] - Fechas futuras previo al render: ${fechasFuturasParaMostrar.length}`);

                    // Ejemplos de fechas futuras previo al render (máximo 5)
                    if (fechasFuturasParaMostrar.length > 0) {
                        console.log(`[AUDITORÍA-FECHAS] ⚠️ EJEMPLOS DE FECHAS FUTURAS PREVIO AL RENDER (hasta 5):`);
                        fechasFuturasParaMostrar.slice(0, 5).forEach((item, idx) => {
                            console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, fecha_futura_render="${item.fecha}", año=${item.fechaObj.getFullYear()}`);
                        });
                    }

                    // Ejemplos de lo que se va a mostrar con formateo (máximo 10)
                    console.log(`[AUDITORÍA-FECHAS] 🎨 EJEMPLOS PASO 7 - VALORES FINALES A MOSTRAR (hasta 10):`);
                    muestraRender.forEach((item, idx) => {
                        const fechaOriginal = item.fecha_registro;
                        const fechaFormateada = formatDateDDMMYYYY(fechaOriginal);
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, valor_original="${fechaOriginal}", valor_final_mostrado="${fechaFormateada}", transformacion=${fechaOriginal === fechaFormateada ? 'Sin cambios' : 'Formateado para UI'
                            }`);
                    });

                    // Comparar con pasos anteriores para detectar transformaciones
                    const datosRecepcion = window.auditFechasData?.paso4;
                    if (datosRecepcion) {
                        transformacionDetectada = (
                            tiposParaMostrar.size !== datosRecepcion.tiposRecibidos.length ||
                            formatosParaMostrar.size !== datosRecepcion.formatosRecibidos.length ||
                            fechasFuturasParaMostrar.length !== datosRecepcion.fechasFuturasRecibidas
                        );

                        if (transformacionDetectada) {
                            console.log(`[AUDITORÍA-FECHAS] ⚠️ TRANSFORMACIÓN DETECTADA ENTRE PASO 4 Y PASO 7:`);
                            console.log(`[AUDITORÍA-FECHAS] - Cambio en tipos: ${datosRecepcion.tiposRecibidos.join(', ')} → ${Array.from(tiposParaMostrar).join(', ')}`);
                            console.log(`[AUDITORÍA-FECHAS] - Cambio en formatos: ${datosRecepcion.formatosRecibidos.join(', ')} → ${Array.from(formatosParaMostrar).join(', ')}`);
                            console.log(`[AUDITORÍA-FECHAS] - Cambio en fechas futuras: ${datosRecepcion.fechasFuturasRecibidas} → ${fechasFuturasParaMostrar.length}`);
                        } else {
                            console.log(`[AUDITORÍA-FECHAS] ✅ No se detectaron transformaciones entre Paso 4 y Paso 7`);
                        }
                    }

                    // Actualizar datos de auditoría para el paso 7
                    if (window.auditFechasData) {
                        window.auditFechasData.paso7 = {
                            totalRegistrosMostrar: appState.presupuestos.length,
                            fechaMinima: fechaMinima.fecha_registro,
                            fechaMaxima: fechaMaxima.fecha_registro,
                            tiposPrevioRender: Array.from(tiposParaMostrar),
                            formatosPrevioRender: Array.from(formatosParaMostrar),
                            fechasFuturasPrevioRender: fechasFuturasParaMostrar.length,
                            ejemplosFechasFuturas: fechasFuturasParaMostrar.slice(0, 5),
                            muestraFinal: muestraRender.slice(0, 10)
                        };
                    }

                    // RESUMEN FINAL DE TODA LA AUDITORÍA
                    console.log(`\n🔍 [AUDITORÍA-FECHAS] ===== RESUMEN FINAL DE AUDITORÍA (${requestId}) =====`);
                    console.log(`[AUDITORÍA-FECHAS] 📊 RESUMEN COMPLETO DE TRAZABILIDAD:`);
                    console.log(`[AUDITORÍA-FECHAS] - Request ID: ${requestId}`);
                    console.log(`[AUDITORÍA-FECHAS] - Pasos completados: 7 (BD → Transformaciones Backend → Serialización → Recepción → Transformaciones Frontend → Ordenamiento → Render)`);
                    console.log(`[AUDITORÍA-FECHAS] - Registros procesados: ${appState.presupuestos.length}`);
                    console.log(`[AUDITORÍA-FECHAS] - Fechas futuras detectadas: ${fechasFuturasParaMostrar.length > 0 ? 'SÍ (' + fechasFuturasParaMostrar.length + ')' : 'NO'}`);
                    console.log(`[AUDITORÍA-FECHAS] - Transformaciones detectadas: ${transformacionDetectada ? 'SÍ' : 'NO'}`);
                    console.log(`[AUDITORÍA-FECHAS] - Formato final mostrado: DD/MM/YYYY (formatDateDDMMYYYY)`);
                    console.log(`[AUDITORÍA-FECHAS] - Ordenamiento efectivo: ${appState.sorting.sortBy} ${appState.sorting.order.toUpperCase()}`);
                    console.log(`[AUDITORÍA-FECHAS] ✅ Auditoría completa de extremo a extremo finalizada`);
                }
            }

            updatePresupuestosTable(appState.presupuestos);
            updateCategoriasFilter(appState.categorias);
            updatePaginationControls(); // Nueva función para controles de paginación
            updateStandByAccordion(); // Actualizar acordeón de presupuestos sin confirmar

            if (page === 1) {
                loadEstadisticas(); // Solo actualizar estadísticas en la primera página
            }

            showMessage(`Datos cargados: ${appState.presupuestos.length} de ${appState.pagination.totalRecords} registros (Página ${appState.pagination.currentPage} de ${appState.pagination.totalPages})`, 'success');
            console.log(`✅ [PRESUPUESTOS-JS] Datos cargados: ${appState.presupuestos.length} registros - Página ${appState.pagination.currentPage}/${appState.pagination.totalPages}`);
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

    // El sistema usa Service Account por defecto - ejecutar sincronización directamente
    console.log('🔍 [PRESUPUESTOS-JS] Sistema configurado con Service Account - ejecutando sincronización directamente');
    await executeSyncronization();
}


async function executeSyncronization() {
    console.log('[SYNC-BIDI] Ejecutando sincronización bidireccional...');

    try {
        setSyncLoading(true, 'Sincronizando con Google Sheets (push + pull)...');
        console.log(`[SYNC-BIDI][FRONT] endpoint=${URLS.SYNC_BIDIRECCIONAL}`);

        // USAR EL ENDPOINT BIDIRECCIONAL
        const response = await fetch(URLS.SYNC_BIDIRECCIONAL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();
        console.log('[SYNC-BIDI][FRONT][RESP]', data);

        if (response.ok && data.success) {
            const pushEnviados = data.push?.enviados ?? 0;
            const pullRecibidos = data.pull?.recibidos ?? 0;
            const pullActualizados = data.pull?.actualizados ?? 0;
            const pullOmitidos = data.pull?.omitidos ?? 0;

            console.log('[SYNC-BIDI] ✅ Sincronización bidireccional completada:', data);
            console.log(`[SYNC-BIDI] 📤 Push: ${pushEnviados} enviados`);
            console.log(`[SYNC-BIDI] 📥 Pull: ${pullRecibidos} recibidos, ${pullActualizados} actualizados, ${pullOmitidos} omitidos`);

            const totalCambios = pushEnviados + pullRecibidos + pullActualizados;
            if (totalCambios > 0) {
                showMessage(`✅ Sincronización completada: ${pushEnviados} enviados, ${pullRecibidos} nuevos, ${pullActualizados} actualizados`, 'success');
            } else {
                showMessage('✅ Sincronización completada: No hay cambios para sincronizar', 'success');
            }

            // Recargar métricas y datos
            await loadEstadisticas();
            await loadEstados();
            await handleCargarDatos(1);

        } else {
            console.error('[SYNC-BIDI] ❌ Error del servidor:', data);
            if (data.code === 'CONFIG_MISSING') {
                showMessage(`⚠️ Configuración faltante: ${data.message}`, 'warning');
            } else if (data.code === 'SYNC_BIDI_ERROR') {
                showMessage(`❌ Error de sincronización: ${data.message}`, 'error');
            } else {
                showMessage(`❌ Error: ${data.message || 'Error desconocido'}`, 'error');
            }
        }
    } catch (error) {
        console.error('[SYNC-BIDI] ❌ Error en sincronización bidireccional:', error);
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showMessage('❌ Error de conexión con el servidor', 'error');
        } else {
            showMessage(`❌ Error durante la sincronización: ${error.message}`, 'error');
        }
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
    saveFiltersToStorage();
    applyFilters();
}


/**
 * Handler: Buscar cliente con typeahead - Filtro cliente + Typeahead + Fechas – 2024-12-19
 */
function handleBuscarCliente(event) {
    const query = event.target.value;
    console.log(`🔍 [PRESUPUESTOS-JS] Buscando cliente: ${query}`);

    // Limpiar filtros de cliente anteriores
    appState.filtros.clienteId = '';
    appState.filtros.clienteName = '';
    appState.filtros.concepto = '';

    if (query.trim() === '') {
        hideSugerenciasClientes();
        saveFiltersToStorage();
        applyFilters();
        return;
    }

    // Si el texto cumple /^\d{1,3}$/ → filtrar por cliente_id exacto
    if (/^\d{1,3}$/.test(query.trim())) {
        appState.filtros.clienteId = query.trim();
        hideSugerenciasClientes();
        saveFiltersToStorage();
        applyFilters();
    } else {
        // Si es texto → filtrar por nombre y mostrar sugerencias
        appState.filtros.clienteName = query.trim();
        showSugerenciasClientes(query.trim());
        saveFiltersToStorage();
        applyFilters();
    }
}

/**
 * Mostrar sugerencias de clientes
 */
async function showSugerenciasClientes(query) {
    if (query.length < 2) {
        hideSugerenciasClientes();
        return;
    }

    try {
        const response = await fetchWithRetry(URLS.CLIENTES_SUG(query));
        const data = await response.json();

        if (data.success && data.data.length > 0) {
            renderSugerenciasClientes(data.data);
        } else {
            hideSugerenciasClientes();
        }
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al obtener sugerencias:', error);
        hideSugerenciasClientes();
    }
}

/**
 * Renderizar sugerencias de clientes
 */
function renderSugerenciasClientes(sugerencias) {
    let container = document.getElementById('sugerencias-clientes');

    if (!container) {
        container = document.createElement('div');
        container.id = 'sugerencias-clientes';
        container.className = 'sugerencias-container';

        const input = document.getElementById('buscar-cliente');
        if (input && input.parentNode) {
            input.parentNode.appendChild(container);
        }
    }

    container.innerHTML = sugerencias.map(cliente => `
        <div class="sugerencia-item" data-cliente-id="${cliente.id}" data-cliente-text="${escapeHtml(cliente.text)}">
            <span class="cliente-id">${cliente.id.toString().padStart(3, '0')}</span>
            <span class="cliente-nombre">${escapeHtml(cliente.nombre || '')} ${escapeHtml(cliente.apellido || '')}</span>
            <span class="cliente-presupuestos">${cliente.total_presupuestos} presupuestos</span>
        </div>
    `).join('');

    container.style.display = 'block';

    // Agregar event listeners
    container.querySelectorAll('.sugerencia-item').forEach(item => {
        item.addEventListener('click', () => {
            const clienteId = item.dataset.clienteId;
            const clienteText = item.dataset.clienteText;

            // Actualizar input y filtros
            const input = document.getElementById('buscar-cliente');
            if (input) {
                input.value = clienteText;
            }

            appState.filtros.clienteId = clienteId;
            appState.filtros.clienteName = '';
            appState.filtros.concepto = '';

            hideSugerenciasClientes();
            applyFilters();
        });
    });
}

/**
 * Ocultar sugerencias de clientes
 */
function hideSugerenciasClientes() {
    const container = document.getElementById('sugerencias-clientes');
    if (container) {
        container.style.display = 'none';
    }
}

/**
 * Handler: Buscar concepto (legacy)
 */
function handleBuscarConcepto(event) {
    const concepto = event.target.value;
    console.log(`🔍 [PRESUPUESTOS-JS] Buscando concepto: ${concepto}`);

    // Limpiar filtros de cliente
    appState.filtros.clienteId = '';
    appState.filtros.clienteName = '';
    appState.filtros.concepto = concepto;
    applyFilters();
}

/**
 * Aplicar filtros con paginación - Orden por fecha DESC + paginación + Estado – 2024-12-19
 */
function applyFilters() {
    console.log('🔍 [PRESUPUESTOS-JS] Aplicando filtros:', appState.filtros);

    // Resetear a la primera página cuando se aplican filtros
    appState.pagination.currentPage = 1;

    // Recargar datos con filtros desde el servidor
    handleCargarDatos(1, true);

    console.log(`✅ [PRESUPUESTOS-JS] Filtros aplicados - recargando desde servidor`);
}

/**
 * Actualizar tabla de presupuestos
 */
function updatePresupuestosTable(data) {
    // FILTRO DE SEGURIDAD CLIENT-SIDE (HARD FILTER)
    // Asegura que no se muestren registros cruzados incluso si el backend los enviara
    if (appState.activeTab === 'ventas') {
        // En ventas, NO mostrar nada que sea de retiro
        data = data.filter(item => !ESTADOS_RETIRO.includes(item.estado));
    } else if (appState.activeTab === 'retiros') {
        // En retiros, SOLO mostrar lo que sea de retiro
        data = data.filter(item => ESTADOS_RETIRO.includes(item.estado));
    }

    console.log(`🔍 [PRESUPUESTOS-JS] Actualizando tabla con ${data.length} registros...`);

    const tbody = document.getElementById('tbody-presupuestos');
    if (!tbody) {
        console.error('❌ [PRESUPUESTOS-JS] No se encontró tbody-presupuestos');
        return;
    }

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="no-data">
                    No se encontraron registros con los filtros aplicados
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = data.map(item => {
        let categoriaDisplay = escapeHtml(item.categoria || 'Sin tipo');
        if (categoriaDisplay.toLowerCase() === 'factura') {
            categoriaDisplay += (item.condicion_iva === 'Responsable Inscripto') ? ' A' : ' B';
        }
        return `
        <tr class="slide-up" data-presupuesto-id="${item.id}">
            <td class="text-center">
                <button class="btn-expand" onclick="toggleDetalles(${item.id})" title="Ver detalles de artículos">
                    <span class="expand-icon">+</span>
                </button>
            </td>
            <td>${categoriaDisplay}</td>
            <td>${escapeHtml(item.concepto || 'Sin cliente')} ${item.cliente_id ? `- ${item.cliente_id}` : ''}</td>
            <td>${formatDateDDMMYYYYWithTime(item.fecha_registro)}</td>
            <td class="text-right"><strong>$${formatNumber(item.total_final !== undefined ? item.total_final : (item.monto || 0))}</strong></td>
            <td class="text-center">
                <span class="estado-badge estado-${(item.estado || 'sin-estado').toLowerCase().replace(/\s+/g, '-')}">
                    ${escapeHtml(item.estado || 'Sin estado')}
                </span>
                ${item.esta_facturado ?
                `<span class="estado-badge" style="display:block; margin-top:5px; background-color: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb;">
                🧾 Facturado
            </span>` : ''}
                ${item.estado === 'Orden de Retiro' ?
                `<span class="estado-badge" style="display:block; margin-top:5px; background-color: ${item.estado_logistico === 'ESPERANDO_MOSTRADOR' ? '#e2f0d9; color: #38761d' : '#fff2cc; color: #b45f06'}; border: 1px solid ${item.estado_logistico === 'ESPERANDO_MOSTRADOR' ? '#6aa84f' : '#f1c232'}">
                ${item.estado_logistico === 'ESPERANDO_MOSTRADOR' ? '🏪 Trae Cliente' : '🚚 Retira Chofer'}
            </span>` : ''}
            </td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-action btn-print" onclick="imprimirPresupuestoDesdeTabla(${item.id})" title="Imprimir presupuesto">
                        Imprimir
                    </button>
                    <button class="btn-action btn-edit" onclick="editarPresupuesto(${item.id})" title="Editar presupuesto">
                        Editar
                    </button>
                    <button class="btn-action btn-delete" onclick="anularPresupuesto(${item.id})" title="Anular presupuesto">
                        Eliminar
                    </button>
                </div>
            </td>
        </tr>
        <tr class="detalles-row" id="detalles-${item.id}" style="display: none;">
            <td colspan="7" class="detalles-container">
                <div class="loading-detalles">Cargando detalles...</div>
            </td>
        </tr>
        `;
    }).join('');

    console.log('✅ [PRESUPUESTOS-JS] Tabla actualizada con botones de expansión');
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

    console.log(`🔍[PRESUPUESTOS - JS] Actualizando filtro de categorías: ${categorias.length} categorías`);

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

    // Restaurar valor seleccionado si existe en filtros
    if (appState.filtros.categoria) {
        select.value = appState.filtros.categoria;
    }

    console.log('✅ [PRESUPUESTOS-JS] Filtro de categorías actualizado');
}

/**
 * Actualizar filtro de estados con botones - Filtro por Estado con Botones – 2024-12-19
 */
// Constantes de Estados
const ESTADOS_RETIRO = [
    'Orden de Retiro',
    'Retirado',
    'Pendiente de Retiro',
    'Recibido',
    'En Auditoría',
    'Conciliado',
    'Anulado' // Compartido, pero relevante
];

// Estados de venta (si se quisiera whitelisting, por ahora usamos exclusión)
// const ESTADOS_VENTA = []; 

/**
 * Actualizar filtro de estados con botones - Filtro por Estado con Botones – 2024-12-19
 */
function updateEstadosFilter(estados) {
    // Validar que estados sea un array
    if (!Array.isArray(estados)) {
        console.log('⚠️ [PRESUPUESTOS-JS] Estados no es un array válido:', estados);
        estados = []; // Usar array vacío como fallback
    }

    // FILTRADO CONTEXTUAL POR SOLAPA
    let estadosFiltrados = estados;

    if (appState.activeTab === 'retiros') {
        // En Retiros, solo mostrar estados de retiro
        estadosFiltrados = estados.filter(e => ESTADOS_RETIRO.includes(e));
    } else {
        // En Ventas, excluir estados exclusivos de retiro (excepto los compartidos como Anulado si se desea)
        // Estrategia: Mostrar todo lo que NO sea exclusivo de retiro
        estadosFiltrados = estados.filter(e => !ESTADOS_RETIRO.includes(e) || e === 'Anulado');
    }

    console.log(`🔍[PRESUPUESTOS - JS] Actualizando filtro de estados(${appState.activeTab}): ${estadosFiltrados.length} estados(de ${estados.length} totales)`);

    const container = document.getElementById('botones-estado');
    if (!container) {
        console.log('⚠️ [PRESUPUESTOS-JS] No se encontró elemento botones-estado');
        return;
    }

    // Limpiar contenido existente
    container.innerHTML = '';

    // Si no hay estados, mostrar mensaje
    if (estadosFiltrados.length === 0) {
        container.innerHTML = '<span class="estado-loading">(Sin estados relevantes)</span>';
        return;
    }

    // Crear botones para cada estado
    estadosFiltrados.forEach(estado => {
        if (estado) {
            const button = document.createElement('button');
            button.className = 'btn-estado';
            button.textContent = estado;
            button.dataset.estado = estado;
            button.type = 'button';

            // Marcar como activo si está en los filtros guardados
            if (appState.filtros.estado.includes(estado)) {
                button.classList.add('active');
            }

            // Event listener para toggle del estado
            button.addEventListener('click', function () {
                toggleEstadoButton(this);
            });

            container.appendChild(button);
        }
    });

    console.log('✅ [PRESUPUESTOS-JS] Filtro de estados actualizado con botones');
}

/**
 * Toggle estado de un botón de filtro
 */
function toggleEstadoButton(button) {
    const estado = button.dataset.estado;
    const isActive = button.classList.contains('active');

    if (isActive) {
        // Desactivar
        button.classList.remove('active');
        // Remover del array de filtros
        appState.filtros.estado = appState.filtros.estado.filter(e => e !== estado);
        console.log(`🔍[PRESUPUESTOS - JS] Estado desactivado: ${estado} `);
    } else {
        // Activar
        button.classList.add('active');
        // Agregar al array de filtros
        if (!appState.filtros.estado.includes(estado)) {
            appState.filtros.estado.push(estado);
        }
        console.log(`🔍[PRESUPUESTOS - JS] Estado activado: ${estado} `);
    }

    console.log(`🔍[PRESUPUESTOS - JS] Estados seleccionados: [${appState.filtros.estado.join(', ')}]`);

    // Guardar filtros
    saveFiltersToStorage();

    // Aplicar filtros
    applyFilters();
}

/**
 * Actualizar indicador de estado compacto
 */
function updateStatusIndicator(status, message) {
    const indicatorDot = document.getElementById('status-indicator-dot');

    if (indicatorDot) {
        // Remover clases anteriores
        indicatorDot.className = 'status-indicator-dot';

        // Agregar clase según estado
        if (status === 'active') {
            indicatorDot.classList.add('active');
        } else if (status === 'error') {
            indicatorDot.classList.add('error');
        }
        // Si es 'loading', usa el estado por defecto (amarillo con pulse)

        console.log(`🔍[PRESUPUESTOS - JS] Estado actualizado: ${status} - ${message} `);
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

    console.log(`🔍[PRESUPUESTOS - JS] Loading state: ${loading} `);
}

/**
 * Mostrar mensaje al usuario - Solo indicador visual sutil
 */
function showMessage(message, type = 'info') {
    // Mantener console.log para depuración
    console.log(`🔍[PRESUPUESTOS - JS] ${type.toUpperCase()}: ${message} `);

    const container = document.getElementById('message-container');
    if (!container) return;

    // Crear solo el círculo de color, sin texto
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type} `;

    container.appendChild(messageDiv);

    // Auto-remove después de 3 segundos
    setTimeout(() => {
        if (messageDiv.parentElement) {
            messageDiv.remove();
        }
    }, 3000);
}

/**
 * Fetch con reintentos
 */
async function fetchWithRetry(url, options = {}, attempts = CONFIG.RETRY_ATTEMPTS) {
    console.log(`🔍[PRESUPUESTOS - JS] Fetch: ${url} (intentos restantes: ${attempts})`);

    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText} `);
        }

        return response;
    } catch (error) {
        if (attempts > 1) {
            console.log(`⚠️[PRESUPUESTOS - JS] Reintentando en ${CONFIG.RETRY_DELAY}ms...`);
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

// Fix fechas: diagnóstico + parse seguro + ORDER BY en BD – YYYY-MM-DD
// Función para parsear fecha ISO sin UTC
function parseISO(iso) {
    if (!iso || iso === '1970-01-01') return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Fix fechas: diagnóstico + parse seguro + ORDER BY en BD – YYYY-MM-DD
// Función para formatear fecha sin UTC y sin hora
function fmt(iso) {
    if (!iso || iso === '1970-01-01') return '—';
    const [y, m, d] = iso.split('-');
    return `${d} /${m}/${y} `;
}

// Formatear fechas en formato dd/mm/yyyy (sin hora) - Fix fechas: diagnóstico + parse seguro + ORDER BY en BD – YYYY-MM-DD
function formatDateDDMMYYYY(dateString) {
    if (!dateString) return 'N/A';

    // Fix fechas: diagnóstico + parse seguro + ORDER BY en BD – YYYY-MM-DD
    // Usar función fmt segura para fechas YYYY-MM-DD
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return fmt(dateString);
    }

    // Fallback para otros formatos (mantener compatibilidad)
    try {
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        return `${day} /${month}/${year} `;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al formatear fecha:', error);
        return 'Fecha inválida';
    }
}

// Formatear fechas (función original mantenida para compatibilidad)
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

// Formatear fechas en formato dd/mm/yyyy hh:mm según requerimientos
function formatDateDDMMYYYYWithTime(dateString) {
    if (!dateString) return 'N/A';

    // Para fechas YYYY-MM-DD (solo fecha), agregar hora por defecto
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [y, m, d] = dateString.split('-');
        return `${d} /${m}/${y} 00:00`;
    }

    // Para fechas con hora
    try {
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${day} /${month}/${year} ${hours}:${minutes} `;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al formatear fecha con hora:', error);
        return 'Fecha inválida';
    }
}

/**
 * Toggle detalles de un presupuesto
 */
async function toggleDetalles(presupuestoId) {
    console.log(`🔍 [PRESUPUESTOS-JS] Expandiendo detalles para presupuesto ID: ${presupuestoId}`);

    const detallesRow = document.getElementById(`detalles-${presupuestoId}`);
    const expandButton = document.querySelector(`[onclick="toggleDetalles(${presupuestoId})"]`);
    const expandIcon = expandButton?.querySelector('.expand-icon');

    if (!detallesRow) {
        console.error('❌ [PRESUPUESTOS-JS] No se encontró la fila de detalles');
        return;
    }

    // Si ya está visible, ocultarlo
    if (detallesRow.style.display !== 'none') {
        detallesRow.style.display = 'none';
        if (expandIcon) expandIcon.textContent = '+';
        console.log('✅ [PRESUPUESTOS-JS] Detalles ocultados');
        return;
    }

    // Mostrar la fila y cargar detalles
    detallesRow.style.display = 'table-row';
    if (expandIcon) expandIcon.textContent = '-';

    try {
        // Verificar si ya se cargaron los detalles
        const container = detallesRow.querySelector('.detalles-container');
        if (container.dataset.loaded === 'true') {
            console.log('✅ [PRESUPUESTOS-JS] Detalles ya cargados, mostrando');
            return;
        }

        // Mostrar loading
        container.innerHTML = '<div class="loading-detalles">🔄 Cargando detalles de artículos...</div>';

        // Hacer petición AJAX
        const response = await fetchWithRetry(URLS.DETALLES(presupuestoId));
        const data = await response.json();

        if (data.success) {
            console.log(`✅[PRESUPUESTOS - JS] Detalles cargados: ${data.data.total_articulos} artículos`);

            // Renderizar detalles
            container.innerHTML = renderDetallesArticulos(data.data);
            container.dataset.loaded = 'true';
        } else {
            throw new Error(data.message || 'Error al cargar detalles');
        }

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al cargar detalles:', error);

        const container = detallesRow.querySelector('.detalles-container');
        container.innerHTML = `
            <div class="error-detalles">
                ❌ Error al cargar detalles: ${error.message}
                <button onclick="toggleDetalles(${presupuestoId})" class="btn-retry">Reintentar</button>
            </div>
        `;

        showMessage('Error al cargar detalles del presupuesto', 'error');
    }
}

/**
 * Renderizar detalles de artículos
 */
function renderDetallesArticulos(data) {
    console.log('🔍 [PRESUPUESTOS-JS] Renderizando detalles de artículos...');

    const { presupuesto, detalles, total_articulos } = data;

    if (!detalles || detalles.length === 0) {
        return `
        <div class="detalles-content">
            <div class="detalles-header">
                <h4>📋 Detalles del Presupuesto ${presupuesto.id_presupuesto}</h4>
                <span class="tipo-comprobante">${presupuesto.tipo_comprobante}</span>
            </div>
            <div class="no-articulos">
                <p>📦 No se encontraron artículos para este presupuesto</p>
            </div>
        </div>
        `;
    }

    const formatoActual = (presupuesto.condicion_iva === 'Responsable Inscripto') ? 'IVA_DISCRIMINADO' : 'IVA_INCLUIDO';
    const descuentoDecimal = parseFloat(presupuesto.descuento) || 0;
    const descuentoPorcentaje = descuentoDecimal * 100;

    let tableHeaders = '';
    let tbodyHTML = '';
    let footerHTML = '';

    // CALCULO UNIFICADO COMPLETO DEL FOOTER (Subtotal Neto, Descuento, IVA Discriminado y Total)
    const subtotalGeneral = detalles.reduce((t, i) => t + ((parseFloat(i.cantidad) || 0) * (parseFloat(i.valor1) || 0)), 0);
    const montoDescuento = subtotalGeneral * descuentoDecimal;
    const baseConDescuento = subtotalGeneral - montoDescuento;

    let iva21Total = 0;
    let iva105Total = 0;

    detalles.forEach(item => {
        const camp2 = parseFloat(item.camp2) || 0;
        const sl = (parseFloat(item.cantidad) || 0) * (parseFloat(item.valor1) || 0);
        const baseLinea = descuentoDecimal > 0 ? sl * (1 - descuentoDecimal) : sl;
        const ivaLinea = baseLinea * camp2;
        if (Math.abs(camp2 - 0.210) < 0.001) iva21Total += ivaLinea;
        else if (Math.abs(camp2 - 0.105) < 0.001) iva105Total += ivaLinea;
    });

    const totalFinal = baseConDescuento + iva21Total + iva105Total;

    footerHTML = `
        <tr class="totales-row">
            <td colspan="4" class="text-right"><strong>Subtotal Neto:</strong></td>
            <td class="text-right">$${formatNumber(subtotalGeneral)}</td>
        </tr>
        ${descuentoDecimal > 0 ? `
        <tr class="totales-row">
            <td colspan="4" class="text-right"><strong>Descuento (${formatNumber(descuentoPorcentaje)}%):</strong></td>
            <td class="text-right" style="color: #e74c3c;">-$${formatNumber(montoDescuento)}</td>
        </tr>
        <tr class="totales-row">
            <td colspan="4" class="text-right"><strong>Subtotal c/Desc:</strong></td>
            <td class="text-right">$${formatNumber(baseConDescuento)}</td>
        </tr>
        ` : ''}
        ${iva21Total > 0 ? `
        <tr class="totales-row">
            <td colspan="4" class="text-right"><strong>IVA 21.00%:</strong></td>
            <td class="text-right">$${formatNumber(iva21Total)}</td>
        </tr>
        ` : ''}
        ${iva105Total > 0 ? `
        <tr class="totales-row">
            <td colspan="4" class="text-right"><strong>IVA 10.50%:</strong></td>
            <td class="text-right">$${formatNumber(iva105Total)}</td>
        </tr>
        ` : ''}
        <tr class="totales-row" style="background-color: #e9ecef;">
            <td colspan="4" class="text-right"><strong style="font-size: 1.1em;">TOTAL FINAL:</strong></td>
            <td class="text-right total-cell"><strong style="font-size: 1.1em; color: #2c3e50;">$${formatNumber(totalFinal)}</strong></td>
        </tr>
    `;

    if (formatoActual === 'IVA_DISCRIMINADO') {
        tableHeaders = `
            <tr>
                <th>Artículo</th>
                <th>Cantidad</th>
                <th>Precio S/Iva</th>
                <th>IVA %</th>
                <th>Subtotal</th>
            </tr>
        `;

        tbodyHTML = detalles.map(item => {
            const cantidad = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0;
            const camp2 = parseFloat(item.camp2) || 0;
            const ivaPorcentaje = camp2 * 100;
            const descripcion = item.descripcion_articulo || item.descripcion || item.articulo || 'Sin descripción';

            const precioUnitario = valor1;
            const subtotalLinea = cantidad * valor1;

            return `
                <tr>
                    <td class="articulo-cell">
                        <span class="articulo-descripcion">${escapeHtml(descripcion)}</span>
                        ${item.articulo && item.descripcion_articulo !== item.articulo ? `<small class="articulo-codigo">(${escapeHtml(item.articulo)})</small>` : ''}
                    </td>
                    <td class="text-center">${formatNumber(cantidad)}</td>
                    <td class="text-right">$${formatNumber(precioUnitario)}</td>
                    <td class="text-center">${formatNumber(ivaPorcentaje)}%</td>
                    <td class="text-right total-cell">$${formatNumber(subtotalLinea)}</td>
                </tr>
            `;
        }).join('');
    } else {
        tableHeaders = `
            <tr>
                <th colspan="2">Artículo</th>
                <th>Cantidad</th>
                <th>Precio c/Iva</th>
                <th>Subtotal</th>
            </tr>
        `;

        tbodyHTML = detalles.map(item => {
            const cantidad = parseFloat(item.cantidad) || 0;
            const valor1 = parseFloat(item.valor1) || 0;
            const camp2 = parseFloat(item.camp2) || 0;
            const descripcion = item.descripcion_articulo || item.descripcion || item.articulo || 'Sin descripción';

            const precioUnitario = valor1 * (1 + camp2);
            const subtotalLinea = cantidad * precioUnitario;

            return `
                <tr>
                    <td class="articulo-cell" colspan="2">
                        <span class="articulo-descripcion">${escapeHtml(descripcion)}</span>
                        ${item.articulo && item.descripcion_articulo !== item.articulo ? `<small class="articulo-codigo">(${escapeHtml(item.articulo)})</small>` : ''}
                    </td>
                    <td class="text-center">${formatNumber(cantidad)}</td>
                    <td class="text-right">$${formatNumber(precioUnitario)}</td>
                    <td class="text-right total-cell">$${formatNumber(subtotalLinea)}</td>
                </tr>
            `;
        }).join('');
    }

    return `
        <div class="detalles-content">
            <div class="detalles-header">
                <h4>📋 Detalles del Presupuesto ${presupuesto.id_presupuesto}</h4>
                <div class="detalles-info">
                    <span class="tipo-comprobante">${presupuesto.tipo_comprobante}</span>
                    <span class="total-articulos">${total_articulos} artículo${total_articulos !== 1 ? 's' : ''}</span>
                    <span class="tipo-comprobante" style="margin-left:8px; background:#e0f2f1; color:#00695c; border-color:#80cbc4;">${formatoActual === 'IVA_DISCRIMINADO' ? 'Factura A (Iva Discriminado)' : 'Factura B (Iva Incluido)'}</span>
                </div>
            </div>
            
            <div class="detalles-table-container">
                <table class="detalles-table">
                    <thead>
                        ${tableHeaders}
                    </thead>
                    <tbody>
                        ${tbodyHTML}
                    </tbody>
                    <tfoot>
                        ${footerHTML}
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

// Escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Actualizar controles de paginación - Orden por fecha DESC + paginación – 2024-12-19
 */
function updatePaginationControls() {
    console.log('🔍 [PRESUPUESTOS-JS] Actualizando controles de paginación...');

    // Buscar o crear contenedor de paginación
    let paginationContainer = document.getElementById('pagination-controls');
    if (!paginationContainer) {
        // Crear contenedor si no existe
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'pagination-controls';
        paginationContainer.className = 'pagination-controls';

        // Insertar después de la tabla
        const tableContainer = document.querySelector('.table-container');
        if (tableContainer) {
            tableContainer.parentNode.insertBefore(paginationContainer, tableContainer.nextSibling);
        }
    }

    const { currentPage, totalPages, totalRecords, pageSize, hasNext, hasPrev } = appState.pagination;

    if (totalRecords === 0) {
        paginationContainer.innerHTML = '';
        return;
    }

    paginationContainer.innerHTML = `
        < div class="pagination-info" >
            <span class="records-info">
                Mostrando ${((currentPage - 1) * pageSize) + 1} - ${Math.min(currentPage * pageSize, totalRecords)} de ${totalRecords} registros
            </span>
            <div class="page-size-selector">
                <label for="page-size-select">Registros por página:</label>
                <select id="page-size-select" onchange="changePageSize(this.value)">
                    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
                    <option value="200" ${pageSize === 200 ? 'selected' : ''}>200</option>
                </select>
            </div>
        </div >

        <div class="pagination-buttons">
            <button class="btn-pagination" onclick="goToPage(1)" ${!hasPrev ? 'disabled' : ''} title="Primera página">
                ⏮️ Primera
            </button>
            <button class="btn-pagination" onclick="goToPage(${currentPage - 1})" ${!hasPrev ? 'disabled' : ''} title="Página anterior">
                ⏪ Anterior
            </button>

            <div class="page-info">
                <span>Página ${currentPage} de ${totalPages}</span>
                <input type="number" id="page-input" min="1" max="${totalPages}" value="${currentPage}"
                    onchange="goToPage(this.value)" onkeypress="handlePageInputKeypress(event)"
                    title="Ir a página específica" class="page-input">
            </div>

            <button class="btn-pagination" onclick="goToPage(${currentPage + 1})" ${!hasNext ? 'disabled' : ''} title="Página siguiente">
                Siguiente ⏩
            </button>
            <button class="btn-pagination" onclick="goToPage(${totalPages})" ${!hasNext ? 'disabled' : ''} title="Última página">
                Última ⏭️
            </button>
        </div>
    `;

    console.log(`✅[PRESUPUESTOS - JS] Controles de paginación actualizados - Página ${currentPage}/${totalPages}`);
}

/**
 * Ir a página específica - Orden por fecha DESC + paginación – 2024-12-19
 */
function goToPage(page) {
    const pageNum = parseInt(page);

    if (isNaN(pageNum) || pageNum < 1 || pageNum > appState.pagination.totalPages) {
        console.log(`⚠️ [PRESUPUESTOS-JS] Página inválida: ${page}`);
        showMessage('Número de página inválido', 'warning');
        return;
    }

    if (pageNum === appState.pagination.currentPage) {
        console.log(`⚠️ [PRESUPUESTOS-JS] Ya estás en la página ${pageNum}`);
        return;
    }

    console.log(`🔍 [PRESUPUESTOS-JS] Navegando a página: ${pageNum}`);
    handleCargarDatos(pageNum, true);
}

/**
 * Cambiar tamaño de página - Orden por fecha DESC + paginación – 2024-12-19
 */
function changePageSize(newSize) {
    const size = parseInt(newSize);

    if (isNaN(size) || size < 1) {
        console.log(`⚠️ [PRESUPUESTOS-JS] Tamaño de página inválido: ${newSize}`);
        return;
    }

    console.log(`🔍 [PRESUPUESTOS-JS] Cambiando tamaño de página a: ${size}`);

    // Actualizar estado
    appState.pagination.pageSize = size;
    appState.pagination.currentPage = 1; // Resetear a primera página

    // Recargar datos
    handleCargarDatos(1, true);
}

/**
 * Manejar tecla Enter en input de página - Orden por fecha DESC + paginación – 2024-12-19
 */
function handlePageInputKeypress(event) {
    if (event.key === 'Enter') {
        const page = event.target.value;
        goToPage(page);
    }
}

/**
 * Handler: Nuevo Presupuesto
 */
function handleNuevoPresupuesto() {
    console.log('🔍 [PRESUPUESTOS-JS] Navegando a crear nuevo presupuesto...');

    // Redirigir a la página de crear presupuesto
    window.location.href = '/pages/crear-presupuesto.html';
}

/**
 * Imprimir presupuesto desde la tabla
 */
function imprimirPresupuestoDesdeTabla(presupuestoId) {
    console.log(`🖨️ [PRESUPUESTOS-JS] Navegando a imprimir presupuesto ID: ${presupuestoId}`);

    // Redirigir a la página de impresión con el ID
    window.location.href = `/pages/imprimir-presupuesto.html?id=${presupuestoId}`;
}

/**
 * Editar presupuesto
 */
function editarPresupuesto(presupuestoId) {
    console.log(`🔍 [PRESUPUESTOS-JS] Navegando a editar presupuesto ID: ${presupuestoId}`);

    // Ruteo Inteligente: Detectar si es Orden de Retiro
    let url = `/pages/editar-presupuesto.html?id=${presupuestoId}`;

    const presupuesto = appState.presupuestos.find(p => p.id === presupuestoId);
    if (presupuesto && (presupuesto.estado === 'Orden de Retiro' || presupuesto.estado_logistico === 'PENDIENTE_ASIGNAR')) {
        console.log('📦 [RUTEO] Detectado contexto de Retiro -> Activando modo retiro');
        url += '&modo=retiro';
    }

    // Redirigir
    window.location.href = url;
}

/**
 * Mostrar modal de confirmación de eliminación
 */
function showDeleteConfirmModal(presupuestoId) {
    console.log(`🔍 [PRESUPUESTOS-JS] Mostrando modal de confirmación para presupuesto ID: ${presupuestoId}`);

    // Buscar información del presupuesto en los datos actuales
    const presupuesto = appState.presupuestos.find(p => p.id === presupuestoId);
    if (!presupuesto) {
        console.error('❌ [PRESUPUESTOS-JS] Presupuesto no encontrado en datos locales');
        showMessage('Error: Presupuesto no encontrado', 'error');
        return;
    }

    // Llenar información del presupuesto en el modal
    const infoContainer = document.getElementById('delete-presupuesto-info');
    if (infoContainer) {
        infoContainer.innerHTML = `
            <div class="presupuesto-details">
                <h4>Información del Presupuesto</h4>
                <div class="detail-row">
                    <span class="label">ID:</span>
                    <span class="value">${presupuesto.id}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Tipo:</span>
                    <span class="value">${escapeHtml(presupuesto.categoria || 'Sin tipo')}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Cliente:</span>
                    <span class="value">${escapeHtml(presupuesto.concepto || 'Sin cliente')}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Fecha:</span>
                    <span class="value">${formatDateDDMMYYYYWithTime(presupuesto.fecha_registro)}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Estado:</span>
                    <span class="value">${escapeHtml(presupuesto.estado || 'Sin estado')}</span>
                </div>
            </div>
        `;
    }

    // Actualizar el texto de advertencia para reflejar borrado físico
    const warningText = document.querySelector('.warning-text');
    if (warningText) {
        warningText.textContent = '⚠️ Esta acción eliminará permanentemente el presupuesto y todos sus detalles de la base de datos. No se puede deshacer.';
    }

    // Actualizar el texto del botón
    const confirmBtn = document.getElementById('btn-confirm-delete');
    if (confirmBtn) {
        confirmBtn.textContent = '🗑️ Eliminar Permanentemente';
    }

    // Guardar el ID del presupuesto a eliminar
    window.presupuestoToDelete = presupuestoId;

    // Mostrar modal
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) {
        modal.style.display = 'flex';
        console.log('✅ [PRESUPUESTOS-JS] Modal de confirmación mostrado');
    }
}

/**
 * Cerrar modal de confirmación de eliminación
 */
function closeDeleteConfirmModal() {
    console.log('🔍 [PRESUPUESTOS-JS] Cerrando modal de confirmación');

    const modal = document.getElementById('delete-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
        window.presupuestoToDelete = null;
        console.log('✅ [PRESUPUESTOS-JS] Modal de confirmación cerrado');
    }
}

/**
 * Confirmar eliminación del presupuesto
 */
async function confirmDeletePresupuesto() {
    const presupuestoId = window.presupuestoToDelete;
    if (!presupuestoId) {
        console.error('❌ [PRESUPUESTOS-JS] No hay presupuesto para eliminar');
        return;
    }

    console.log(`🔍 [PRESUPUESTOS-JS] Confirmando eliminación de presupuesto ID: ${presupuestoId}`);

    // Cerrar modal
    closeDeleteConfirmModal();

    try {
        // Mostrar loading
        showMessage('⏳ Eliminando presupuesto...', 'info');

        // Deshabilitar botón de confirmación para evitar doble envío
        const btnConfirm = document.getElementById('btn-confirm-delete');
        if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.textContent = '⏳ Eliminando...';
        }

        // Hacer petición DELETE
        const response = await fetchWithRetry(URLS.PRESUPUESTO(presupuestoId), {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log('✅ [PRESUPUESTOS-JS] Presupuesto eliminado exitosamente');

            showMessage('✅ Presupuesto eliminado exitosamente', 'success');

            // Recargar la lista de presupuestos
            await handleCargarDatos(appState.pagination.currentPage, true);

        } else {
            throw new Error(data.error || data.message || 'Error desconocido');
        }

    } catch (error) {
        console.error('❌ [PRESUPUESTOS-JS] Error al eliminar presupuesto:', error);
        showMessage(`❌ Error al eliminar presupuesto: ${error.message}`, 'error');
    } finally {
        // Rehabilitar botón
        const btnConfirm = document.getElementById('btn-confirm-delete');
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.textContent = '🗑️ Eliminar Presupuesto';
        }
    }
}

/**
 * Anular presupuesto (legacy - ahora usa modal)
 */
async function anularPresupuesto(presupuestoId) {
    console.log(`🔍 [PRESUPUESTOS-JS] Iniciando proceso de eliminación para presupuesto ID: ${presupuestoId}`);

    // Mostrar modal de confirmación en lugar del confirm() nativo
    showDeleteConfirmModal(presupuestoId);
}

/**
 * SISTEMA DE POLLING PARA AUTOSYNC
 * Actualiza estadísticas automáticamente cuando la sincronización automática está activa
 */

/**
 * Iniciar polling de actualizaciones automáticas
 */
async function startAutoUpdatePolling() {
    console.log('[AUTO-UPDATE] Iniciando polling de actualizaciones...');

    // Si ya está activo, no hacer nada
    if (appState.autoUpdatePolling.isActive) {
        console.log('[AUTO-UPDATE] Polling ya está activo');
        return;
    }

    // Verificar si autosync está habilitado
    const isAutoSyncEnabled = await checkIfAutoSyncIsEnabled();
    if (!isAutoSyncEnabled) {
        console.log('[AUTO-UPDATE] Autosync deshabilitado, no se iniciará polling');
        return;
    }

    // Marcar como activo
    appState.autoUpdatePolling.isActive = true;

    // Configurar intervalo
    appState.autoUpdatePolling.intervalId = setInterval(async () => {
        await pollForUpdates();
    }, appState.autoUpdatePolling.pollIntervalSeconds * 1000);

    console.log(`[AUTO-UPDATE] ✅ Polling iniciado (cada ${appState.autoUpdatePolling.pollIntervalSeconds} segundos)`);
}

/**
 * Detener polling de actualizaciones automáticas
 */
function stopAutoUpdatePolling() {
    console.log('[AUTO-UPDATE] Deteniendo polling de actualizaciones...');

    if (appState.autoUpdatePolling.intervalId) {
        clearInterval(appState.autoUpdatePolling.intervalId);
        appState.autoUpdatePolling.intervalId = null;
    }

    appState.autoUpdatePolling.isActive = false;
    console.log('[AUTO-UPDATE] ✅ Polling detenido');
}

/**
 * Verificar si hay actualizaciones disponibles
 */
async function pollForUpdates() {
    try {
        // Obtener última sincronización de la BD sin mostrar errores
        const response = await fetch(URLS.ESTADISTICAS);
        const data = await response.json();

        if (data.success && data.estadisticas && data.estadisticas.ultima_sincronizacion) {
            const nuevaFechaSinc = data.estadisticas.ultima_sincronizacion;

            // Si es la primera vez o si cambió, actualizar
            if (!appState.autoUpdatePolling.lastSyncTimestamp ||
                appState.autoUpdatePolling.lastSyncTimestamp !== nuevaFechaSinc) {

                console.log('[AUTO-UPDATE] 🔄 Nueva sincronización detectada:', nuevaFechaSinc);

                // Actualizar timestamp guardado
                appState.autoUpdatePolling.lastSyncTimestamp = nuevaFechaSinc;

                // Actualizar estadísticas silenciosamente (sin mensaje al usuario)
                await loadEstadisticas();

                console.log('[AUTO-UPDATE] ✅ Estadísticas actualizadas automáticamente');
            }
        }
    } catch (error) {
        // Silenciar errores del polling para no molestar al usuario
        console.log('[AUTO-UPDATE] Error en polling (silenciado):', error.message);
    }
}

/**
 * Verificar si autosync está habilitado
 */
async function checkIfAutoSyncIsEnabled() {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/sync/config`);
        const data = await response.json();

        if (data && data.auto_sync_enabled) {
            console.log('[AUTO-UPDATE] Autosync está HABILITADO');
            return true;
        }

        console.log('[AUTO-UPDATE] Autosync está DESHABILITADO');
        return false;
    } catch (error) {
        console.log('[AUTO-UPDATE] Error verificando estado de autosync:', error.message);
        return false;
    }
}

/**
 * Reiniciar polling según estado actual de autosync
 * Se llama desde el modal al cerrar o al cambiar configuración
 */
window.refreshAutoUpdatePolling = async function () {
    console.log('[AUTO-UPDATE] Refrescando estado de polling...');

    // Detener polling actual
    stopAutoUpdatePolling();

    // Verificar si debe iniciarse nuevamente
    const isAutoSyncEnabled = await checkIfAutoSyncIsEnabled();

    if (isAutoSyncEnabled) {
        console.log('[AUTO-UPDATE] Reiniciando polling porque autosync está activo');
        await startAutoUpdatePolling();
    } else {
        console.log('[AUTO-UPDATE] No se inicia polling porque autosync está inactivo');
    }
};

// Iniciar polling automáticamente si autosync está habilitado al cargar la página
document.addEventListener('DOMContentLoaded', async function () {
    // Esperar un momento para que la aplicación se inicialice completamente
    setTimeout(async () => {
        console.log('[AUTO-UPDATE] Verificando si debe iniciar polling al cargar página...');
        const isAutoSyncEnabled = await checkIfAutoSyncIsEnabled();

        if (isAutoSyncEnabled) {
            console.log('[AUTO-UPDATE] Autosync habilitado, iniciando polling automático');
            await startAutoUpdatePolling();
        }
    }, 2000);
});

/**
 * ===== SISTEMA DE PERSISTENCIA DE FILTROS =====
 * Guarda y restaura filtros en sessionStorage para mantenerlos
 * al navegar entre páginas del módulo de presupuestos
 */

const STORAGE_KEY_FILTERS = 'presupuestos_filtros_activos';

/**
 * Guardar filtros actuales en sessionStorage
 */
function saveFiltersToStorage() {
    try {
        const filtrosParaGuardar = {
            categoria: appState.filtros.categoria || '',
            clienteId: appState.filtros.clienteId || '',
            clienteName: appState.filtros.clienteName || '',
            concepto: appState.filtros.concepto || '',
            estado: appState.filtros.estado || [],
            // Guardar también el texto del input de búsqueda
            buscarClienteText: document.getElementById('buscar-cliente')?.value || ''
        };

        sessionStorage.setItem(STORAGE_KEY_FILTERS, JSON.stringify(filtrosParaGuardar));
        console.log('💾 [FILTROS-PERSIST] Filtros guardados en sessionStorage:', filtrosParaGuardar);
    } catch (error) {
        console.error('❌ [FILTROS-PERSIST] Error al guardar filtros:', error);
    }
}

/**
 * Restaurar filtros desde sessionStorage
 */
function restoreFiltersFromStorage() {
    try {
        const filtrosGuardados = sessionStorage.getItem(STORAGE_KEY_FILTERS);

        if (!filtrosGuardados) {
            console.log('📭 [FILTROS-PERSIST] No hay filtros guardados');
            return;
        }

        const filtros = JSON.parse(filtrosGuardados);
        console.log('📥 [FILTROS-PERSIST] Restaurando filtros desde sessionStorage:', filtros);

        // Restaurar en appState
        appState.filtros.categoria = filtros.categoria || '';
        appState.filtros.clienteId = filtros.clienteId || '';
        appState.filtros.clienteName = filtros.clienteName || '';
        appState.filtros.concepto = filtros.concepto || '';
        appState.filtros.estado = filtros.estado || [];

        // Restaurar valores visuales en los controles
        restoreFilterControls(filtros);

        // Si hay filtros activos, aplicarlos automáticamente
        const hayFiltrosActivos = filtros.categoria ||
            filtros.clienteId ||
            filtros.clienteName ||
            filtros.concepto ||
            (filtros.estado && filtros.estado.length > 0);

        if (hayFiltrosActivos) {
            console.log('✅ [FILTROS-PERSIST] Filtros activos detectados - se aplicarán automáticamente');
        }

    } catch (error) {
        console.error('❌ [FILTROS-PERSIST] Error al restaurar filtros:', error);
    }
}

/**
 * Restaurar valores visuales en los controles de filtro
 */
function restoreFilterControls(filtros) {
    console.log('🔍 [FILTROS-PERSIST] Restaurando valores visuales en controles...');

    // Restaurar select de categoría
    const selectCategoria = document.getElementById('filtro-categoria');
    if (selectCategoria && filtros.categoria) {
        // Esperar a que las opciones se carguen
        setTimeout(() => {
            selectCategoria.value = filtros.categoria;
            console.log(`✅ [FILTROS-PERSIST] Categoría restaurada: ${filtros.categoria}`);
        }, 100);
    }

    // Restaurar input de búsqueda de cliente
    const inputBuscarCliente = document.getElementById('buscar-cliente');
    if (inputBuscarCliente && filtros.buscarClienteText) {
        inputBuscarCliente.value = filtros.buscarClienteText;
        console.log(`✅ [FILTROS-PERSIST] Texto de búsqueda restaurado: ${filtros.buscarClienteText}`);
    }

    // Restaurar botones de estado (se hace en updateEstadosFilter cuando se cargan los estados)
    if (filtros.estado && filtros.estado.length > 0) {
        console.log(`✅ [FILTROS-PERSIST] Estados a restaurar: [${filtros.estado.join(', ')}]`);
    }
}

/**
 * Limpiar filtros guardados (útil para reset manual)
 */
function clearSavedFilters() {
    try {
        sessionStorage.removeItem(STORAGE_KEY_FILTERS);
        console.log('🗑️ [FILTROS-PERSIST] Filtros guardados eliminados');
    } catch (error) {
        console.error('❌ [FILTROS-PERSIST] Error al limpiar filtros:', error);
    }
}

// Exponer función para uso externo si es necesario
window.clearSavedFilters = clearSavedFilters;

/**
 * ===================================
 * FUNCIONES PARA ACORDEÓN DE PRESUPUESTOS SIN CONFIRMAR
 * ===================================
 */

/**
 * Toggle del acordeón - expandir/colapsar
 */
function toggleAccordion(accordionId) {
    console.log(`🔍 [ACCORDION] Toggling acordeón: ${accordionId}`);

    const accordion = document.getElementById(accordionId);
    if (!accordion) {
        console.error(`❌ [ACCORDION] No se encontró el acordeón con ID: ${accordionId}`);
        return;
    }

    // Toggle clase expanded
    accordion.classList.toggle('expanded');

    const isExpanded = accordion.classList.contains('expanded');
    console.log(`✅ [ACCORDION] Acordeón ${isExpanded ? 'expandido' : 'colapsado'}`);
}

/**
 * Actualizar acordeón de presupuestos sin confirmar (Stand By)
 * Filtra presupuestos con estado "Muestra de Fraccionados"
 */
function updateStandByAccordion() {
    console.log('🔍 [ACCORDION] Actualizando acordeón de presupuestos sin confirmar...');

    // Filtrar presupuestos con estado exactamente "Muestra de Fraccionados"
    const standByPresupuestos = appState.presupuestos.filter(item =>
        item.estado === 'Muestra de Fraccionados'
    );

    console.log(`✅ [ACCORDION] Encontrados ${standByPresupuestos.length} presupuestos sin confirmar`);

    // Actualizar contador en el header del acordeón
    const countElement = document.getElementById('standby-count');
    if (countElement) {
        countElement.textContent = standByPresupuestos.length;
    }

    // Actualizar tabla dentro del acordeón
    const tbody = document.getElementById('tbody-standby');
    if (!tbody) {
        console.error('❌ [ACCORDION] No se encontró tbody-standby');
        return;
    }

    // Si no hay presupuestos, mostrar mensaje
    if (standByPresupuestos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="no-data">
                    No hay presupuestos sin confirmar
                </td>
            </tr>
        `;
        return;
    }

    // Renderizar filas reutilizando la misma lógica que la tabla principal
    tbody.innerHTML = standByPresupuestos.map(item => {
        let categoriaDisplay = escapeHtml(item.categoria || 'Sin tipo');
        if (categoriaDisplay.toLowerCase() === 'factura') {
            categoriaDisplay += (item.condicion_iva === 'Responsable Inscripto') ? ' A' : ' B';
        }
        return `
        <tr class="slide-up" data-presupuesto-id="${item.id}">
            <td class="text-center">
                <button class="btn-expand" onclick="toggleDetalles(${item.id})" title="Ver detalles de artículos">
                    <span class="expand-icon">+</span>
                </button>
            </td>
            <td>${categoriaDisplay}</td>
            <td>${escapeHtml(item.concepto || 'Sin cliente')} ${item.cliente_id ? `- ${item.cliente_id}` : ''}</td>
            <td>${formatDateDDMMYYYYWithTime(item.fecha_registro)}</td>
            <td class="text-right"><strong>$${formatNumber(item.total_final !== undefined ? item.total_final : (item.monto || 0))}</strong></td>
            <td class="text-center">
                <span class="estado-badge estado-${(item.estado || 'sin-estado').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(item.estado || 'Sin estado')}</span>
            </td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-action btn-print" onclick="imprimirPresupuestoDesdeTabla(${item.id})" title="Imprimir presupuesto">
                        Imprimir
                    </button>
                    <button class="btn-action btn-edit" onclick="editarPresupuesto(${item.id})" title="Editar presupuesto">
                        Editar
                    </button>
                    <button class="btn-action btn-delete" onclick="anularPresupuesto(${item.id})" title="Anular presupuesto">
                        Eliminar
                    </button>
                </div>
            </td>
        </tr>
        <tr class="detalles-row" id="detalles-${item.id}" style="display: none;">
            <td colspan="7" class="detalles-container">
                <div class="loading-detalles">Cargando detalles...</div>
            </td>
        </tr>
        `;
    }).join('');

    console.log('✅ [ACCORDION] Acordeón actualizado con presupuestos sin confirmar');
}

// Exponer función toggleAccordion globalmente para uso en onclick
window.toggleAccordion = toggleAccordion;

console.log('✅ [PRESUPUESTOS-JS] Módulo frontend cargado completamente con paginación, auto-update, persistencia de filtros y acordeón de stand-by');
