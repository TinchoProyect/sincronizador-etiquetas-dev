/**
 * MODAL DE CONFIGURACIÓN DE SINCRONIZACIÓN AUTOMÁTICA
 * Gestiones Lamda - Módulo de Presupuestos
 * 
 * Maneja la lógica del modal de configuración del scheduler automático
 */

console.log('[SYNC_CONFIG_UI] Inicializando modal de configuración de sincronización...');

// Configuración del módulo
const SYNC_CONFIG = {
    API_BASE_URL: '/api/presupuestos/sync',
    MESSAGES_TIMEOUT: 5000
};

// Estado del modal
let modalState = {
    isOpen: false,
    isLoading: false,
    currentConfig: null,
    schedulerHealth: null
};

/**
 * Abrir modal de configuración
 */
async function openSyncConfigModal() {
    console.log('[SYNC_CONFIG_UI] Abriendo modal de configuración...');
    
    try {
        // Mostrar modal
        const modal = document.getElementById('sync-config-modal');
        if (!modal) {
            console.error('[SYNC_CONFIG_UI] ❌ Modal no encontrado');
            showConfigMessage('Error: Modal no encontrado', 'error');
            return;
        }
        
        modal.style.display = 'flex';
        modalState.isOpen = true;
        
        // Cargar configuración actual
        await loadCurrentConfig();
        
        // Cargar estado del scheduler
        await loadSchedulerHealth();
        
        console.log('[SYNC_CONFIG_UI] ✅ Modal abierto exitosamente');
        
    } catch (error) {
        console.error('[SYNC_CONFIG_UI] ❌ Error al abrir modal:', error);
        showConfigMessage('Error al abrir configuración', 'error');
    }
}

/**
 * Cerrar modal de configuración
 */
function closeSyncConfigModal() {
    console.log('[SYNC_CONFIG_UI] Cerrando modal de configuración...');
    
    const modal = document.getElementById('sync-config-modal');
    if (modal) {
        modal.style.display = 'none';
        modalState.isOpen = false;
        
        // Limpiar errores
        clearFieldErrors();
        
        // MEJORA: Recargar estadísticas al cerrar modal para actualizar "Última sync"
        // Esto asegura que cambios en autosync se reflejen inmediatamente
        if (typeof loadEstadisticas === 'function') {
            console.log('[SYNC-CONFIG] Recargando estadísticas tras cerrar modal...');
            loadEstadisticas();
        }
        
        // NUEVO: Refrescar polling de auto-actualización según estado actual
        if (typeof window.refreshAutoUpdatePolling === 'function') {
            console.log('[SYNC-CONFIG] Refrescando polling de auto-actualización...');
            window.refreshAutoUpdatePolling();
        }
        
        console.log('[SYNC_CONFIG_UI] ✅ Modal cerrado');
    }
}

/**
 * Cargar configuración actual (Retirado en Micro-Etapa 6: sin llamada a /api/presupuestos/sync/config)
 */
async function loadCurrentConfig() {
    const defaultConfig = {
        auto_sync_enabled: false,
        sync_interval_minutes: 1,
        active_hours_start: '08:00',
        active_hours_end: '20:00',
        timezone: 'America/Argentina/Buenos_Aires'
    };
    modalState.currentConfig = defaultConfig;
    populateConfigForm(defaultConfig);
}

/**
 * Cargar estado del scheduler (Retirado en Micro-Etapa 6: sin llamada a /api/presupuestos/sync/health)
 */
async function loadSchedulerHealth() {
    const inactiveHealth = {
        isRunning: false,
        lastRunAt: null,
        nextRunAt: null,
        lastResult: { ok: null, processed: 0, error: 'Sincronizador Google Sheets retirado (100% Local-First)' }
    };
    modalState.schedulerHealth = inactiveHealth;
    populateSchedulerStatus(inactiveHealth);
}

/**
 * Poblar formulario con configuración
 */
