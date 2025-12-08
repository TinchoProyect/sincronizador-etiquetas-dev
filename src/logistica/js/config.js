/**
 * Configuración del Cliente
 * Carga configuración segura desde el backend
 */

let CONFIG = null;

/**
 * Cargar configuración desde el backend
 */
async function cargarConfiguracion() {
    try {
        const response = await fetch('/api/logistica/config');
        const result = await response.json();
        
        if (result.success) {
            CONFIG = result.data;
            console.log('[CONFIG] Configuración cargada:', {
                environment: CONFIG.environment,
                hasGoogleMapsKey: !!CONFIG.googleMapsApiKey
            });
            return CONFIG;
        } else {
            throw new Error('Error al cargar configuración');
        }
    } catch (error) {
        console.error('[CONFIG] Error al cargar configuración:', error);
        throw error;
    }
}

/**
 * Obtener configuración (carga si no existe)
 */
async function getConfig() {
    if (!CONFIG) {
        await cargarConfiguracion();
    }
    return CONFIG;
}

/**
 * Obtener API Key de Google Maps
 */
async function getGoogleMapsApiKey() {
    const config = await getConfig();
    return config.googleMapsApiKey;
}

/**
 * Cargar script de Google Maps dinámicamente
 */
async function cargarGoogleMaps() {
    try {
        const apiKey = await getGoogleMapsApiKey();
        
        if (!apiKey) {
            console.warn('[CONFIG] Google Maps API Key no configurada');
            return false;
        }
        
        // Verificar si ya está cargado
        if (window.google && window.google.maps) {
            console.log('[CONFIG] Google Maps ya está cargado');
            return true;
        }
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
            script.async = true;
            script.defer = true;
            
            script.onload = () => {
                console.log('[CONFIG] Google Maps cargado exitosamente');
                resolve(true);
            };
            
            script.onerror = () => {
                console.error('[CONFIG] Error al cargar Google Maps');
                reject(new Error('Error al cargar Google Maps'));
            };
            
            document.head.appendChild(script);
        });
    } catch (error) {
        console.error('[CONFIG] Error al cargar Google Maps:', error);
        return false;
    }
}
