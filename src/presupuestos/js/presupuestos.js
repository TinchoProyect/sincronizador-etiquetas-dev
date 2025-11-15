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
  const btn = document.getElementById('btn-cargar-datos');
  if (!btn) return;
  window.__presupuestosAutocargados = true;
  console.log('[PRESUPUESTOS-JS] Autocarga inicial → disparando click en btn-cargar-datos');
  // Pequeño defer para asegurar que los listeners ya están bindeados
  setTimeout(() => btn.dispatchEvent(new Event('click')), 0);
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
let appState = {
    presupuestos: [],
    categorias: [],
    estados: [], // Nuevo: lista de estados distintos - Filtro por Estado – 2024-12-19
    estadisticas: null,
    filtros: {
        categoria: '',
        concepto: '',
        // Nuevos filtros de cliente - Filtro cliente + Typeahead + Fechas – 2024-12-19
        clienteId: '',
        clienteName: '',
        // Nuevo filtro por estado - Filtro por Estado – 2024-12-19
        estado: []
    },
    // Nuevos parámetros de paginación
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
    // NUEVO: Estado para polling de actualizaciones automáticas
    autoUpdatePolling: {
        intervalId: null,
        isActive: false,
        lastSyncTimestamp: null,
        pollIntervalSeconds: 30 // Revisar cada 30 segundos
    }
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
    loadEstados(); // Cargar estados al inicializar - Filtro por Estado – 2024-12-19
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
    const filtroEstado = document.getElementById('filtro-estado'); // Nuevo filtro por estado – 2024-12-19
    
    if (filtroCategoria) {
        filtroCategoria.addEventListener('change', handleFiltroCategoria);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: filtro-categoria');
    }
    
    if (buscarCliente) {
        buscarCliente.addEventListener('input', debounce(handleBuscarCliente, 300));
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: buscar-cliente');
    }
    
    // Nuevo event listener para filtro por estado - Filtro por Estado – 2024-12-19
    if (filtroEstado) {
        filtroEstado.addEventListener('change', handleFiltroEstado);
        console.log('✅ [PRESUPUESTOS-JS] Event listener agregado: filtro-estado');
    }
    
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
 * Actualizar display de estadísticas
 */
function updateStatsDisplay(stats) {
    console.log('🔍 [PRESUPUESTOS-JS] Actualizando display de estadísticas...');
    console.log('[PRESUP/KPIS] stats=', stats);
    
    const elements = {
        'total-registros': stats.total_registros || 0,
        'total-categorias': stats.total_categorias || 0,
        'monto-total': '—', // <- no mostramos $0,00
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
                    console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, valor_recibido="${fechaValue}", tipo=${typeof fechaValue}, formato_detectado=${
                        fechaValue instanceof Date ? 'Date object' :
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
                        console.log(`[AUDITORÍA-FECHAS] ${idx + 1}. ID=${item.id}, valor_original="${fechaOriginal}", valor_final_mostrado="${fechaFormateada}", transformacion=${
                            fechaOriginal === fechaFormateada ? 'Sin cambios' : 'Formateado para UI'
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
            const pushEnviados    = data.push?.enviados ?? 0;
            const pullRecibidos   = data.pull?.recibidos ?? 0;
            const pullActualizados= data.pull?.actualizados ?? 0;
            const pullOmitidos    = data.pull?.omitidos ?? 0;

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
    applyFilters();
}

/**
 * Handler: Filtro por estado - Filtro por Estado – 2024-12-19
 */
function handleFiltroEstado(event) {
    const select = event.target;
    const selectedOptions = Array.from(select.selectedOptions).map(option => option.value);
    
    console.log(`🔍 [PRESUPUESTOS-JS] Filtrando por estado: [${selectedOptions.join(', ')}]`);
    
    appState.filtros.estado = selectedOptions;
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
        applyFilters();
        return;
    }
    
    // Si el texto cumple /^\d{1,3}$/ → filtrar por cliente_id exacto
    if (/^\d{1,3}$/.test(query.trim())) {
        appState.filtros.clienteId = query.trim();
        hideSugerenciasClientes();
        applyFilters();
    } else {
        // Si es texto → filtrar por nombre y mostrar sugerencias
        appState.filtros.clienteName = query.trim();
        showSugerenciasClientes(query.trim());
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
    
    tbody.innerHTML = data.map(item => `
        <tr class="slide-up" data-presupuesto-id="${item.id}">
            <td class="text-center">
                <button class="btn-expand" onclick="toggleDetalles(${item.id})" title="Ver detalles de artículos">
                    <span class="expand-icon">+</span>
                </button>
            </td>
            <td>${escapeHtml(item.categoria || 'Sin tipo')}</td>
            <td>${escapeHtml(item.concepto || 'Sin cliente')}</td>
            <td>${formatDateDDMMYYYYWithTime(item.fecha_registro)}</td>
            <td class="text-center">
                <span class="estado-badge estado-${(item.estado || 'sin-estado').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(item.estado || 'Sin estado')}</span>
            </td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-action btn-edit" onclick="editarPresupuesto(${item.id})" title="Editar presupuesto">
                        ✏️
                    </button>
                    <button class="btn-action btn-delete" onclick="anularPresupuesto(${item.id})" title="Anular presupuesto">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
        <tr class="detalles-row" id="detalles-${item.id}" style="display: none;">
            <td colspan="6" class="detalles-container">
                <div class="loading-detalles">Cargando detalles...</div>
            </td>
        </tr>
    `).join('');
    
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
 * Actualizar filtro de estados - Filtro por Estado – 2024-12-19
 */
function updateEstadosFilter(estados) {
    // Validar que estados sea un array
    if (!Array.isArray(estados)) {
        console.log('⚠️ [PRESUPUESTOS-JS] Estados no es un array válido:', estados);
        estados = []; // Usar array vacío como fallback
    }
    
    console.log(`🔍 [PRESUPUESTOS-JS] Actualizando filtro de estados: ${estados.length} estados`);
    
    const select = document.getElementById('filtro-estado');
    if (!select) {
        console.log('⚠️ [PRESUPUESTOS-JS] No se encontró elemento filtro-estado');
        return;
    }
    
    // Limpiar opciones existentes (excepto la primera)
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }
    
    // Agregar nuevas opciones
    if (estados.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '(Sin estados)';
        option.disabled = true;
        select.appendChild(option);
    } else {
        estados.forEach(estado => {
            if (estado) {
                const option = document.createElement('option');
                option.value = estado;
                option.textContent = estado;
                select.appendChild(option);
            }
        });
    }
    
    console.log('✅ [PRESUPUESTOS-JS] Filtro de estados actualizado');
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
    return `${d}/${m}/${y}`;
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
        
        return `${day}/${month}/${year}`;
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
        return `${d}/${m}/${y} 00:00`;
    }
    
    // Para fechas con hora
    try {
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        
        return `${day}/${month}/${year} ${hours}:${minutes}`;
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
            console.log(`✅ [PRESUPUESTOS-JS] Detalles cargados: ${data.data.total_articulos} artículos`);
            
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
    
    const { presupuesto, detalles, totales, total_articulos } = data;
    
    // DEBUG: Ver qué datos llegan
    if (detalles && detalles.length > 0) {
        console.log('[DEBUG-DETALLES] Primer artículo recibido:', {
            articulo: detalles[0].articulo,
            descripcion_articulo: detalles[0].descripcion_articulo,
            descripcion: detalles[0].descripcion,
            detalle: detalles[0].detalle
        });
    }
    
    // Log de control por presupuesto según especificación
    if (totales) {
        console.log("[DETALLE]", "sumNeto=", totales.neto_total.toFixed(2), "sumIVA=", totales.iva_total.toFixed(2), "sumTotal=", totales.total_general.toFixed(2));
    }
    
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
    
    return `
        <div class="detalles-content">
            <div class="detalles-header">
                <h4>📋 Detalles del Presupuesto ${presupuesto.id_presupuesto}</h4>
                <div class="detalles-info">
                    <span class="tipo-comprobante">${presupuesto.tipo_comprobante}</span>
                    <span class="total-articulos">${total_articulos} artículo${total_articulos !== 1 ? 's' : ''}</span>
                </div>
            </div>
            
            <div class="detalles-table-container">
                <table class="detalles-table">
                    <thead>
                        <tr>
                            <th>Artículo</th>
                            <th>Cantidad</th>
                            <th>Neto</th>
                            <th>IVA</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detalles.map(item => `
                            <tr>
                                <td class="articulo-cell">
                                    <span class="articulo-descripcion">${escapeHtml(item.descripcion_articulo || item.articulo || 'N/A')}</span>
                                    ${item.articulo && item.descripcion_articulo !== item.articulo ? 
                                        `<small class="articulo-codigo">(${escapeHtml(item.articulo)})</small>` : ''}
                                </td>
                                <td class="text-center">${formatNumber(item.cantidad || 0)}</td>
                                <td class="text-right">$${formatNumber(item.neto || 0)}</td>
                                <td class="text-right">$${formatNumber(item.iva || 0)}</td>
                                <td class="text-right total-cell">$${formatNumber(item.total || 0)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr class="totales-row">
                            <td><strong>TOTALES</strong></td>
                            <td class="text-center"><strong>${formatNumber(totales.cantidad_total)}</strong></td>
                            <td class="text-right"><strong>$${formatNumber(totales.neto_total)}</strong></td>
                            <td class="text-right"><strong>$${formatNumber(totales.iva_total)}</strong></td>
                            <td class="text-right total-cell"><strong>$${formatNumber(totales.total_general)}</strong></td>
                        </tr>
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
        <div class="pagination-info">
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
        </div>
        
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
    
    console.log(`✅ [PRESUPUESTOS-JS] Controles de paginación actualizados - Página ${currentPage}/${totalPages}`);
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
 * Editar presupuesto
 */
function editarPresupuesto(presupuestoId) {
    console.log(`🔍 [PRESUPUESTOS-JS] Navegando a editar presupuesto ID: ${presupuestoId}`);
    
    // Redirigir a la página de editar presupuesto con el ID
    window.location.href = `/pages/editar-presupuesto.html?id=${presupuestoId}`;
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
window.refreshAutoUpdatePolling = async function() {
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
document.addEventListener('DOMContentLoaded', async function() {
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

console.log('✅ [PRESUPUESTOS-JS] Módulo frontend cargado completamente con paginación y auto-update');