function populateConfigForm(config) {
    console.log('[SYNC_CONFIG_UI] Poblando formulario con configuración...');
    
    // Checkbox de habilitación
    const autoSyncEnabled = document.getElementById('auto_sync_enabled');
    if (autoSyncEnabled) {
        autoSyncEnabled.checked = config.auto_sync_enabled || false;
    }
    
    // Intervalo en minutos
    const syncInterval = document.getElementById('sync_interval_minutes');
    if (syncInterval) {
        syncInterval.value = config.sync_interval_minutes || 1;
    }
    
    // Horario de inicio - Normalizar formato TIME de PostgreSQL a HH:mm
    const activeHoursStart = document.getElementById('active_hours_start');
    if (activeHoursStart) {
        let startTime = config.active_hours_start || '08:00';
        // Si viene como HH:mm:ss, convertir a HH:mm
        if (startTime.length > 5) {
            startTime = startTime.substring(0, 5);
        }
        activeHoursStart.value = startTime;
    }
    
    // Horario de fin - Normalizar formato TIME de PostgreSQL a HH:mm
    const activeHoursEnd = document.getElementById('active_hours_end');
    if (activeHoursEnd) {
        let endTime = config.active_hours_end || '20:00';
        // Si viene como HH:mm:ss, convertir a HH:mm
        if (endTime.length > 5) {
            endTime = endTime.substring(0, 5);
        }
        activeHoursEnd.value = endTime;
    }
    
    // Zona horaria
    const timezone = document.getElementById('timezone');
    if (timezone) {
        timezone.value = config.timezone || 'America/Argentina/Buenos_Aires';
    }
    
    console.log('[SYNC_CONFIG_UI] ✅ Formulario poblado');
}

/**
 * Poblar estado del scheduler
 */
function populateSchedulerStatus(health) {
    console.log('[SYNC_CONFIG_UI] Poblando estado del scheduler...');
    
    // Estado basado en la configuración guardada (auto_sync_enabled)
    // NO en isRunning que solo indica si el proceso scheduler está corriendo
    const schedulerRunning = document.getElementById('scheduler-running');
    if (schedulerRunning) {
        // Obtener estado real de auto_sync_enabled desde la configuración actual
        const isEnabled = modalState.currentConfig?.auto_sync_enabled || false;
        
        schedulerRunning.textContent = isEnabled ? '🟢 Activo' : '🔴 Inactivo';
        schedulerRunning.className = `status-value ${isEnabled ? 'status-active' : 'status-inactive'} status-clickable`;
        
        // Agregar tooltip
        schedulerRunning.title = isEnabled ? 
            'Click para desactivar sincronización automática' : 
            'Click para activar sincronización automática';
        
        // Limpiar event listeners previos
        schedulerRunning.replaceWith(schedulerRunning.cloneNode(true));
        const newSchedulerRunning = document.getElementById('scheduler-running');
        
        // Agregar event listener para toggle
        newSchedulerRunning.addEventListener('click', async () => {
            console.log('[SYNC_CONFIG_UI] Click en estado del scheduler - toggling...');
            await toggleSchedulerStatus(!isEnabled);
        });
        
        // Agregar cursor pointer en CSS si no existe
        newSchedulerRunning.style.cursor = 'pointer';
    }
    
    // Última ejecución
    const schedulerLastRun = document.getElementById('scheduler-last-run');
    if (schedulerLastRun) {
        schedulerLastRun.textContent = health.lastRunAt ? 
            formatDateTime(health.lastRunAt) : 'Nunca';
    }
    
    // Próxima ejecución
    const schedulerNextRun = document.getElementById('scheduler-next-run');
    if (schedulerNextRun) {
        schedulerNextRun.textContent = health.nextRunAt ? 
            formatDateTime(health.nextRunAt) : 'No programada';
    }
    
    // Último resultado
    const schedulerLastResult = document.getElementById('scheduler-last-result');
    if (schedulerLastResult) {
        if (health.lastResult.ok === null) {
            schedulerLastResult.textContent = 'Sin ejecuciones';
        } else if (health.lastResult.ok) {
            schedulerLastResult.textContent = `✅ Éxito (${health.lastResult.processed} registros)`;
            schedulerLastResult.className = 'status-value status-success';
        } else {
            schedulerLastResult.textContent = `❌ Error: ${health.lastResult.error || 'Desconocido'}`;
            schedulerLastResult.className = 'status-value status-error';
        }
    }
    
    console.log('[SYNC_CONFIG_UI] ✅ Estado del scheduler poblado');
}

