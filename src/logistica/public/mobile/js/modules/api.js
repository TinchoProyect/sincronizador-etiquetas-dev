/**
 * Módulo de API
 * Centraliza todas las llamadas al servidor
 */

const API_BASE_URL = window.location.origin;

/**
 * Realizar petición con autenticación
 */
async function fetchConAuth(url, options = {}) {
    const sesion = JSON.parse(localStorage.getItem('sesion_chofer') || '{}');
    
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers
    };
    
    if (sesion.token) {
        headers['Authorization'] = `Bearer ${sesion.token}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || error.message || `HTTP ${response.status}`);
    }
    
    return response.json();
}

/**
 * API de Login
 */
export async function login(usuario, password) {
    return fetchConAuth(`${API_BASE_URL}/api/logistica/movil/login`, {
        method: 'POST',
        body: JSON.stringify({ usuario, password })
    });
}

/**
 * API de Ruta Activa
 */
export async function obtenerRutaActiva() {
    return fetchConAuth(`${API_BASE_URL}/api/logistica/movil/ruta-activa`);
}

/**
 * API de Detalles de Pedido
 */
export async function obtenerDetallesPedido(presupuestoId) {
    return fetchConAuth(`${API_BASE_URL}/api/logistica/movil/pedidos/${presupuestoId}/detalles`);
}

/**
 * API de Confirmar Entrega
 */
export async function confirmarEntrega(datos) {
    return fetchConAuth(`${API_BASE_URL}/api/logistica/movil/entregas/confirmar`, {
        method: 'POST',
        body: JSON.stringify(datos)
    });
}

/**
 * API de Finalizar Ruta
 */
export async function finalizarRuta() {
    return fetchConAuth(`${API_BASE_URL}/api/logistica/movil/rutas/finalizar`, {
        method: 'POST'
    });
}

// Exportar URL base para uso en otros módulos
export { API_BASE_URL };