/**
 * Guardar configuración
 */
async function saveSyncConfig() {
    console.log('[SYNC_CONFIG_UI] Guardando configuración...');
    
    if (modalState.isLoading) {
        console.log('[SYNC_CONFIG_UI] ⚠️ Ya hay una operación en curso');
        return;
    }
    
    try {
        // Validar formulario
        const formData = validateAndGetFormData();
        if (!formData) {
            console.log('[SYNC_CONFIG_UI] ❌ Validación del formulario falló');
            return;
        }
        
        // Deshabilitar botón y mostrar loading
        setConfigLoading(true);
        
        // Enviar PATCH al servidor
        const response = await fetch(`${SYNC_CONFIG.API_BASE_URL}/config`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            console.log('[SYNC_CONFIG_UI] ✅ Configuración guardada exitosamente:', data);
            showConfigMessage('✅ Configuración guardada exitosamente', 'success');
            
            // Actualizar estado local
            modalState.currentConfig = data;
            
            // Recargar estado del scheduler después de un momento
            setTimeout(() => {
                loadSchedulerHealth();
            }, 1000);
            
            // Cerrar modal después de un momento
            setTimeout(() => {
                closeSyncConfigModal();
            }, 2000);
            
        } else {
            // Manejar errores de validación del servidor
            if (response.status === 400 && data.details) {
                console.log('[SYNC_CONFIG_UI] ❌ Errores de validación del servidor:', data.details);
                displayServerValidationErrors(data.details);
                showConfigMessage('❌ Errores de validación. Revise los campos marcados.', 'error');
            } else {
                throw new Error(data.message || 'Error al guardar configuración');
            }
        }
        
    } catch (error) {
        console.error('[SYNC_CONFIG_UI] ❌ Error al guardar configuración:', error);
        showConfigMessage(`❌ Error al guardar: ${error.message}`, 'error');
    } finally {
        setConfigLoading(false);
    }
}

/**
 * Validar formulario y obtener datos
 */
function validateAndGetFormData() {
    console.log('[SYNC_CONFIG_UI] Validando formulario...');
    
    // Limpiar errores previos
    clearFieldErrors();
    
    const errors = [];
    const formData = {};
    
    // Validar auto_sync_enabled
    const autoSyncEnabled = document.getElementById('auto_sync_enabled');
    if (autoSyncEnabled) {
        formData.auto_sync_enabled = autoSyncEnabled.checked;
    }
    
    // Validar sync_interval_minutes
    const syncInterval = document.getElementById('sync_interval_minutes');
    if (syncInterval) {
        const value = parseInt(syncInterval.value);
        if (isNaN(value) || value < 1) {
            errors.push({ field: 'sync_interval_minutes', message: 'Debe ser un número entero mayor a 0' });
        } else {
            formData.sync_interval_minutes = value;
        }
    }
    
    // Validar active_hours_start
    const activeHoursStart = document.getElementById('active_hours_start');
    if (activeHoursStart) {
        const value = activeHoursStart.value;
        if (!value || !value.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
            errors.push({ field: 'active_hours_start', message: 'Formato de hora inválido (HH:mm)' });
        } else {
            formData.active_hours_start = value;
        }
    }
    
    // Validar active_hours_end
    const activeHoursEnd = document.getElementById('active_hours_end');
    if (activeHoursEnd) {
        const value = activeHoursEnd.value;
        if (!value || !value.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
            errors.push({ field: 'active_hours_end', message: 'Formato de hora inválido (HH:mm)' });
        } else {
            formData.active_hours_end = value;
        }
    }
    
    // Validar timezone
    const timezone = document.getElementById('timezone');
    if (timezone) {
        const value = timezone.value;
        if (!value || value.trim() === '') {
            errors.push({ field: 'timezone', message: 'Debe seleccionar una zona horaria' });
        } else {
            formData.timezone = value.trim();
        }
    }
    
    // Mostrar errores si los hay
    if (errors.length > 0) {
        console.log('[SYNC_CONFIG_UI] ❌ Errores de validación:', errors);
        displayValidationErrors(errors);
        return null;
    }
    
    console.log('[SYNC_CONFIG_UI] ✅ Formulario válido:', formData);
    return formData;
}

/**
 * Mostrar errores de validación en los campos
 */
function displayValidationErrors(errors) {
    errors.forEach(error => {
        const errorElement = document.getElementById(`error-${error.field}`);
        if (errorElement) {
            errorElement.textContent = error.message;
            errorElement.style.display = 'block';
        }
        
        // Marcar campo con error
        const field = document.getElementById(error.field);
        if (field) {
            field.classList.add('field-error-input');
        }
    });
}

/**
 * Mostrar errores de validación del servidor
 */
function displayServerValidationErrors(serverErrors) {
    serverErrors.forEach(errorMessage => {
        // Intentar extraer el campo del mensaje de error
        let fieldName = null;
        if (errorMessage.includes('sync_interval_minutes')) {
            fieldName = 'sync_interval_minutes';
        } else if (errorMessage.includes('active_hours_start')) {
            fieldName = 'active_hours_start';
        } else if (errorMessage.includes('active_hours_end')) {
            fieldName = 'active_hours_end';
        } else if (errorMessage.includes('timezone')) {
            fieldName = 'timezone';
        }
        
        if (fieldName) {
            const errorElement = document.getElementById(`error-${fieldName}`);
            if (errorElement) {
                errorElement.textContent = errorMessage;
                errorElement.style.display = 'block';
            }
            
            const field = document.getElementById(fieldName);
            if (field) {
                field.classList.add('field-error-input');
            }
        }
    });
}

/**
 * Limpiar errores de campos
 */
function clearFieldErrors() {
    const errorElements = document.querySelectorAll('.field-error');
    errorElements.forEach(element => {
        element.textContent = '';
        element.style.display = 'none';
    });
    
    const errorInputs = document.querySelectorAll('.field-error-input');
    errorInputs.forEach(input => {
        input.classList.remove('field-error-input');
    });
}

/**
 * Controlar estado de loading del modal
 */
function setConfigLoading(loading) {
    modalState.isLoading = loading;
    
    const saveButton = document.getElementById('btn-save-config');
    if (saveButton) {
        saveButton.disabled = loading;
        saveButton.textContent = loading ? '⏳ Guardando...' : '💾 Guardar Configuración';
    }
    
    console.log(`[SYNC_CONFIG_UI] Loading state: ${loading}`);
}

/**
 * Mostrar mensaje en el modal
 */
function showConfigMessage(message, type = 'info') {
    console.log(`[SYNC_CONFIG_UI] Mensaje: ${type} - ${message}`);
    
    // Usar el sistema de mensajes existente de presupuestos.js
    if (typeof showMessage === 'function') {
        showMessage(message, type);
    } else {
        // Fallback si no está disponible
        console.log(`[SYNC_CONFIG_UI] ${type.toUpperCase()}: ${message}`);
    }
}

/**
 * Toggle del estado del scheduler (activar/desactivar con un click)
 */
async function toggleSchedulerStatus(newStatus) {
    console.log(`[SYNC_CONFIG_UI] Toggling scheduler status a: ${newStatus}`);
    
    if (modalState.isLoading) {
        console.log('[SYNC_CONFIG_UI] ⚠️ Ya hay una operación en curso');
        return;
    }
    
    try {
        // Mostrar loading en el estado
        const schedulerRunning = document.getElementById('scheduler-running');
        if (schedulerRunning) {
            schedulerRunning.textContent = '⏳ Cambiando...';
            schedulerRunning.style.cursor = 'wait';
        }
        
        // Obtener configuración actual
        const currentConfig = modalState.currentConfig || {};
        
        // Normalizar horarios para enviar (convertir HH:mm:ss a HH:mm si es necesario)
        let startTime = currentConfig.active_hours_start || '08:00';
        let endTime = currentConfig.active_hours_end || '20:00';
        
        // Si vienen como HH:mm:ss, convertir a HH:mm
        if (startTime.length > 5) {
            startTime = startTime.substring(0, 5);
        }
        if (endTime.length > 5) {
            endTime = endTime.substring(0, 5);
        }
        
        // Preparar datos para enviar (solo cambiar auto_sync_enabled)
        const toggleData = {
            auto_sync_enabled: newStatus,
            sync_interval_minutes: currentConfig.sync_interval_minutes || 5,
            active_hours_start: startTime,
            active_hours_end: endTime,
            timezone: currentConfig.timezone || 'America/Argentina/Buenos_Aires'
        };
        
        console.log('[SYNC_CONFIG_UI] Enviando toggle con datos:', toggleData);
        
        // Enviar PATCH al servidor
        const response = await fetch(`${SYNC_CONFIG.API_BASE_URL}/config`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(toggleData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            console.log('[SYNC_CONFIG_UI] ✅ Toggle exitoso:', data);
            
            // Actualizar estado local
            modalState.currentConfig = data;
            
            // Actualizar formulario con nueva configuración
            populateConfigForm(data);
            
            // Mostrar mensaje de éxito
            const statusText = newStatus ? 'activada' : 'desactivada';
            showConfigMessage(`✅ Sincronización automática ${statusText}`, 'success');
            
            // Recargar estado del scheduler después de un momento
            setTimeout(() => {
                loadSchedulerHealth();
            }, 1000);
            
        } else {
            throw new Error(data.message || 'Error al cambiar estado del scheduler');
        }
        
    } catch (error) {
        console.error('[SYNC_CONFIG_UI] ❌ Error en toggle:', error);
        showConfigMessage(`❌ Error al cambiar estado: ${error.message}`, 'error');
        
        // Recargar estado original
        setTimeout(() => {
            loadSchedulerHealth();
        }, 500);
    }
}

/**
 * Formatear fecha y hora para mostrar
 */
function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);
    } catch (error) {
        console.error('[SYNC_CONFIG_UI] Error al formatear fecha:', error);
        return 'Fecha inválida';
    }
}

/**
 * Bindear eventos de UI
 */
function bindSyncConfigUI() {
    console.log('[SYNC_CONFIG_UI] Bindeando eventos de UI...');
    
    // Botón de configuración
    const btnConfiguracion = document.getElementById('btn-configuracion');
    if (btnConfiguracion) {
        btnConfiguracion.addEventListener('click', openSyncConfigModal);
        console.log('[SYNC_CONFIG_UI] ✅ Event listener agregado: btn-configuracion');
    } else {
        console.error('[SYNC_CONFIG_UI] ❌ Botón de configuración no encontrado');
    }
    
    // Cerrar modal con Escape
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalState.isOpen) {
            closeSyncConfigModal();
        }
    });
    
    // Cerrar modal clickeando fuera
    const modal = document.getElementById('sync-config-modal');
    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeSyncConfigModal();
            }
        });
    }
    
    console.log('[SYNC_CONFIG_UI] ✅ Eventos de UI bindeados');
}

// Exponer funciones globales necesarias para el HTML (Opción A)
window.openSyncConfigModal = openSyncConfigModal;
window.closeSyncConfigModal = closeSyncConfigModal;
window.saveSyncConfig = saveSyncConfig;
window.bindSyncConfigUI = bindSyncConfigUI;

// Auto-inicializar cuando el DOM esté listo (Opción A)
document.addEventListener('DOMContentLoaded', bindSyncConfigUI);

console.log('[SYNC_CONFIG_UI] ✅ Modal de configuración de sincronización cargado');
